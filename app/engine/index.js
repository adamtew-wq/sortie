// Sortie deterministic engine.
//
// Pure function: generateSession(inputs, framework, data) → Session.
//
// The engine is the *interpreter* of the written framework — it never invents
// training logic. Both the PWA and Claude Code (the AI side door) call this
// function so they produce identical, schema-valid sessions from the same
// inputs. The framework decides; this code only executes.
//
// Inputs:
//   - date              ISO date (YYYY-MM-DD) the session is prescribed for
//   - equipmentProfile  profile key ("Home" / "Military" / etc.) or an array
//                        of equipment keys for an ad-hoc inventory
//   - readiness         1–5 score from today's check-in
//   - timeBudget        minutes available today (caps duration)
//   - activeNiggles?    list of { region, affectedPatterns?, rehabProtocolId? }
//   - forceModality?    override modality picker (testing / explicit asks)
//   - forceSessionType? override session-type picker
//
// Framework (passed in so this module never touches the filesystem):
//   - exerciseLibrary   framework/exercise-library.json
//   - sessionTemplates  framework/session-templates.json
//   - sessionSchema     framework/session-schema.json
//   - rehabProtocols    framework/rehab-protocols.json
//
// Data:
//   - equipment    data/equipment.json    (profiles + inventory)
//   - baselines    data/baselines.json    (spine-lift seed loads)
//   - attributes   data/attributes.json   (long-run training priorities)
//   - events       data/events.json       (dated overlays)
//   - niggles      data/niggles.json      (active injuries; can be overridden)
//   - history      array of parsed history.jsonl entries

// --- Constants encoded from framework/load-balancing.md & injury-routing.md ---

const WEEKLY_CAPS_MINUTES = {
  weights: 240, run: 240, swim: 150, bike: 240, conditioning: 120,
};

const READINESS = {
  5: { volume: 1.0,  intensity: 1.0  },
  4: { volume: 1.0,  intensity: 1.0  },
  3: { volume: 0.85, intensity: 0.95 },
  2: { volume: 0.70, intensity: 0.90 },
  1: { volume: 0.50, intensity: 0.80 },
};

const INJURY_ROUTING = {
  knee:         { affected: ['squat', 'hinge'], rehabId: 'knee-basic' },
  shoulder:     { affected: ['push'],           rehabId: 'shoulder-basic' },
  'lower-back': { affected: ['hinge'],          rehabId: 'lower-back-basic' },
  hip:          { affected: ['hinge', 'squat'], rehabId: 'lower-back-basic' },
  ankle:        { affected: ['cardio'],         rehabId: 'lower-back-basic' },
};

// Preferred substitutes when a spine lift's kit is unavailable. Walked in
// order; first survivor of the equipment + niggle filter wins.
const SPINE_SUBSTITUTES = {
  'Back squat':            ['Goblet squat'],
  'Front squat':           ['Goblet squat'],
  'Conventional deadlift': ['Romanian deadlift', 'Kettlebell deadlift'],
  'Romanian deadlift':     ['Single-leg Romanian deadlift', 'Kettlebell deadlift'],
  'Bench press':           ['Dumbbell bench press', 'Dumbbell floor press', 'Push-up'],
  'Overhead press':        ['Dumbbell shoulder press', 'Pike push-up'],
  'Weighted pull-up':      ['Pull-up', 'Chin-up', 'Inverted row'],
  'Barbell row':           ['Dumbbell row', 'Single-arm dumbbell row', 'Inverted row'],
  'Hip thrust':            ['Glute bridge', 'Single-leg Romanian deadlift'],
};

// Patterns each weights session type's spine lifts load. Used by the niggle
// router so we skip a slot whose spine is mostly contraindicated.
const SLOT_PATTERNS = {
  'upper-push':   ['push'],
  'upper-pull':   ['pull'],
  'lower':        ['squat', 'hinge'],
  'full-body':    ['squat', 'push'],
  'conditioning': ['hinge', 'squat', 'push'],
};

const MODALITIES = ['weights', 'run', 'swim', 'bike', 'conditioning'];

// --- Small helpers ---

const roundTo2_5 = (kg) => Math.round(kg / 2.5) * 2.5;

function fitsEquipment(exercise, equipmentSet) {
  return exercise.equipment.every((k) => equipmentSet.has(k));
}

function loadsFlaggedPattern(exercise, flaggedPatterns) {
  if (!flaggedPatterns.size) return false;
  const patterns = exercise.movementPatterns || [];
  return patterns.some((p) => flaggedPatterns.has(p));
}

