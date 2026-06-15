import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadJSON } from './helpers/validate.js';

const FRAMEWORK = path.resolve(process.cwd(), 'framework');

test('framework/ contains all seven required files', () => {
  const required = [
    'CONTEXT.md',
    'session-schema.json',
    'exercise-library.json',
    'session-templates.json',
    'progression-rules.md',
    'load-balancing.md',
    'injury-routing.md',
    'rehab-protocols.json',
  ];
  for (const file of required) {
    assert.ok(
      fs.existsSync(path.join(FRAMEWORK, file)),
      `framework/${file} must exist`,
    );
  }
});

test('all framework JSON files are valid JSON', () => {
  for (const file of [
    'session-schema.json',
    'exercise-library.json',
    'session-templates.json',
    'rehab-protocols.json',
  ]) {
    assert.doesNotThrow(
      () => loadJSON(`framework/${file}`),
      `framework/${file} must be valid JSON`,
    );
  }
});

test('session-schema.json covers warm-up, main work, cooldown and metadata', () => {
  const schema = loadJSON('framework/session-schema.json');
  assert.equal(schema.type, 'object');
  const required = new Set(schema.required || []);
  for (const key of ['warmup', 'main', 'cooldown', 'metadata', 'rationale']) {
    assert.ok(required.has(key), `schema must require "${key}"`);
  }
  const md = schema.properties.metadata.properties;
  for (const key of ['modality', 'duration', 'equipmentProfile', 'readiness', 'date']) {
    assert.ok(key in md, `metadata must define "${key}"`);
  }
  // Modality enum must match the canonical glossary exactly.
  assert.deepEqual(
    [...md.modality.enum].sort(),
    ['bike', 'conditioning', 'run', 'swim', 'weights'],
  );
});

test('exercise-library.json: ≥60 exercises spanning all five modalities', () => {
  const lib = loadJSON('framework/exercise-library.json');
  assert.ok(Array.isArray(lib.exercises), 'library must have exercises[]');
  assert.ok(lib.exercises.length >= 60, `expected ≥60 exercises, got ${lib.exercises.length}`);

  const modalities = new Set(lib.exercises.map((e) => e.modality));
  for (const m of ['weights', 'run', 'swim', 'bike', 'conditioning']) {
    assert.ok(modalities.has(m), `library must cover modality "${m}"`);
  }

  const patterns = new Set(lib.exercises.flatMap((e) => e.movementPatterns || [e.movementPattern]));
  for (const p of ['push', 'pull', 'hinge', 'squat', 'carry', 'core', 'cardio']) {
    assert.ok(patterns.has(p), `library must cover movement pattern "${p}"`);
  }

  for (const ex of lib.exercises) {
    assert.ok(ex.name, 'exercise must have a name');
    assert.ok(ex.modality, `exercise ${ex.name} must have a modality`);
    assert.ok(ex.cue, `exercise ${ex.name} must have a one-line cue`);
    assert.ok(Array.isArray(ex.equipment), `exercise ${ex.name} must list equipment[]`);
    assert.equal(typeof ex.spineCandidate, 'boolean', `exercise ${ex.name} must declare spineCandidate`);
  }
});

test('exercise-library.json: enough variety for Home and Military equipment profiles', () => {
  const lib = loadJSON('framework/exercise-library.json');
  const homeOnly = lib.exercises.filter((e) =>
    e.equipment.every((k) => ['bodyweight', 'dumbbells', 'pull-up-bar', 'kettlebell', 'bench', 'mat', 'resistance-band', 'jump-rope', 'foam-roller', 'open-road', 'open-water', 'bike', 'pool', 'treadmill'].includes(k)),
  );
  assert.ok(homeOnly.length >= 30, `Home profile needs ≥30 usable exercises, got ${homeOnly.length}`);
});

