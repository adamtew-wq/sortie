// Sortie UI state — pure state machine + render helpers for the daily loop
// (check-in → suggestion → start). No DOM access; app.js wires events.
//
// The renderers return HTML strings so they are testable without JSDOM. Inputs
// flowing through `mapCheckinToInputs` mirror the engine's contract so a
// frame-perfect parity with `app/engine/index.js` is preserved (CLAUDE.md).

import { generateSession } from '../engine/index.js';

const SLEEP_MOD = { poor: -1, ok: 0, good: 1 };

// Soreness regions translate to niggles the engine routes around. Patterns and
// rehab IDs come from framework/injury-routing.md and framework/rehab-protocols.json.
const SORENESS_NIGGLES = {
  none: [],
  upper: [
    { region: 'shoulder', affectedPatterns: ['push'], severity: 'mild', rehabProtocolId: 'shoulder-basic' },
  ],
  lower: [
    { region: 'knee', affectedPatterns: ['squat'], severity: 'mild', rehabProtocolId: 'knee-basic' },
  ],
  full: [
    { region: 'shoulder', affectedPatterns: ['push'], severity: 'mild', rehabProtocolId: 'shoulder-basic' },
    { region: 'knee', affectedPatterns: ['squat'], severity: 'mild', rehabProtocolId: 'knee-basic' },
  ],
};

const MODALITIES = ['weights', 'run', 'swim', 'bike', 'conditioning'];
const SHORTEN_OPTIONS = [20, 30, 45];
const DEFAULT_LOCATION = 'Home';
const DEFAULT_TIME_BUDGET = 45;
const HISTORY_KEY = 'sortie.history';
const LOAD_STEP_KG = 2.5;
const REPS_STEP = 1;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function initialState() {
  return {
    stage: 'checkin',
    checkin: { energy: null, soreness: null, sleep: null },
    location: DEFAULT_LOCATION,
    overrides: { modality: null, timeBudget: null },
    suggestion: null,
    pickers: { focus: false, location: false, shorten: false },
    logging: null,
  };
}

export function mapCheckinToInputs(checkin, ctx, date) {
  const energy = checkin.energy ?? 3;
  const sleepMod = SLEEP_MOD[checkin.sleep] ?? 0;
  const readiness = clamp(energy + sleepMod, 1, 5);
  const activeNiggles = SORENESS_NIGGLES[checkin.soreness] || [];
  const equipmentProfile = isAdHoc(ctx.location) ? ctx.location.equipment : ctx.location;
  const inputs = {
    date,
    equipmentProfile,
    readiness,
    timeBudget: ctx.overrides.timeBudget ?? DEFAULT_TIME_BUDGET,
    activeNiggles,
  };
  if (ctx.overrides.modality) inputs.forceModality = ctx.overrides.modality;
  return inputs;
}

function isAdHoc(location) {
  return location && typeof location === 'object' && location.kind === 'adhoc';
}

function runEngine(state, framework, data, date) {
  const inputs = mapCheckinToInputs(
    state.checkin,
    { location: state.location, overrides: state.overrides },
    date,
  );
  return generateSession(inputs, framework, data);
}

