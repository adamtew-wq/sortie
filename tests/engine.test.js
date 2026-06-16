// Deterministic engine acceptance tests.
//
// Maps to the acceptance criteria in issue #5:
//  - generateSession() callable, returns schema-valid JSON
//  - equipment filtering excludes exercises whose kit is absent
//  - spine-lift progression: +2.5 kg after success; 6 consecutive fails (3 stalls)
//    triggers a deload to 90% rounded to 2.5 kg
//  - niggle routing: knee niggle removes squat/hinge from main and inserts rehab
//  - readiness scaling: low readiness produces a shorter/lighter session
//  - modality selection: 3 recent weight sessions push the next pick to cardio
//
// The engine is a pure function so tests pass framework + data explicitly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSession } from '../app/engine/index.js';
import { loadJSON, validate } from './helpers/validate.js';

function loadFramework() {
  return {
    exerciseLibrary: loadJSON('framework/exercise-library.json'),
    sessionTemplates: loadJSON('framework/session-templates.json'),
    sessionSchema: loadJSON('framework/session-schema.json'),
    rehabProtocols: loadJSON('framework/rehab-protocols.json'),
  };
}

function loadData(overrides = {}) {
  return {
    equipment: loadJSON('data/equipment.json'),
    baselines: loadJSON('data/baselines.json'),
    attributes: loadJSON('data/attributes.json'),
    events: loadJSON('data/events.json'),
    niggles: loadJSON('data/niggles.json'),
    history: [],
    ...overrides,
  };
}

test('generateSession is a callable function returning a session object', () => {
  const session = generateSession(
    { date: '2026-06-16', equipmentProfile: 'Home', readiness: 4, timeBudget: 45 },
    loadFramework(),
    loadData(),
  );
  assert.equal(typeof session, 'object');
  for (const key of ['warmup', 'main', 'cooldown', 'rationale', 'metadata']) {
    assert.ok(key in session, `session must have "${key}"`);
  }
});

test('generated session validates against framework/session-schema.json', () => {
  const fw = loadFramework();
  const session = generateSession(
    { date: '2026-06-16', equipmentProfile: 'Home', readiness: 4, timeBudget: 45 },
    fw,
    loadData(),
  );
  const errors = validate(session, fw.sessionSchema);
  assert.equal(errors.length, 0, `schema errors:\n${errors.join('\n')}`);
});

test('equipment filter: no main-block exercise needs kit absent from the Home profile', () => {
  const fw = loadFramework();
  const data = loadData();
  const session = generateSession(
    {
      date: '2026-06-16', equipmentProfile: 'Home', readiness: 5, timeBudget: 60,
      forceModality: 'weights', forceSessionType: 'upper-push',
    },
    fw,
    data,
  );
  const allowed = new Set(data.equipment.profiles.Home.available);
  const byName = new Map(fw.exerciseLibrary.exercises.map((e) => [e.name, e]));
  const allBlocks = [...session.warmup, ...session.main, ...session.cooldown];
  for (const block of allBlocks) {
    const ex = byName.get(block.exercise);
    assert.ok(ex, `unknown exercise referenced: ${block.exercise}`);
    for (const key of ex.equipment) {
      assert.ok(
        allowed.has(key),
        `${block.exercise} needs "${key}" but Home profile lacks it`,
      );
    }
  }
});

test('spine progression: +2.5 kg after a successful prior session', () => {
  const fw = loadFramework();
  const data = loadData({
    history: [
      {
        date: '2026-06-13', modality: 'weights', sessionType: 'lower', duration: 60,
        exercises: [{ name: 'Back squat', sets: 4, reps: 5, load: 100, success: true }],
        rpe: 7,
      },
    ],
  });
  const session = generateSession(
    {
      date: '2026-06-16', equipmentProfile: 'Military', readiness: 5, timeBudget: 70,
      forceModality: 'weights', forceSessionType: 'lower',
    },
    fw,
    data,
  );
  const sq = session.main.find((b) => b.exercise === 'Back squat');
  assert.ok(sq, 'lower session must prescribe Back squat');
  assert.equal(sq.load, 102.5, 'load should advance by +2.5 kg after a successful session');
});

test('spine progression: 6 consecutive fails (3 stalls) deload to 90% rounded to 2.5 kg', () => {
  const fw = loadFramework();
  const history = Array.from({ length: 6 }, (_, i) => ({
    date: `2026-05-${String(10 + i).padStart(2, '0')}`,
    modality: 'weights', sessionType: 'lower', duration: 60,
    exercises: [{ name: 'Back squat', sets: 4, reps: 5, load: 100, success: false }],
    rpe: 9,
  }));
  const session = generateSession(
    {
      date: '2026-06-16', equipmentProfile: 'Military', readiness: 5, timeBudget: 70,
      forceModality: 'weights', forceSessionType: 'lower',
    },
    fw,
    loadData({ history }),
  );
  const sq = session.main.find((b) => b.exercise === 'Back squat');
  assert.ok(sq, 'lower session must prescribe Back squat');
  // 100 * 0.90 = 90; rounded to nearest 2.5 → 90.
  assert.equal(sq.load, 90, 'after 3 stalls load should deload to 90% (90 kg)');
});

