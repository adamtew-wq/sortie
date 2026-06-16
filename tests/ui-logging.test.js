// Tests for the tap-to-confirm logging flow (issue #7).
//
// The logging slice picks up where the suggestion screen leaves off: each
// main-work block becomes a checklist of prescribed sets the user confirms
// with a tap. The state machine is pure so it stays testable without a DOM;
// app.js wires the actual clicks. A completed Session is serialised to a
// `history.jsonl` entry in `localStorage` whose shape lines up with what the
// engine reads back (so progression actually advances after a logged session).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState,
  reducer,
  renderLogging,
  renderSummary,
  renderSaved,
  buildLogEntry,
  appendHistoryEntry,
  loadLocalHistory,
} from '../app/ui/state.js';
import { computeSpineState } from '../app/engine/index.js';
import { loadJSON } from './helpers/validate.js';

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
    niggles: [],
    history: [],
    ...overrides,
  };
}

const DATE = '2026-06-16';
const T0 = 1_700_000_000_000;

function seededLogging({ history = [], date = DATE } = {}) {
  const fw = loadFramework();
  const data = loadData({ history });
  let s = initialState();
  s = reducer(s, { type: 'SET_ENERGY', payload: 5 });
  s = reducer(s, { type: 'SET_SORENESS', payload: 'none' });
  s = reducer(s, { type: 'SET_SLEEP', payload: 'good' });
  s = reducer(s, { type: 'SET_FOCUS', payload: 'weights' });
  s = reducer(s, { type: 'GO', framework: fw, data, date });
  s = reducer(s, { type: 'START', startedAt: T0 });
  return s;
}

function makeFakeStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    _dump: () => Object.fromEntries(store),
  };
}

test('START seeds logging state from the suggestion (an actuals row per main block)', () => {
  const s = seededLogging();
  assert.equal(s.stage, 'logging');
  assert.ok(s.logging, 'logging substate must be initialised');
  assert.ok(Array.isArray(s.logging.actuals));
  assert.equal(s.logging.actuals.length, s.suggestion.main.length);
  assert.equal(s.logging.exerciseIndex, 0);
  assert.equal(s.logging.setIndex, 0);
  assert.equal(s.logging.startedAt, T0);
  const first = s.logging.actuals[0];
  assert.equal(first.name, s.suggestion.main[0].exercise);
  assert.equal(first.skippedExercise, false);
  assert.ok(first.sets.length >= 1, 'each exercise gets at least one trackable set');
  for (const set of first.sets) {
    assert.equal(set.done, false, 'sets start as not-done');
    assert.equal(set.skipped, false);
  }
});

test('LOG_DONE_SET advances through sets then to the next exercise (sub-200ms by being pure state)', () => {
  let s = seededLogging();
  const firstEx = s.logging.actuals[0];
  for (let i = 0; i < firstEx.sets.length; i++) {
    assert.equal(s.logging.exerciseIndex, 0);
    assert.equal(s.logging.setIndex, i);
    s = reducer(s, { type: 'LOG_DONE_SET' });
  }
  // Falls through into next exercise
  if (s.logging.actuals.length > 1) {
    assert.equal(s.logging.exerciseIndex, 1);
    assert.equal(s.logging.setIndex, 0);
  } else {
    assert.equal(s.stage, 'summary');
  }
  for (const set of s.logging.actuals[0].sets) assert.equal(set.done, true);
});

test('LOG_EDIT_SET updates load and reps in place (one tap, no extra confirm)', () => {
  let s = seededLogging();
  s = reducer(s, {
    type: 'LOG_EDIT_SET',
    payload: { exerciseIndex: 0, setIndex: 0, reps: 6, load: 82.5 },
  });
  assert.equal(s.logging.actuals[0].sets[0].reps, 6);
  assert.equal(s.logging.actuals[0].sets[0].load, 82.5);
  assert.equal(s.logging.actuals[0].sets[0].done, false,
    'editing does not auto-confirm; the user still taps Done');
});

