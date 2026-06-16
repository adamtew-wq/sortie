// Tests for the niggle/injury flagging UI + rehab auto-weave (issue #8).
//
// User can add, view, and clear niggles in a dedicated screen. Active niggles
// automatically weave the linked rehab protocol into the next suggestion's
// warm-up and exclude their affected movement patterns from the main work.
// A standalone rehab session can be generated and pushed through the logging
// flow exactly like a regular session.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState,
  reducer,
  renderCheckin,
  renderSuggestion,
  renderNiggles,
  renderRehab,
  mapCheckinToInputs,
  appendNiggle,
  loadLocalNiggles,
  NIGGLES_KEY,
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

function makeFakeStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    _dump: () => Object.fromEntries(store),
  };
}

const DATE = '2026-06-16';

function seededOnSuggestion() {
  const fw = loadFramework();
  const data = loadData();
  let s = initialState();
  s = reducer(s, { type: 'SET_ENERGY', payload: 5 });
  s = reducer(s, { type: 'SET_SORENESS', payload: 'none' });
  s = reducer(s, { type: 'SET_SLEEP', payload: 'good' });
  s = reducer(s, { type: 'SET_FOCUS', payload: 'weights' });
  s = reducer(s, { type: 'GO', framework: fw, data, date: DATE });
  return { s, fw, data };
}

test('initialState now carries a niggles list (managed separately from the soreness chip)', () => {
  const s = initialState();
  assert.ok(Array.isArray(s.niggles), 'state.niggles must be an array');
  assert.equal(s.niggles.length, 0, 'no niggles to start');
});

test('OPEN_NIGGLES transitions to the niggles management screen', () => {
  let s = initialState();
  s = reducer(s, { type: 'OPEN_NIGGLES' });
  assert.equal(s.stage, 'niggles');
});

test('ADD_NIGGLE adds an active niggle with id/label/region/severity/dateFlagged', () => {
  let s = initialState();
  s = reducer(s, {
    type: 'ADD_NIGGLE',
    payload: { label: 'Right knee tendinopathy', region: 'knee', severity: 'moderate' },
    date: DATE,
  });
  assert.equal(s.niggles.length, 1);
  const n = s.niggles[0];
  assert.equal(n.label, 'Right knee tendinopathy');
  assert.equal(n.region, 'knee');
  assert.equal(n.severity, 'moderate');
  assert.equal(n.dateFlagged, DATE);
  assert.equal(n.status, 'active');
  assert.ok(n.id, 'each niggle gets a unique id');
});

test('CLEAR_NIGGLE archives the niggle but preserves it in history (status=cleared)', () => {
  let s = initialState();
  s = reducer(s, {
    type: 'ADD_NIGGLE',
    payload: { label: 'Sore shoulder', region: 'shoulder', severity: 'mild' },
    date: DATE,
  });
  const id = s.niggles[0].id;
  s = reducer(s, { type: 'CLEAR_NIGGLE', payload: id, date: '2026-06-20' });
  assert.equal(s.niggles.length, 1, 'cleared niggles are kept (archived, not deleted)');
  assert.equal(s.niggles[0].status, 'cleared');
  assert.equal(s.niggles[0].clearedAt, '2026-06-20');
});

test('mapCheckinToInputs merges user-managed niggles with soreness-derived ones for the engine', () => {
  const inputs = mapCheckinToInputs(
    { energy: 4, soreness: 'none', sleep: 'good' },
    {
      location: 'Home',
      overrides: { modality: null, timeBudget: null },
      niggles: [
        { id: 'n1', label: 'Knee', region: 'knee', severity: 'mild', status: 'active' },
        { id: 'n2', label: 'Old shoulder', region: 'shoulder', severity: 'mild', status: 'cleared' },
      ],
    },
    DATE,
  );
  assert.ok(Array.isArray(inputs.activeNiggles));
  // Only the active one must be forwarded to the engine.
  assert.equal(inputs.activeNiggles.length, 1);
  assert.equal(inputs.activeNiggles[0].region, 'knee');
});