export function reducer(state, action) {
  switch (action.type) {
    case 'SET_ENERGY':
      return { ...state, checkin: { ...state.checkin, energy: action.payload } };
    case 'SET_SORENESS':
      return { ...state, checkin: { ...state.checkin, soreness: action.payload } };
    case 'SET_SLEEP':
      return { ...state, checkin: { ...state.checkin, sleep: action.payload } };
    case 'SET_LOCATION':
      return {
        ...state,
        location: action.payload,
        pickers: { ...state.pickers, location: false },
      };
    case 'SET_FOCUS':
      return {
        ...state,
        overrides: { ...state.overrides, modality: action.payload },
        pickers: { ...state.pickers, focus: false },
      };
    case 'SHORTEN':
      return {
        ...state,
        overrides: { ...state.overrides, timeBudget: action.payload },
        pickers: { ...state.pickers, shorten: false },
      };
    case 'TOGGLE_PICKER':
      return {
        ...state,
        pickers: { ...state.pickers, [action.payload]: !state.pickers[action.payload] },
      };
    case 'GO':
    case 'REGENERATE': {
      const suggestion = runEngine(state, action.framework, action.data, action.date);
      return { ...state, suggestion, stage: 'suggestion' };
    }
    case 'START':
      return {
        ...state,
        stage: 'logging',
        logging: state.suggestion ? initLoggingState(state.suggestion, action.startedAt) : null,
      };
    case 'LOG_DONE_SET':
      return logDoneSet(state);
    case 'LOG_EDIT_SET':
      return logEditSet(state, action.payload);
    case 'LOG_SKIP_EXERCISE':
      return logSkipExercise(state);
    case 'LOG_END_EARLY':
      return {
        ...state,
        stage: 'summary',
        logging: { ...state.logging, endedEarly: true },
      };
    case 'LOG_SET_RPE':
      return { ...state, logging: { ...state.logging, rpe: action.payload } };
    case 'LOG_SAVE': {
      const endedAt = action.endedAt ?? Date.now();
      const entry = buildLogEntry(state, endedAt);
      if (action.storage) appendHistoryEntry(entry, action.storage);
      return { ...state, stage: 'saved', logging: { ...state.logging, savedEntry: entry } };
    }
    case 'BACK_TO_CHECKIN':
      return { ...initialState(), location: state.location };
    default:
      return state;
  }
}

// --- Logging state machine helpers --------------------------------------

function initLoggingState(suggestion, startedAt) {
  const actuals = suggestion.main.map((block) => {
    const setCount = typeof block.sets === 'number' && block.sets > 0 ? block.sets : 1;
    return {
      name: block.exercise,
      prescribed: { sets: block.sets, reps: block.reps, load: block.load },
      sets: Array.from({ length: setCount }, () => ({
        reps: block.reps,
        load: block.load,
        done: false,
        skipped: false,
      })),
      skippedExercise: false,
    };
  });
  return {
    actuals,
    exerciseIndex: 0,
    setIndex: 0,
    rpe: null,
    endedEarly: false,
    startedAt: startedAt ?? Date.now(),
  };
}

function advanceCursor(actuals, exerciseIndex, setIndex) {
  let i = exerciseIndex;
  let j = setIndex + 1;
  while (i < actuals.length) {
    if (actuals[i].skippedExercise) {
      i += 1;
      j = 0;
      continue;
    }
    if (j < actuals[i].sets.length) return { exerciseIndex: i, setIndex: j, done: false };
    i += 1;
    j = 0;
  }
  return { exerciseIndex: actuals.length, setIndex: 0, done: true };
}

function logDoneSet(state) {
  const { exerciseIndex, setIndex } = state.logging;
  const actuals = state.logging.actuals.map((ex, i) => {
    if (i !== exerciseIndex) return ex;
    return {
      ...ex,
      sets: ex.sets.map((s, j) => (j === setIndex ? { ...s, done: true } : s)),
    };
  });
  const next = advanceCursor(actuals, exerciseIndex, setIndex);
  const baseLogging = { ...state.logging, actuals };
  if (next.done) {
    return { ...state, stage: 'summary', logging: baseLogging };
  }
  return {
    ...state,
    logging: { ...baseLogging, exerciseIndex: next.exerciseIndex, setIndex: next.setIndex },
  };
}

function logEditSet(state, { exerciseIndex, setIndex, reps, load }) {
  const actuals = state.logging.actuals.map((ex, i) => {
    if (i !== exerciseIndex) return ex;
    return {
      ...ex,
      sets: ex.sets.map((s, j) => {
        if (j !== setIndex) return s;
        const out = { ...s };
        if (reps !== undefined) out.reps = reps;
        if (load !== undefined) out.load = load;
        return out;
      }),
    };
  });
  return { ...state, logging: { ...state.logging, actuals } };
}