test('LOG_SKIP_EXERCISE flags the exercise skipped and jumps to the next one', () => {
  let s = seededLogging();
  const startEx = s.logging.exerciseIndex;
  s = reducer(s, { type: 'LOG_SKIP_EXERCISE' });
  assert.equal(s.logging.actuals[startEx].skippedExercise, true);
  if (s.logging.actuals.length > 1) {
    assert.equal(s.logging.exerciseIndex, startEx + 1);
    assert.equal(s.logging.setIndex, 0);
  } else {
    assert.equal(s.stage, 'summary');
  }
});

test('Done on the very last set transitions to the summary screen', () => {
  let s = seededLogging();
  for (const ex of s.logging.actuals) {
    for (let i = 0; i < ex.sets.length; i++) {
      s = reducer(s, { type: 'LOG_DONE_SET' });
    }
  }
  assert.equal(s.stage, 'summary');
});

test('LOG_END_EARLY jumps straight to summary and preserves only completed sets', () => {
  let s = seededLogging();
  s = reducer(s, { type: 'LOG_DONE_SET' }); // first set of first exercise
  s = reducer(s, { type: 'LOG_END_EARLY' });
  assert.equal(s.stage, 'summary');
  assert.equal(s.logging.endedEarly, true);
  assert.equal(s.logging.actuals[0].sets[0].done, true);
  if (s.logging.actuals[0].sets.length > 1) {
    assert.equal(s.logging.actuals[0].sets[1].done, false,
      'an early end must NOT auto-mark incomplete sets as done');
  }
});

test('LOG_SET_RPE captures the session RPE (1–10)', () => {
  let s = seededLogging();
  s = reducer(s, { type: 'LOG_END_EARLY' });
  s = reducer(s, { type: 'LOG_SET_RPE', payload: 7 });
  assert.equal(s.logging.rpe, 7);
});

test('buildLogEntry produces a history record the engine can read (date/modality/duration/exercises)', () => {
  let s = seededLogging();
  for (const ex of s.logging.actuals) {
    for (let i = 0; i < ex.sets.length; i++) {
      s = reducer(s, { type: 'LOG_DONE_SET' });
    }
  }
  s = reducer(s, { type: 'LOG_SET_RPE', payload: 6 });
  const entry = buildLogEntry(s, T0 + 45 * 60 * 1000);
  assert.equal(entry.date, DATE);
  assert.equal(entry.modality, s.suggestion.metadata.modality);
  assert.equal(entry.sessionType, s.suggestion.metadata.sessionType);
  assert.equal(entry.equipmentProfile, s.suggestion.metadata.equipmentProfile);
  assert.equal(entry.rpe, 6);
  assert.equal(entry.duration, 45, 'duration must reflect elapsed minutes from startedAt → endedAt');
  assert.ok(Array.isArray(entry.exercises));
  assert.ok(entry.exercises.length > 0);
  for (const ex of entry.exercises) {
    assert.equal(typeof ex.name, 'string');
    assert.equal(typeof ex.success, 'boolean');
    assert.equal(ex.success, true, 'fully-completed sets must read as success=true');
  }
});

test('partial session: end-early truncates exercises and marks them success=false', () => {
  let s = seededLogging();
  s = reducer(s, { type: 'LOG_DONE_SET' }); // 1 set of 1st exercise only
  s = reducer(s, { type: 'LOG_END_EARLY' });
  s = reducer(s, { type: 'LOG_SET_RPE', payload: 4 });
  const entry = buildLogEntry(s, T0 + 9 * 60 * 1000);
  assert.equal(entry.endedEarly, true);
  assert.equal(entry.duration, 9);
  assert.equal(entry.exercises[0].success, false,
    'an exercise with un-confirmed sets must not count as a successful spine progression');
});

test('appendHistoryEntry writes JSONL to localStorage; loadLocalHistory reads it back', () => {
  const storage = makeFakeStorage();
  let s = seededLogging();
  for (const ex of s.logging.actuals) {
    for (let i = 0; i < ex.sets.length; i++) {
      s = reducer(s, { type: 'LOG_DONE_SET' });
    }
  }
  s = reducer(s, { type: 'LOG_SET_RPE', payload: 7 });
  const entry = buildLogEntry(s, T0 + 30 * 60 * 1000);
  appendHistoryEntry(entry, storage);

  const raw = storage.getItem('sortie.history');
  assert.ok(raw, 'sortie.history must be persisted');
  const lines = raw.split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]).date, DATE);

  // Append a second entry on a new line — never rewrite existing lines.
  appendHistoryEntry({ ...entry, date: '2026-06-17' }, storage);
  const history = loadLocalHistory(storage);
  assert.equal(history.length, 2);
  assert.equal(history[0].date, DATE);
  assert.equal(history[1].date, '2026-06-17');
});