function collectFlaggedPatterns(niggles) {
  const set = new Set();
  for (const n of niggles || []) {
    const affected = n.affectedPatterns || INJURY_ROUTING[n.region]?.affected || [];
    for (const p of affected) set.add(p);
  }
  return set;
}

function resolveEquipmentSet(profile, data) {
  if (Array.isArray(profile)) return new Set(profile);
  const available = data?.equipment?.profiles?.[profile]?.available || [];
  return new Set(available);
}

function findActiveEventName(events, date) {
  for (const e of events || []) {
    if (e.date >= date) return e.name || null;
  }
  return null;
}

// --- Spine progression (mirrors framework/progression-rules.md) ---

export function computeSpineState(name, baselines, history) {
  let weight = baselines?.spineLifts?.[name]?.working5 ?? 60;
  let consecutiveFails = 0;
  let stalls = 0;
  for (const session of history || []) {
    if (session.modality !== 'weights') continue;
    for (const ex of session.exercises || []) {
      if (ex.name !== name) continue;
      if (ex.success) {
        weight = weight + 2.5;
        consecutiveFails = 0;
        stalls = 0;
      } else {
        consecutiveFails += 1;
        if (consecutiveFails >= 2) {
          stalls += 1;
          consecutiveFails = 0;
          if (stalls >= 3) {
            weight = roundTo2_5(weight * 0.90);
            stalls = 0;
          }
        }
      }
    }
  }
  return { weight, consecutiveFails, stalls };
}

// --- Modality picker (mirrors framework/load-balancing.md § 4) ---

function attributeWants(attributes) {
  const wants = Object.fromEntries(MODALITIES.map((m) => [m, 0]));
  for (const a of attributes?.attributes || []) {
    for (const m of a.modalities || []) {
      if (m in wants) wants[m] += a.weight;
    }
  }
  return wants;
}

function weeklyMinutes(history, date) {
  const cutoff = new Date(date);
  cutoff.setUTCDate(cutoff.getUTCDate() - 7);
  const cutoffISO = cutoff.toISOString().slice(0, 10);
  const totals = Object.fromEntries(MODALITIES.map((m) => [m, 0]));
  for (const s of history || []) {
    if (s.date <= date && s.date >= cutoffISO) {
      totals[s.modality] = (totals[s.modality] || 0) + (s.duration || 0);
    }
  }
  return totals;
}

export function pickModality({ attributes, history, events, date, flaggedPatterns }) {
  const wants = attributeWants(attributes);
  for (const e of events || []) {
    if (!e.modalities) continue;
    if (e.date < date) continue;
    const boost = 0.25; // simple placeholder taper (load-balancing.md § 4)
    for (const m of e.modalities) wants[m] = (wants[m] || 0) * (1 + boost);
  }
  const loaded = weeklyMinutes(history, date);

  let bestModality = 'weights';
  let bestScore = -Infinity;
  for (const m of MODALITIES) {
    if (m === 'weights' && SLOT_PATTERNS['upper-push'].every((p) => flaggedPatterns.has(p))
        && SLOT_PATTERNS['upper-pull'].every((p) => flaggedPatterns.has(p))) continue;
    if (m === 'run' && flaggedPatterns.has('cardio')) continue;
    const ratio = (loaded[m] || 0) / WEEKLY_CAPS_MINUTES[m];
    const score = wants[m] - ratio;
    if (score > bestScore) {
      bestScore = score;
      bestModality = m;
    }
  }
  return bestModality;
}

// --- Session-type pickers ---

function pickWeightsSessionType(flaggedPatterns, history) {
  const order = ['upper-push', 'upper-pull', 'lower', 'full-body', 'conditioning'];
  const eligible = order.filter((slot) => {
    const patterns = SLOT_PATTERNS[slot];
    const flaggedCount = patterns.filter((p) => flaggedPatterns.has(p)).length;
    // Drop the slot if half or more of its spine patterns are contraindicated.
    return flaggedCount * 2 < patterns.length || (flaggedCount === 0);
  });
  if (eligible.length === 0) return 'upper-pull';
  const recent = (history || []).slice(-5).map((h) => h.sessionType);
  for (const slot of eligible) {
    if (!recent.includes(slot)) return slot;
  }
  return eligible[0];
}

function pickCardioSessionType(modality, timeBudget) {
  if (modality === 'run') return timeBudget >= 75 ? 'long' : 'easy';
  if (modality === 'bike') return timeBudget >= 90 ? 'long' : 'easy';
  if (modality === 'swim') return 'easy';
  if (modality === 'conditioning') return 'kb-circuit';
  return 'easy';
}

