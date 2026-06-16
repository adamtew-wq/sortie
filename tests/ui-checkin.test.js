// Tests for the daily-loop UI: the check-in screen, the suggestion screen,
// the override bar and the location picker (issue #6).
//
// The UI is split into two layers so it stays testable without a DOM:
//   - app/ui/state.js  — pure state + reducer + render helpers (HTML strings)
//   - app/app.js       — wires DOM events to the reducer
// These tests exercise the state machine and assert the HTML the renderers
// produce. DOM wiring is asserted via tests/ui-shell.test.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState,
  reducer,
  mapCheckinToInputs,
  renderCheckin,
  renderSuggestion,
} from '../app/ui/state.js';
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

test('initial state lands on the check-in screen with no answers yet', () => {
  const s = initialState();
  assert.equal(s.stage, 'checkin');
  assert.equal(s.checkin.energy, null);
  assert.equal(s.checkin.soreness, null);
  assert.equal(s.checkin.sleep, null);
  assert.equal(s.suggestion, null);
});

test('check-in is three taps + Go — no typing — and advances to the suggestion', () => {
  let s = initialState();
  s = reducer(s, { type: 'SET_ENERGY', payload: 4 });
  s = reducer(s, { type: 'SET_SORENESS', payload: 'none' });
  s = reducer(s, { type: 'SET_SLEEP', payload: 'good' });
  s = reducer(s, { type: 'GO', framework: loadFramework(), data: loadData(), date: DATE });
  assert.equal(s.stage, 'suggestion');
  assert.ok(s.suggestion, 'suggestion must be populated after GO');
  assert.ok(s.suggestion.metadata, 'engine output must include metadata');
  assert.equal(s.suggestion.metadata.date, DATE);
});

test('mapCheckinToInputs: sleep modulates readiness; soreness emits niggles', () => {
  // Energy 2, poor sleep → readiness clamps low; lower soreness → knee niggle.
  const inputs = mapCheckinToInputs(
    { energy: 2, soreness: 'lower', sleep: 'poor' },
    { location: 'Home', overrides: { modality: null, timeBudget: null } },
    DATE,
  );
  assert.equal(inputs.readiness, 1, 'energy 2 - poor sleep (-1) → readiness 1');
  assert.ok(Array.isArray(inputs.activeNiggles));
  assert.ok(
    inputs.activeNiggles.length > 0,
    'lower soreness must emit at least one niggle so the engine routes around it',
  );
  // Full readiness ceiling — energy 5 + good sleep stays at 5, not 6.
  const high = mapCheckinToInputs(
    { energy: 5, soreness: 'none', sleep: 'good' },
    { location: 'Home', overrides: { modality: null, timeBudget: null } },
    DATE,
  );
  assert.equal(high.readiness, 5, 'readiness must clamp to 5');
});

test('mapCheckinToInputs: ad-hoc location passes the equipment list through to the engine', () => {
  const inputs = mapCheckinToInputs(
    { energy: 4, soreness: 'none', sleep: 'ok' },
    {
      location: { kind: 'adhoc', equipment: ['bodyweight', 'mat'] },
      overrides: { modality: null, timeBudget: null },
    },
    DATE,
  );
  assert.deepEqual(inputs.equipmentProfile, ['bodyweight', 'mat']);
});

test('regenerate with a different focus produces a visibly different session', () => {
  const fw = loadFramework();
  const data = loadData();
  let s = initialState();
  s = reducer(s, { type: 'SET_ENERGY', payload: 5 });
  s = reducer(s, { type: 'SET_SORENESS', payload: 'none' });
  s = reducer(s, { type: 'SET_SLEEP', payload: 'good' });
  s = reducer(s, { type: 'GO', framework: fw, data, date: DATE });
  const firstModality = s.suggestion.metadata.modality;
  const newFocus = firstModality === 'weights' ? 'run' : 'weights';
  s = reducer(s, { type: 'SET_FOCUS', payload: newFocus });
  s = reducer(s, { type: 'REGENERATE', framework: fw, data, date: DATE });
  assert.equal(s.suggestion.metadata.modality, newFocus, 'focus override must force the modality');
  assert.notEqual(
    s.suggestion.metadata.modality,
    firstModality,
    'regenerate with a different focus must produce a different modality',
  );
});