test('after adding a knee niggle, the next generated session weaves rehab and routes off knee', () => {
  const fw = loadFramework();
  const data = loadData();
  let s = initialState();
  // Add a knee niggle BEFORE the check-in.
  s = reducer(s, {
    type: 'ADD_NIGGLE',
    payload: { label: 'Right knee', region: 'knee', severity: 'mild' },
    date: DATE,
  });
  s = reducer(s, { type: 'SET_ENERGY', payload: 5 });
  s = reducer(s, { type: 'SET_SORENESS', payload: 'none' });
  s = reducer(s, { type: 'SET_SLEEP', payload: 'good' });
  s = reducer(s, { type: 'SET_FOCUS', payload: 'weights' });
  s = reducer(s, { type: 'GO', framework: fw, data, date: DATE });

  const allBlocks = [
    ...s.suggestion.warmup,
    ...s.suggestion.main,
    ...s.suggestion.cooldown,
  ];
  assert.ok(
    allBlocks.some((b) => b.rehab === true),
    'a knee niggle must weave the knee-basic rehab protocol into the session',
  );
  const byName = new Map(fw.exerciseLibrary.exercises.map((e) => [e.name, e]));
  for (const b of s.suggestion.main) {
    const ex = byName.get(b.exercise);
    if (!ex) continue;
    const patterns = ex.movementPatterns || [];
    assert.ok(
      !patterns.includes('squat'),
      `${b.exercise} loads "squat" but the user has an active knee niggle`,
    );
  }
});

test('clearing a niggle removes rehab work from the next suggestion', () => {
  const fw = loadFramework();
  const data = loadData();
  let s = initialState();
  s = reducer(s, {
    type: 'ADD_NIGGLE',
    payload: { label: 'Right knee', region: 'knee', severity: 'mild' },
    date: DATE,
  });
  const id = s.niggles[0].id;
  s = reducer(s, { type: 'CLEAR_NIGGLE', payload: id, date: DATE });
  s = reducer(s, { type: 'SET_ENERGY', payload: 5 });
  s = reducer(s, { type: 'SET_SORENESS', payload: 'none' });
  s = reducer(s, { type: 'SET_SLEEP', payload: 'good' });
  s = reducer(s, { type: 'SET_FOCUS', payload: 'weights' });
  s = reducer(s, { type: 'GO', framework: fw, data, date: DATE });

  const allBlocks = [
    ...s.suggestion.warmup,
    ...s.suggestion.main,
    ...s.suggestion.cooldown,
  ];
  assert.ok(
    !allBlocks.some((b) => b.rehab === true),
    'cleared niggles must not produce rehab blocks',
  );
});

test('rationale reflects the active niggle on the suggestion screen', () => {
  const fw = loadFramework();
  const data = loadData();
  let s = initialState();
  s = reducer(s, {
    type: 'ADD_NIGGLE',
    payload: { label: 'Right knee', region: 'knee', severity: 'mild' },
    date: DATE,
  });
  s = reducer(s, { type: 'SET_ENERGY', payload: 5 });
  s = reducer(s, { type: 'SET_SORENESS', payload: 'none' });
  s = reducer(s, { type: 'SET_SLEEP', payload: 'good' });
  s = reducer(s, { type: 'SET_FOCUS', payload: 'weights' });
  s = reducer(s, { type: 'GO', framework: fw, data, date: DATE });
  assert.match(s.suggestion.rationale, /knee/i,
    'rationale must mention the active niggle so the user knows why work was rerouted');
});