test('engine reads the logged entry back and advances spine progression on the next session', () => {
  // Day 1: log a successful weights session.
  let s = seededLogging();
  for (const ex of s.logging.actuals) {
    for (let i = 0; i < ex.sets.length; i++) {
      s = reducer(s, { type: 'LOG_DONE_SET' });
    }
  }
  s = reducer(s, { type: 'LOG_SET_RPE', payload: 6 });
  const entry = buildLogEntry(s, T0 + 45 * 60 * 1000);

  // Pick a spine lift that was logged with a numeric load (no RPE-based ones).
  const loggedSpine = entry.exercises.find(
    (e) => e.success && typeof e.load === 'number',
  );
  assert.ok(loggedSpine, 'precondition: at least one numeric-load successful spine lift');

  // computeSpineState is what the engine walks at the start of generation. If
  // it reads our entry as a successful set, the working weight should advance
  // by +2.5 kg vs. the baselines-only state (per progression-rules.md).
  const baselines = loadJSON('data/baselines.json');
  const baseline = computeSpineState(loggedSpine.name, baselines, []);
  const next = computeSpineState(loggedSpine.name, baselines, [entry]);
  assert.equal(
    next.weight,
    baseline.weight + 2.5,
    `progression must advance: ${baseline.weight} → ${next.weight} for ${loggedSpine.name}`,
  );
});

test('renderLogging: current exercise name, set counter, prescribed load, Done/Skip/End buttons', () => {
  const s = seededLogging();
  const html = renderLogging(s);
  const cur = s.logging.actuals[0];
  assert.ok(html.includes(cur.name), 'current exercise name must be visible');
  const totalSets = cur.sets.length;
  assert.match(html, new RegExp(`Set\\s+1\\s+of\\s+${totalSets}`, 'i'),
    'set counter must read "Set 1 of N"');
  assert.match(html, /data-action=["']log-done["']/, 'Done ✓ tap target required');
  assert.match(html, /data-action=["']log-skip["']/, 'Skip exercise required');
  assert.match(html, /data-action=["']log-end-early["']/, 'End session early required');
  // Edit affordances — bump load / reps in a single tap (≤ 2 taps to edit).
  assert.match(html, /data-edit-load=["'](?:up|down)["']/, 'inline load adjuster required');
  assert.match(html, /data-edit-reps=["'](?:up|down)["']/, 'inline reps adjuster required');
});

test('renderSummary: lists exercises + offers 1–10 RPE + Save', () => {
  let s = seededLogging();
  s = reducer(s, { type: 'LOG_DONE_SET' });
  s = reducer(s, { type: 'LOG_END_EARLY' });
  const html = renderSummary(s);
  assert.ok(html.includes(s.logging.actuals[0].name),
    'summary must list each completed exercise by name');
  for (let n = 1; n <= 10; n++) {
    assert.match(html, new RegExp(`data-rpe=["']${n}["']`), `must offer rpe=${n}`);
  }
  assert.match(html, /data-action=["']log-save["']/, 'Save button required');
});

test('renderSaved: confirms "Session logged." after Save', () => {
  const html = renderSaved();
  assert.match(html, /Session logged/i);
});

test('LOG_SAVE persists the entry via the injected storage and lands on the saved stage', () => {
  const storage = makeFakeStorage();
  let s = seededLogging();
  for (const ex of s.logging.actuals) {
    for (let i = 0; i < ex.sets.length; i++) {
      s = reducer(s, { type: 'LOG_DONE_SET' });
    }
  }
  s = reducer(s, { type: 'LOG_SET_RPE', payload: 8 });
  s = reducer(s, { type: 'LOG_SAVE', endedAt: T0 + 50 * 60 * 1000, storage });
  assert.equal(s.stage, 'saved');
  const persisted = loadLocalHistory(storage);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].rpe, 8);
  assert.equal(persisted[0].duration, 50);
});