test('ad-hoc location restricts the generated session to the ticked equipment only', () => {
  const fw = loadFramework();
  const allowedKeys = ['bodyweight', 'mat', 'pull-up-bar'];
  let s = initialState();
  s = reducer(s, { type: 'SET_ENERGY', payload: 4 });
  s = reducer(s, { type: 'SET_SORENESS', payload: 'none' });
  s = reducer(s, { type: 'SET_SLEEP', payload: 'good' });
  s = reducer(s, {
    type: 'SET_LOCATION',
    payload: { kind: 'adhoc', equipment: allowedKeys },
  });
  // Force weights so we have a deterministic non-empty session even with a tiny kit.
  s = reducer(s, { type: 'SET_FOCUS', payload: 'weights' });
  s = reducer(s, { type: 'GO', framework: fw, data: loadData(), date: DATE });
  const allowed = new Set(allowedKeys);
  const byName = new Map(fw.exerciseLibrary.exercises.map((e) => [e.name, e]));
  const allBlocks = [
    ...s.suggestion.warmup,
    ...s.suggestion.main,
    ...s.suggestion.cooldown,
  ];
  assert.ok(allBlocks.length > 0, 'ad-hoc kit should still produce some main work');
  for (const b of allBlocks) {
    const ex = byName.get(b.exercise);
    assert.ok(ex, `unknown exercise: ${b.exercise}`);
    for (const k of ex.equipment) {
      assert.ok(allowed.has(k), `${b.exercise} needs "${k}" but ad-hoc subset lacks it`);
    }
  }
  assert.equal(s.suggestion.metadata.equipmentProfile, 'ad-hoc');
});

test('shorten override caps duration on regenerate', () => {
  const fw = loadFramework();
  const data = loadData();
  let s = initialState();
  s = reducer(s, { type: 'SET_ENERGY', payload: 5 });
  s = reducer(s, { type: 'SET_SORENESS', payload: 'none' });
  s = reducer(s, { type: 'SET_SLEEP', payload: 'good' });
  s = reducer(s, { type: 'GO', framework: fw, data, date: DATE });
  s = reducer(s, { type: 'SHORTEN', payload: 20 });
  s = reducer(s, { type: 'REGENERATE', framework: fw, data, date: DATE });
  assert.ok(
    s.suggestion.metadata.duration <= 20,
    `shortened session must respect 20-min cap, got ${s.suggestion.metadata.duration}`,
  );
});

test('Start moves to the logging stage (placeholder until the next slice)', () => {
  const fw = loadFramework();
  const data = loadData();
  let s = initialState();
  s = reducer(s, { type: 'SET_ENERGY', payload: 4 });
  s = reducer(s, { type: 'SET_SORENESS', payload: 'none' });
  s = reducer(s, { type: 'SET_SLEEP', payload: 'good' });
  s = reducer(s, { type: 'GO', framework: fw, data, date: DATE });
  s = reducer(s, { type: 'START' });
  assert.equal(s.stage, 'logging');
});