test('renderSuggestion: persistent "Niggles active" indicator with a tap to review', () => {
  const fw = loadFramework();
  const data = loadData();
  let s = initialState();
  s = reducer(s, {
    type: 'ADD_NIGGLE',
    payload: { label: 'Right knee', region: 'knee', severity: 'mild' },
    date: DATE,
  });
  s = reducer(s, { type: 'SET_ENERGY', payload: 5 });
  s = reducer(s, { type: 'SET_SORENESS', payload: 'none' });
  s = reducer(s, { type: 'SET_SLEEP', payload: 'good' });
  s = reducer(s, { type: 'SET_FOCUS', payload: 'weights' });
  s = reducer(s, { type: 'GO', framework: fw, data, date: DATE });
  const html = renderSuggestion(s);
  assert.match(html, /class=["'][^"']*niggle-banner/, 'suggestion must show a niggle banner');
  assert.match(html, /data-action=["']open-niggles["']/,
    'banner must be tap-to-review (opens the niggles screen)');
  assert.match(html, /niggles active/i, 'banner copy must say "Niggles active"');
});

test('renderSuggestion: no banner when there are no active niggles', () => {
  const { s } = seededOnSuggestion();
  const html = renderSuggestion(s);
  assert.doesNotMatch(html, /class=["'][^"']*niggle-banner/,
    'no banner should render when nothing is active');
});

test('renderNiggles: shows add form (region selector + severity), list, Clear, View protocol, Back', () => {
  let s = initialState();
  s = reducer(s, {
    type: 'ADD_NIGGLE',
    payload: { label: 'Right knee tendinopathy', region: 'knee', severity: 'moderate' },
    date: DATE,
  });
  s = reducer(s, { type: 'OPEN_NIGGLES' });
  const html = renderNiggles(s, loadFramework());
  // Add form
  for (const r of ['knee', 'shoulder', 'lower-back', 'hip', 'ankle', 'other']) {
    assert.match(html, new RegExp(`data-niggle-region=["']${r}["']`), `must offer region=${r}`);
  }
  for (const sev of ['mild', 'moderate', 'significant']) {
    assert.match(html, new RegExp(`data-niggle-severity=["']${sev}["']`), `must offer severity=${sev}`);
  }
  assert.match(html, /data-action=["']add-niggle["']/, 'must include Add niggle button');
  // List of active niggles
  assert.match(html, /Right knee tendinopathy/, 'must list the niggle by label');
  assert.match(html, /data-action=["']clear-niggle["']/, 'must offer Clear');
  assert.match(html, /data-action=["']view-protocol["']/, 'must offer View protocol');
  // Back navigation
  assert.match(html, /data-action=["']close-niggles["']/, 'must offer a way back');
});

test('OPEN_REHAB transitions to the rehab screen carrying the protocol id', () => {
  let s = initialState();
  s = reducer(s, { type: 'OPEN_REHAB', payload: 'knee-basic' });
  assert.equal(s.stage, 'rehab');
  assert.equal(s.rehab.protocolId, 'knee-basic');
});

test('renderRehab: protocol name, injury label, exercise list with cues, Run standalone, Back', () => {
  let s = initialState();
  s = reducer(s, { type: 'OPEN_REHAB', payload: 'knee-basic' });
  const html = renderRehab(s, loadFramework());
  assert.match(html, /Knee/i, 'protocol injury label must be visible');
  assert.match(html, /Glute bridge/, 'lists at least one knee-basic exercise');
  assert.match(html, /Heels close/i, 'shows the cue for the exercise');
  assert.match(html, /data-action=["']run-rehab["']/, 'Run as standalone session button required');
  assert.match(html, /data-action=["']close-rehab["']/, 'Back navigation required');
});

test('RUN_REHAB_STANDALONE seeds a logging session built from the rehab protocol', () => {
  const fw = loadFramework();
  const data = loadData();
  let s = initialState();
  s = reducer(s, {
    type: 'RUN_REHAB_STANDALONE',
    payload: 'knee-basic',
    framework: fw,
    data,
    date: DATE,
    startedAt: 1_700_000_000_000,
  });
  assert.equal(s.stage, 'logging', 'standalone rehab drops straight into the logging flow');
  assert.ok(s.suggestion, 'must seed a suggestion so logging can summarise it');
  assert.equal(s.suggestion.metadata.sessionType, 'rehab');
  assert.ok(s.suggestion.main.length > 0, 'rehab session has at least one main block');
  for (const b of s.suggestion.main) {
    assert.equal(b.rehab, true, 'every block in a standalone rehab is rehab-tagged');
  }
});

test('appendNiggle persists to localStorage; loadLocalNiggles reads it back', () => {
  const storage = makeFakeStorage();
  const niggle = {
    id: 'n-1',
    label: 'Right knee',
    region: 'knee',
    severity: 'mild',
    dateFlagged: DATE,
    status: 'active',
  };
  appendNiggle(niggle, storage);
  const stored = storage.getItem(NIGGLES_KEY);
  assert.ok(stored, 'niggles must be persisted under NIGGLES_KEY');
  const loaded = loadLocalNiggles(storage);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'n-1');
});

test('ADD_NIGGLE persists to the injected storage when one is provided', () => {
  const storage = makeFakeStorage();
  let s = initialState();
  s = reducer(s, {
    type: 'ADD_NIGGLE',
    payload: { label: 'Knee', region: 'knee', severity: 'mild' },
    date: DATE,
    storage,
  });
  const loaded = loadLocalNiggles(storage);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].region, 'knee');
  assert.equal(loaded[0].status, 'active');
});

test('CLEAR_NIGGLE persists the cleared status to the injected storage', () => {
  const storage = makeFakeStorage();
  let s = initialState();
  s = reducer(s, {
    type: 'ADD_NIGGLE',
    payload: { label: 'Knee', region: 'knee', severity: 'mild' },
    date: DATE,
    storage,
  });
  const id = s.niggles[0].id;
  s = reducer(s, { type: 'CLEAR_NIGGLE', payload: id, date: '2026-06-20', storage });
  const loaded = loadLocalNiggles(storage);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].status, 'cleared');
  assert.equal(loaded[0].clearedAt, '2026-06-20');
});