// --- Builders ---

function substituteSpine(name, byName, equipmentSet, flaggedPatterns) {
  const ex = byName.get(name);
  if (ex && fitsEquipment(ex, equipmentSet) && !loadsFlaggedPattern(ex, flaggedPatterns)) {
    return { name, exercise: ex };
  }
  for (const sub of SPINE_SUBSTITUTES[name] || []) {
    const subEx = byName.get(sub);
    if (subEx && fitsEquipment(subEx, equipmentSet) && !loadsFlaggedPattern(subEx, flaggedPatterns)) {
      return { name: sub, exercise: subEx };
    }
  }
  return null;
}

function buildRehabBlocks(niggles, rehabProtocols, byName, equipmentSet) {
  const blocks = [];
  const seen = new Set();
  for (const n of niggles || []) {
    const protocolId = n.rehabProtocolId || INJURY_ROUTING[n.region]?.rehabId;
    if (!protocolId || seen.has(protocolId)) continue;
    seen.add(protocolId);
    const protocol = (rehabProtocols?.protocols || []).find((p) => p.id === protocolId);
    if (!protocol) continue;
    for (const def of protocol.exercises) {
      const ex = byName.get(def.name);
      if (!ex || !fitsEquipment(ex, equipmentSet)) continue;
      const block = { exercise: def.name, sets: def.sets, cue: def.cue, rehab: true };
      if (def.reps) block.reps = def.reps;
      if (def.duration) block.duration = def.duration;
      blocks.push(block);
    }
  }
  return blocks;
}

function buildWeightsSession(args) {
  const {
    sessionType, templates, byName, equipmentSet, flaggedPatterns,
    history, baselines, readinessMul, niggles, rehabProtocols,
  } = args;
  const tpl = templates.weights[sessionType];

  const main = [];
  const spineSets = Math.max(2, Math.round(4 * readinessMul.volume));

  for (const spineName of tpl.spine) {
    const chosen = substituteSpine(spineName, byName, equipmentSet, flaggedPatterns);
    if (!chosen) continue;
    const isBarbellSpine = chosen.exercise.spineCandidate
      && chosen.exercise.equipment.some((k) => k === 'barbell' || k === 'plates');
    const baseLift = isBarbellSpine ? chosen.name : null;
    let load;
    if (baseLift && baselines?.spineLifts?.[baseLift]) {
      const { weight } = computeSpineState(baseLift, baselines, history);
      load = roundTo2_5(weight * readinessMul.intensity);
    } else {
      load = 'RPE 7';
    }
    main.push({
      exercise: chosen.name,
      sets: spineSets,
      reps: 5,
      load,
      rest: '180s',
      cue: chosen.exercise.cue,
    });
  }

  const accessoryBudget = Math.max(1, Math.round(3 * readinessMul.volume));
  const accessorySets = Math.max(2, Math.round(3 * readinessMul.volume));
  let added = 0;
  const spineNames = new Set(main.map((b) => b.exercise));
  for (const name of tpl.accessories) {
    if (added >= accessoryBudget) break;
    if (spineNames.has(name)) continue;
    const ex = byName.get(name);
    if (!ex || !fitsEquipment(ex, equipmentSet) || loadsFlaggedPattern(ex, flaggedPatterns)) continue;
    main.push({
      exercise: name,
      sets: accessorySets,
      reps: 10,
      load: 'RPE 7',
      rest: '90s',
      cue: ex.cue,
    });
    added += 1;
  }

  const warmup = [];
  warmup.push(...buildRehabBlocks(niggles, rehabProtocols, byName, equipmentSet));
  const primer = byName.get('Band pull-apart');
  if (primer && fitsEquipment(primer, equipmentSet)) {
    warmup.push({ exercise: 'Band pull-apart', sets: 2, reps: 15, cue: primer.cue });
  }

  const cooldown = [];
  const catCow = byName.get('Cat-cow');
  if (catCow && fitsEquipment(catCow, equipmentSet)) {
    cooldown.push({ exercise: 'Cat-cow', sets: 1, reps: 10, cue: catCow.cue });
  }

  return { warmup, main, cooldown };
}