function logSkipExercise(state) {
  const idx = state.logging.exerciseIndex;
  const actuals = state.logging.actuals.map((ex, i) => {
    if (i !== idx) return ex;
    return {
      ...ex,
      skippedExercise: true,
      sets: ex.sets.map((s) => (s.done ? s : { ...s, skipped: true })),
    };
  });
  let i = idx + 1;
  while (i < actuals.length && actuals[i].skippedExercise) i += 1;
  const baseLogging = { ...state.logging, actuals };
  if (i >= actuals.length) {
    return { ...state, stage: 'summary', logging: baseLogging };
  }
  return {
    ...state,
    logging: { ...baseLogging, exerciseIndex: i, setIndex: 0 },
  };
}

// --- Log-entry builder + local persistence ------------------------------

function summariseExercise(ex) {
  const doneSets = ex.sets.filter((s) => s.done);
  const last = doneSets[doneSets.length - 1] || { reps: ex.prescribed.reps, load: ex.prescribed.load };
  const allDone = !ex.skippedExercise && ex.sets.every((s) => s.done);
  return {
    name: ex.name,
    sets: doneSets.length,
    reps: last.reps,
    load: last.load,
    success: allDone,
    skipped: !!ex.skippedExercise,
    actualSets: ex.sets.map((s) => ({
      reps: s.reps,
      load: s.load,
      done: s.done,
      skipped: s.skipped,
    })),
  };
}

export function buildLogEntry(state, endedAt) {
  const meta = state.suggestion.metadata;
  const log = state.logging;
  const minutes = Math.max(0, Math.round((endedAt - log.startedAt) / 60000));
  const exercises = log.actuals
    .filter((ex) => ex.sets.some((s) => s.done) || ex.skippedExercise)
    .map(summariseExercise);
  return {
    date: meta.date,
    modality: meta.modality,
    sessionType: meta.sessionType,
    duration: minutes,
    equipmentProfile: meta.equipmentProfile,
    readiness: meta.readiness,
    rpe: log.rpe,
    endedEarly: !!log.endedEarly,
    exercises,
  };
}

export function appendHistoryEntry(entry, storage) {
  const prev = storage.getItem(HISTORY_KEY) || '';
  const sep = prev === '' || prev.endsWith('\n') ? '' : '\n';
  storage.setItem(HISTORY_KEY, `${prev}${sep}${JSON.stringify(entry)}\n`);
}