test('renderCheckin: offers Energy 1–5, soreness regions, sleep options, Go — no text input', () => {
  const html = renderCheckin(initialState());
  for (const n of [1, 2, 3, 4, 5]) {
    assert.match(html, new RegExp(`data-energy=["']${n}["']`), `must offer energy=${n}`);
  }
  for (const r of ['none', 'upper', 'lower', 'full']) {
    assert.match(html, new RegExp(`data-soreness=["']${r}["']`), `must offer soreness=${r}`);
  }
  for (const v of ['poor', 'ok', 'good']) {
    assert.match(html, new RegExp(`data-sleep=["']${v}["']`), `must offer sleep=${v}`);
  }
  assert.match(html, /data-action=["']go["']/, 'must include a Go button');
  // No-typing rule: ban free-form inputs from the check-in screen.
  assert.doesNotMatch(html, /<input\b[^>]*type=["']?(text|number|search|email)/i,
    'check-in must not require typing');
  assert.doesNotMatch(html, /<textarea\b/i, 'check-in must not require typing');
});

test('renderCheckin: reflects selected answers so the user sees what they have picked', () => {
  let s = initialState();
  s = reducer(s, { type: 'SET_ENERGY', payload: 3 });
  s = reducer(s, { type: 'SET_SORENESS', payload: 'lower' });
  s = reducer(s, { type: 'SET_SLEEP', payload: 'ok' });
  const html = renderCheckin(s);
  assert.match(html, /data-energy=["']3["'][^>]*aria-pressed=["']true["']/,
    'selected energy must be marked aria-pressed');
  assert.match(html, /data-soreness=["']lower["'][^>]*aria-pressed=["']true["']/,
    'selected soreness must be marked aria-pressed');
  assert.match(html, /data-sleep=["']ok["'][^>]*aria-pressed=["']true["']/,
    'selected sleep must be marked aria-pressed');
});

test('renderSuggestion: badge + duration + rationale + collapsible warmup/cooldown + override bar', () => {
  const fw = loadFramework();
  const data = loadData();
  let s = initialState();
  s = reducer(s, { type: 'SET_ENERGY', payload: 4 });
  s = reducer(s, { type: 'SET_SORENESS', payload: 'none' });
  s = reducer(s, { type: 'SET_SLEEP', payload: 'good' });
  s = reducer(s, { type: 'GO', framework: fw, data, date: DATE });
  const html = renderSuggestion(s);
  assert.match(html, /class=["'][^"']*modality-badge/, 'modality badge required');
  assert.match(html, /class=["'][^"']*duration/, 'duration required');
  assert.match(html, /class=["'][^"']*rationale/, 'rationale required');
  // Warm-up and cooldown collapse via <details>; main work is always shown.
  assert.match(html, /<details[^>]*data-block=["']warmup["']/, 'warmup must be a <details>');
  assert.match(html, /<details[^>]*data-block=["']cooldown["']/, 'cooldown must be a <details>');
  assert.match(html, /data-block=["']main["']/, 'main work section required');
  // Override bar — all four controls + Start session.
  for (const action of ['change-focus', 'change-location', 'shorten', 'regenerate', 'start']) {
    assert.match(html, new RegExp(`data-action=["']${action}["']`), `missing override: ${action}`);
  }
  // Rationale text from the engine must be present verbatim.
  assert.ok(
    html.includes(s.suggestion.rationale.split(' — ')[0]),
    `engine rationale must appear in rendered suggestion`,
  );
});

test('renderSuggestion: rehab blocks are visually distinguished from regular blocks', () => {
  const fw = loadFramework();
  const data = loadData();
  let s = initialState();
  s = reducer(s, { type: 'SET_ENERGY', payload: 4 });
  // Upper soreness → shoulder niggle → shoulder-basic rehab woven into warm-up.
  s = reducer(s, { type: 'SET_SORENESS', payload: 'upper' });
  s = reducer(s, { type: 'SET_SLEEP', payload: 'good' });
  s = reducer(s, { type: 'SET_FOCUS', payload: 'weights' });
  s = reducer(s, { type: 'GO', framework: fw, data, date: DATE });
  const allBlocks = [...s.suggestion.warmup, ...s.suggestion.main, ...s.suggestion.cooldown];
  assert.ok(
    allBlocks.some((b) => b.rehab === true),
    'shoulder soreness must weave a rehab block (precondition for the renderer test)',
  );
  const html = renderSuggestion(s);
  assert.match(html, /class=["'][^"']*\brehab\b/, 'rehab blocks must carry a "rehab" class');
});