test('spine progression: after 2 consecutive fails (one stall), repeat the same weight', () => {
  const fw = loadFramework();
  const history = [
    {
      date: '2026-06-10', modality: 'weights', sessionType: 'lower', duration: 60,
      exercises: [{ name: 'Back squat', sets: 4, reps: 5, load: 100, success: false }], rpe: 9,
    },
    {
      date: '2026-06-13', modality: 'weights', sessionType: 'lower', duration: 60,
      exercises: [{ name: 'Back squat', sets: 4, reps: 5, load: 100, success: false }], rpe: 9,
    },
  ];
  const session = generateSession(
    {
      date: '2026-06-16', equipmentProfile: 'Military', readiness: 5, timeBudget: 70,
      forceModality: 'weights', forceSessionType: 'lower',
    },
    fw,
    loadData({ history }),
  );
  const sq = session.main.find((b) => b.exercise === 'Back squat');
  assert.equal(sq.load, 100, 'one stall: repeat the same weight');
});

test('niggle routing: knee niggle removes squat/hinge from main and weaves rehab', () => {
  const fw = loadFramework();
  const session = generateSession(
    {
      date: '2026-06-16', equipmentProfile: 'Home', readiness: 4, timeBudget: 45,
      activeNiggles: [
        { region: 'knee', affectedPatterns: ['squat', 'hinge'], severity: 'mild', rehabProtocolId: 'knee-basic' },
      ],
    },
    fw,
    loadData(),
  );
  const byName = new Map(fw.exerciseLibrary.exercises.map((e) => [e.name, e]));
  const flagged = new Set(['squat', 'hinge']);
  for (const block of session.main) {
    const ex = byName.get(block.exercise);
    for (const p of ex.movementPatterns || []) {
      assert.ok(!flagged.has(p), `${block.exercise} loads flagged pattern "${p}"`);
    }
  }
  const allBlocks = [...session.warmup, ...session.main, ...session.cooldown];
  assert.ok(
    allBlocks.some((b) => b.rehab === true),
    'must weave rehab work (block.rehab === true) for an active niggle',
  );
});

test('readiness scaling: low readiness yields a lighter session than full readiness', () => {
  const fw = loadFramework();
  const data = loadData();
  const baseInputs = {
    date: '2026-06-16', equipmentProfile: 'Home', timeBudget: 60,
    forceModality: 'weights', forceSessionType: 'upper-push',
  };
  const high = generateSession({ ...baseInputs, readiness: 5 }, fw, data);
  const low = generateSession({ ...baseInputs, readiness: 2 }, fw, data);
  const sumSets = (s) => s.main.reduce((acc, b) => acc + (b.sets || 0), 0);
  assert.ok(
    low.metadata.duration <= high.metadata.duration,
    `low duration (${low.metadata.duration}) should be ≤ high (${high.metadata.duration})`,
  );
  assert.ok(
    sumSets(low) <= sumSets(high),
    `low total sets (${sumSets(low)}) should be ≤ high (${sumSets(high)})`,
  );
});

test('modality selection: three recent weight sessions bias the next pick away from weights', () => {
  const fw = loadFramework();
  const data = loadData({
    history: [
      {
        date: '2026-06-13', modality: 'weights', sessionType: 'upper-push', duration: 55,
        exercises: [{ name: 'Bench press', sets: 4, reps: 5, load: 80, success: true }], rpe: 7,
      },
      {
        date: '2026-06-14', modality: 'weights', sessionType: 'lower', duration: 60,
        exercises: [{ name: 'Back squat', sets: 4, reps: 5, load: 100, success: true }], rpe: 7,
      },
      {
        date: '2026-06-15', modality: 'weights', sessionType: 'upper-pull', duration: 55,
        exercises: [{ name: 'Weighted pull-up', sets: 4, reps: 5, load: 20, success: true }], rpe: 7,
      },
    ],
  });
  const session = generateSession(
    { date: '2026-06-16', equipmentProfile: 'Home', readiness: 4, timeBudget: 60 },
    fw,
    data,
  );
  assert.notEqual(
    session.metadata.modality,
    'weights',
    `expected a cardio/conditioning modality, got "${session.metadata.modality}"`,
  );
});

test('output metadata: date, modality, sessionType, equipmentProfile, readiness all populated', () => {
  const session = generateSession(
    { date: '2026-06-16', equipmentProfile: 'Home', readiness: 3, timeBudget: 40 },
    loadFramework(),
    loadData(),
  );
  assert.equal(session.metadata.date, '2026-06-16');
  assert.ok(['weights', 'run', 'swim', 'bike', 'conditioning'].includes(session.metadata.modality));
  assert.ok(session.metadata.sessionType && typeof session.metadata.sessionType === 'string');
  assert.equal(session.metadata.equipmentProfile, 'Home');
  assert.equal(session.metadata.readiness, 3);
  assert.ok(session.metadata.duration >= 5);
});