test('session-templates.json: covers spine templates + cardio archetypes', () => {
  const tpl = loadJSON('framework/session-templates.json');
  assert.ok(tpl.weights, 'templates.weights required');
  for (const slot of ['upper-push', 'upper-pull', 'lower', 'full-body', 'conditioning']) {
    assert.ok(tpl.weights[slot], `weights template "${slot}" required`);
    const t = tpl.weights[slot];
    assert.ok(Array.isArray(t.spine) && t.spine.length > 0, `${slot}: spine[] required`);
    assert.ok(Array.isArray(t.accessories), `${slot}: accessories[] required`);
  }
  for (const m of ['run', 'swim', 'bike', 'conditioning']) {
    assert.ok(Array.isArray(tpl[m]) && tpl[m].length > 0, `cardio archetypes for "${m}" required`);
  }
  // Rotation cadence documented.
  assert.ok(tpl.rotation && tpl.rotation.accessoryWeeksMin && tpl.rotation.accessoryWeeksMax,
    'rotation cadence must be documented (accessoryWeeksMin/Max)');
  assert.equal(tpl.rotation.accessoryWeeksMin, 4);
  assert.equal(tpl.rotation.accessoryWeeksMax, 6);
});

test('session-templates.json: every referenced exercise exists in the library', () => {
  const tpl = loadJSON('framework/session-templates.json');
  const lib = loadJSON('framework/exercise-library.json');
  const known = new Set(lib.exercises.map((e) => e.name));

  const refs = [];
  for (const slot of Object.values(tpl.weights)) {
    refs.push(...slot.spine, ...slot.accessories);
  }
  for (const m of ['run', 'swim', 'bike', 'conditioning']) {
    for (const archetype of tpl[m]) {
      if (archetype.blocks) {
        for (const block of archetype.blocks) {
          if (block.exercise) refs.push(block.exercise);
        }
      }
    }
  }
  for (const name of refs) {
    assert.ok(known.has(name), `template references unknown exercise "${name}"`);
  }
});

test('progression-rules.md: contains the exact maths (no ambiguity)', () => {
  const md = fs.readFileSync(path.join(FRAMEWORK, 'progression-rules.md'), 'utf8');
  // +2.5 kg per successful session
  assert.match(md, /\+?\s*2\.5\s*kg/i, 'must specify +2.5 kg increment');
  // Two failures → stall → repeat
  assert.match(md, /two\s+(consecutive\s+)?fail|2\s+fail/i, 'must specify 2-failure stall trigger');
  // Three stalls → deload to 90%
  assert.match(md, /three\s+stalls|3\s+stalls/i, 'must specify 3-stall deload trigger');
  assert.match(md, /90\s*%/, 'must specify 90% deload weight');
  // Cardio progression discussed
  assert.match(md, /cardio/i, 'must cover cardio progression');
});

test('load-balancing.md: weekly caps, hard/easy spacing, readiness scaling', () => {
  const md = fs.readFileSync(path.join(FRAMEWORK, 'load-balancing.md'), 'utf8');
  assert.match(md, /weekly|per[- ]week/i, 'must specify weekly caps');
  assert.match(md, /readiness/i, 'must specify how readiness scales the day');
  assert.match(md, /hard|easy/i, 'must specify hard/easy spacing');
  assert.match(md, /training[- ]load/i, 'must define training-load computation');
});

test('injury-routing.md: covers knee, shoulder, lower-back, hip, ankle', () => {
  const md = fs.readFileSync(path.join(FRAMEWORK, 'injury-routing.md'), 'utf8').toLowerCase();
  for (const region of ['knee', 'shoulder', 'lower-back', 'hip', 'ankle']) {
    assert.ok(md.includes(region), `injury-routing must cover "${region}"`);
  }
});

test('rehab-protocols.json: ≥3 placeholder protocols marked placeholder:true', () => {
  const r = loadJSON('framework/rehab-protocols.json');
  assert.ok(Array.isArray(r.protocols), 'protocols[] required');
  assert.ok(r.protocols.length >= 3, 'must ship ≥3 protocols');
  for (const p of r.protocols) {
    assert.equal(p.placeholder, true, `protocol "${p.injury}" must be marked placeholder:true`);
    assert.ok(Array.isArray(p.exercises) && p.exercises.length > 0, 'protocol needs exercises[]');
    for (const ex of p.exercises) {
      assert.ok(ex.name && ex.cue, 'rehab exercise needs name + cue');
    }
  }
  const labels = r.protocols.map((p) => p.injury.toLowerCase());
  assert.ok(labels.some((l) => l.includes('knee')), 'must include knee protocol');
  assert.ok(labels.some((l) => l.includes('shoulder')), 'must include shoulder protocol');
  assert.ok(labels.some((l) => l.includes('back')), 'must include back protocol');
});
