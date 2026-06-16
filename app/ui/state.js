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

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function initialState() {
  return {
    stage: 'checkin',
    checkin: { energy: null, soreness: null, sleep: null },
    location: DEFAULT_LOCATION,
    overrides: { modality: null, timeBudget: null },
    suggestion: null,
    pickers: { focus: false, location: false, shorten: false },
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
      return { ...state, stage: 'logging' };
    case 'BACK_TO_CHECKIN':
      return { ...initialState(), location: state.location };
    default:
      return state;
  }
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

export function renderLogging() {
  return `
    <section class="logging">
      <h1>Logging — coming next slice</h1>
      <p>Tap-to-confirm logging is issue #7. For now, do the session and we'll capture it next.</p>
      <button type="button" data-action="back">Back to suggestion</button>
    </section>
  `;
}