export function loadLocalHistory(storage) {
  const raw = storage.getItem(HISTORY_KEY) || '';
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// --- Rendering helpers ---

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

function chip(attr, value, label, selected) {
  const ap = selected ? ' aria-pressed="true"' : ' aria-pressed="false"';
  return `<button type="button" class="chip" data-${attr}="${value}"${ap}>${escapeHtml(label)}</button>`;
}

export function renderCheckin(state) {
  const c = state.checkin;
  const energyChips = [1, 2, 3, 4, 5]
    .map((n) => chip('energy', String(n), String(n), c.energy === n))
    .join('');
  const soreChips = ['none', 'upper', 'lower', 'full']
    .map((r) => chip('soreness', r, r, c.soreness === r))
    .join('');
  const sleepChips = ['poor', 'ok', 'good']
    .map((v) => chip('sleep', v, v, c.sleep === v))
    .join('');
  return `
    <section class="checkin">
      <h1>How are you today?</h1>
      <p class="hint">Three taps and Go.</p>

      <fieldset class="group">
        <legend>Energy</legend>
        <div class="row">${energyChips}</div>
      </fieldset>

      <fieldset class="group">
        <legend>Soreness</legend>
        <div class="row">${soreChips}</div>
      </fieldset>

      <fieldset class="group">
        <legend>Sleep</legend>
        <div class="row">${sleepChips}</div>
      </fieldset>

      <button type="button" class="primary go" data-action="go">Go</button>
    </section>
  `;
}

function blockLine(block) {
  const parts = [];
  if (block.sets) parts.push(`${block.sets}×${block.reps ?? ''}`);
  if (block.duration) parts.push(String(block.duration));
  if (block.load !== undefined) {
    parts.push(typeof block.load === 'number' ? `${block.load} kg` : String(block.load));
  }
  if (block.rest) parts.push(`rest ${block.rest}`);
  return parts.join(' · ');
}

function renderBlock(block) {
  const rehab = block.rehab ? ' rehab' : '';
  const tag = block.rehab ? ' <span class="tag">rehab</span>' : '';
  return `
    <li class="block${rehab}">
      <div class="b-name">${escapeHtml(block.exercise)}${tag}</div>
      <div class="b-meta">${escapeHtml(blockLine(block))}</div>
      <div class="b-cue">${escapeHtml(block.cue || '')}</div>
    </li>
  `;
}

function focusPicker(state) {
  if (!state.pickers.focus) return '';
  const chips = MODALITIES
    .map((m) => chip('focus', m, m, state.overrides.modality === m))
    .join('');
  return `<div class="picker" data-picker="focus"><div class="row">${chips}</div></div>`;
}

function shortenPicker(state) {
  if (!state.pickers.shorten) return '';
  const chips = SHORTEN_OPTIONS
    .map((n) => chip('shorten', String(n), `${n} min`, state.overrides.timeBudget === n))
    .join('');
  return `<div class="picker" data-picker="shorten"><div class="row">${chips}</div></div>`;
}

function locationPicker(state) {
  if (!state.pickers.location) return '';
  const home = chip('location', 'Home', 'Home', state.location === 'Home');
  const military = chip('location', 'Military', 'Military', state.location === 'Military');
  // Ad-hoc kit toggles — common categories. The actual list reads off the
  // current equipment.json; we keep the picker self-contained for the MVP.
  const CATS = [
    'bodyweight', 'mat', 'dumbbells', 'kettlebell', 'barbell', 'rack', 'plates',
    'bench', 'pull-up-bar', 'resistance-band', 'jump-rope', 'open-road', 'bike',
  ];
  const adhocOn = isAdHoc(state.location);
  const adhocSet = new Set(adhocOn ? state.location.equipment : []);
  const adhocChips = CATS.map((k) => {
    const on = adhocSet.has(k);
    return `<button type="button" class="chip" data-adhoc-toggle="${k}" aria-pressed="${on}">${k}</button>`;
  }).join('');
  return `
    <div class="picker" data-picker="location">
      <div class="row">${home}${military}</div>
      <p class="hint">Or build an ad-hoc kit:</p>
      <div class="row wrap">${adhocChips}</div>
      <button type="button" class="primary" data-action="apply-adhoc">Use this kit</button>
    </div>
  `;
}

export function renderSuggestion(state) {
  const s = state.suggestion;
  if (!s) return '';
  const m = s.metadata;
  const locationLabel = isAdHoc(state.location) ? 'Ad-hoc' : String(state.location);
  return `
    <section class="suggestion">
      <header class="s-head">
        <span class="modality-badge">${escapeHtml(m.modality)} · ${escapeHtml(m.sessionType)}</span>
        <span class="duration">${m.duration} min</span>
        <span class="location">${escapeHtml(locationLabel)}</span>
      </header>
      <p class="rationale">${escapeHtml(s.rationale)}</p>

      <details data-block="warmup">
        <summary>Warm-up (${s.warmup.length})</summary>
        <ul class="blocks">${s.warmup.map(renderBlock).join('')}</ul>
      </details>

      <section class="main" data-block="main">
        <h2>Main work</h2>
        <ul class="blocks">${s.main.map(renderBlock).join('')}</ul>
      </section>

      <details data-block="cooldown">
        <summary>Cooldown (${s.cooldown.length})</summary>
        <ul class="blocks">${s.cooldown.map(renderBlock).join('')}</ul>
      </details>

      <nav class="overrides" aria-label="Override bar">
        <button type="button" data-action="change-focus" aria-expanded="${state.pickers.focus}">Change focus ▾</button>
        <button type="button" data-action="change-location" aria-expanded="${state.pickers.location}">Change location ▾</button>
        <button type="button" data-action="shorten" aria-expanded="${state.pickers.shorten}">Shorten ▾</button>
        <button type="button" data-action="regenerate">Regenerate</button>
      </nav>
      ${focusPicker(state)}
      ${locationPicker(state)}
      ${shortenPicker(state)}

      <button type="button" class="primary start" data-action="start">Start session</button>
    </section>
  `;
}

function fmtLoad(load) {
  if (load === undefined || load === null) return '—';
  if (typeof load === 'number') return `${load} kg`;
  return String(load);
}

function fmtReps(reps) {
  if (reps === undefined || reps === null) return '—';
  return String(reps);
}

export function renderLogging(state) {
  const log = state.logging;
  if (!log) return '<section class="logging"><p>No session in progress.</p></section>';
  const cur = log.actuals[log.exerciseIndex];
  if (!cur) return '<section class="logging"><p>All sets confirmed.</p></section>';
  const setNum = log.setIndex + 1;
  const setTotal = cur.sets.length;
  const set = cur.sets[log.setIndex];
  const meta = state.suggestion?.metadata || {};
  return `
    <section class="logging">
      <header class="log-head">
        <span class="modality-badge">${escapeHtml(meta.modality || '')}</span>
        <span class="duration" data-elapsed-from="${log.startedAt}">0:00</span>
      </header>
      <h1 class="log-ex">${escapeHtml(cur.name)}</h1>
      <p class="hint">Set ${setNum} of ${setTotal}</p>

      <div class="log-prescription">
        <div class="log-field" data-field="load">
          <span class="lbl">Load</span>
          <button type="button" class="chip step" data-edit-load="down" aria-label="Decrease load">−</button>
          <span class="val">${escapeHtml(fmtLoad(set.load))}</span>
          <button type="button" class="chip step" data-edit-load="up" aria-label="Increase load">+</button>
        </div>
        <div class="log-field" data-field="reps">
          <span class="lbl">Reps</span>
          <button type="button" class="chip step" data-edit-reps="down" aria-label="Decrease reps">−</button>
          <span class="val">${escapeHtml(fmtReps(set.reps))}</span>
          <button type="button" class="chip step" data-edit-reps="up" aria-label="Increase reps">+</button>
        </div>
      </div>

      <button type="button" class="primary log-done" data-action="log-done">Done ✓</button>

      <nav class="overrides" aria-label="Session controls">
        <button type="button" data-action="log-skip">Skip exercise</button>
        <button type="button" data-action="log-end-early">End session early</button>
      </nav>
    </section>
  `;
}

function summaryExerciseLine(ex) {
  const doneCount = ex.sets.filter((s) => s.done).length;
  const total = ex.sets.length;
  const last = ex.sets.filter((s) => s.done).slice(-1)[0] || ex.sets[0];
  const note = ex.skippedExercise ? ' · skipped' : '';
  return `
    <li class="block">
      <div class="b-name">${escapeHtml(ex.name)}${note}</div>
      <div class="b-meta">${doneCount}/${total} sets · ${escapeHtml(fmtLoad(last.load))} · ${escapeHtml(fmtReps(last.reps))} reps</div>
    </li>
  `;
}

export function renderSummary(state) {
  const log = state.logging;
  if (!log) return '<section class="summary"><p>Nothing to log.</p></section>';
  const items = log.actuals
    .filter((ex) => ex.sets.some((s) => s.done) || ex.skippedExercise)
    .map(summaryExerciseLine)
    .join('');
  const rpeChips = Array.from({ length: 10 }, (_, i) => i + 1)
    .map((n) => chip('rpe', String(n), String(n), log.rpe === n))
    .join('');
  return `
    <section class="summary">
      <h1>Session summary</h1>
      <ul class="blocks">${items}</ul>

      <fieldset class="group">
        <legend>How hard was it? (RPE 1–10)</legend>
        <div class="row wrap">${rpeChips}</div>
      </fieldset>

      <button type="button" class="primary" data-action="log-save">Save</button>
    </section>
  `;
}

export function renderSaved() {
  return `
    <section class="saved">
      <h1>Session logged.</h1>
      <p class="hint">Your training history is up to date.</p>
      <button type="button" class="primary" data-action="back">Back to today</button>
    </section>
  `;
}