function buildCardioSession(args) {
  const { modality, sessionType, templates, byName, equipmentSet, readinessMul, niggles, rehabProtocols } = args;
  const archetypes = templates[modality] || [];
  const arch = archetypes.find((a) => a.name === sessionType) || archetypes[0];

  const warmup = [];
  const main = [];
  const cooldown = [];

  const totalMinutes = Math.max(10, Math.round((arch?.defaultDuration || 30) * readinessMul.volume));
  const mainCount = (arch?.blocks || []).filter((b) => b.phase === 'main').length || 1;
  const mainPerBlock = Math.max(5, Math.round((totalMinutes * 0.75) / mainCount));

  for (const b of arch?.blocks || []) {
    const ex = byName.get(b.exercise);
    if (!ex || !fitsEquipment(ex, equipmentSet)) continue;
    const minutes = b.phase === 'main' ? mainPerBlock : Math.max(3, Math.round(totalMinutes * 0.10));
    const block = {
      exercise: b.exercise,
      duration: `${minutes} min`,
      load: 'Zone 2',
      cue: ex.cue,
    };
    if (b.phase === 'warmup') warmup.push(block);
    else if (b.phase === 'cooldown') cooldown.push(block);
    else main.push(block);
  }

  warmup.unshift(...buildRehabBlocks(niggles, rehabProtocols, byName, equipmentSet));
  return { warmup, main, cooldown };
}

function estimateDuration(warmup, main, cooldown, timeBudget, readiness) {
  let total = 0;
  for (const b of [...warmup, ...main, ...cooldown]) {
    if (b.sets) {
      const restSec = parseInt(String(b.rest || '60s'), 10) || 60;
      // Rough: each working set ≈ 45s of work + the prescribed rest.
      total += b.sets * (0.75 + restSec / 60);
    } else if (b.duration) {
      const m = /([\d.]+)\s*min/i.exec(b.duration);
      if (m) total += parseFloat(m[1]);
      else total += 2; // small fixed cost for non-time durations like "30 s"
    }
  }
  total = Math.round(total);
  if (readiness === 1) total = Math.min(total, 25);
  if (timeBudget) total = Math.min(total, timeBudget);
  return Math.max(5, total);
}

function buildRationale({ modality, sessionType, readiness, niggles, events, date }) {
  const parts = [];
  if (niggles?.length) parts.push(`niggle: ${niggles.map((n) => n.region).join(', ')}`);
  const eventName = findActiveEventName(events, date);
  if (eventName) parts.push(`event taper: ${eventName}`);
  if (readiness <= 2) parts.push(`low readiness (${readiness}) — volume cut`);
  else if (readiness === 3) parts.push(`readiness 3 — minor scaling`);
  else parts.push(`full readiness (${readiness})`);
  return `${modality} / ${sessionType} — ${parts.join('; ')}.`;
}

// --- Main entry point ---

export function generateSession(inputs, framework, data) {
  const { date, equipmentProfile, readiness, timeBudget } = inputs;
  const readinessMul = READINESS[readiness] || READINESS[3];
  const equipmentSet = resolveEquipmentSet(equipmentProfile, data);
  const byName = new Map(framework.exerciseLibrary.exercises.map((e) => [e.name, e]));
  const niggles = inputs.activeNiggles ?? data.niggles ?? [];
  const flaggedPatterns = collectFlaggedPatterns(niggles);

  const modality = inputs.forceModality || pickModality({
    attributes: data.attributes,
    history: data.history || [],
    events: data.events || [],
    date,
    flaggedPatterns,
  });

  const sessionType = inputs.forceSessionType || (
    modality === 'weights'
      ? pickWeightsSessionType(flaggedPatterns, data.history || [])
      : pickCardioSessionType(modality, timeBudget)
  );

  const builderArgs = {
    sessionType,
    templates: framework.sessionTemplates,
    byName,
    equipmentSet,
    flaggedPatterns,
    history: data.history || [],
    baselines: data.baselines,
    readinessMul,
    niggles,
    rehabProtocols: framework.rehabProtocols,
    modality,
  };

  const { warmup, main, cooldown } = modality === 'weights'
    ? buildWeightsSession(builderArgs)
    : buildCardioSession(builderArgs);

  const duration = estimateDuration(warmup, main, cooldown, timeBudget, readiness);

  return {
    warmup,
    main,
    cooldown,
    rationale: buildRationale({ modality, sessionType, readiness, niggles, events: data.events || [], date }),
    metadata: {
      date,
      modality,
      sessionType,
      duration,
      equipmentProfile: typeof equipmentProfile === 'string' ? equipmentProfile : 'ad-hoc',
      readiness,
      eventOverlay: findActiveEventName(data.events || [], date),
    },
  };
}
