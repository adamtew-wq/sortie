// Sortie PWA entry point. Boots offline-first: registers the service worker,
// loads framework + data via fetch, then drives the daily loop (check-in →
// suggestion → start) by dispatching actions into ui/state.js.

import {
  initialState,
  reducer,
  renderCheckin,
  renderSuggestion,
  renderLogging,
} from './ui/state.js';

let state = initialState();
let framework = null;
let data = null;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return res.json();
}

async function fetchHistory(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return [];
    const text = await res.text();
    return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function loadResources() {
  const base = '..'; // app/ is one level deep; framework/ and data/ are siblings of app/.
  const [
    exerciseLibrary, sessionTemplates, sessionSchema, rehabProtocols,
    equipment, baselines, attributes, events, niggles, history,
  ] = await Promise.all([
    fetchJSON(`${base}/framework/exercise-library.json`),
    fetchJSON(`${base}/framework/session-templates.json`),
    fetchJSON(`${base}/framework/session-schema.json`),
    fetchJSON(`${base}/framework/rehab-protocols.json`),
    fetchJSON(`${base}/data/equipment.json`),
    fetchJSON(`${base}/data/baselines.json`),
    fetchJSON(`${base}/data/attributes.json`),
    fetchJSON(`${base}/data/events.json`),
    fetchJSON(`${base}/data/niggles.json`),
    fetchHistory(`${base}/data/history.jsonl`),
  ]);
  framework = { exerciseLibrary, sessionTemplates, sessionSchema, rehabProtocols };
  data = { equipment, baselines, attributes, events, niggles, history };
}

function mount() {
  const root = document.getElementById('app');
  if (!root) return;
  let html = '';
  if (state.stage === 'checkin') html = renderCheckin(state);
  else if (state.stage === 'suggestion') html = renderSuggestion(state);
  else if (state.stage === 'logging') html = renderLogging();
  root.innerHTML = html;
}

function dispatch(action) {
  state = reducer(state, action);
  mount();
}

function generationContext() {
  return { framework, data, date: todayISO() };
}

function readAdHocSelection() {
  const root = document.querySelector('[data-picker="location"]');
  if (!root) return [];
  const toggles = root.querySelectorAll('[data-adhoc-toggle][aria-pressed="true"]');
  return Array.from(toggles).map((el) => el.dataset.adhocToggle);
}

document.addEventListener('click', (event) => {
  const t = event.target.closest(
    '[data-action], [data-energy], [data-soreness], [data-sleep], [data-focus], [data-shorten], [data-location], [data-adhoc-toggle]',
  );
  if (!t) return;

  if (t.dataset.energy != null) {
    return dispatch({ type: 'SET_ENERGY', payload: Number(t.dataset.energy) });
  }
  if (t.dataset.soreness != null) {
    return dispatch({ type: 'SET_SORENESS', payload: t.dataset.soreness });
  }
  if (t.dataset.sleep != null) {
    return dispatch({ type: 'SET_SLEEP', payload: t.dataset.sleep });
  }
  if (t.dataset.focus != null) {
    dispatch({ type: 'SET_FOCUS', payload: t.dataset.focus });
    return dispatch({ type: 'REGENERATE', ...generationContext() });
  }
  if (t.dataset.shorten != null) {
    dispatch({ type: 'SHORTEN', payload: Number(t.dataset.shorten) });
    return dispatch({ type: 'REGENERATE', ...generationContext() });
  }
  if (t.dataset.location != null) {
    dispatch({ type: 'SET_LOCATION', payload: t.dataset.location });
    return dispatch({ type: 'REGENERATE', ...generationContext() });
  }
  if (t.dataset.adhocToggle != null) {
    // Toggle the chip's aria-pressed locally; commit on "apply-adhoc".
    const on = t.getAttribute('aria-pressed') === 'true';
    t.setAttribute('aria-pressed', String(!on));
    return;
  }

  switch (t.dataset.action) {
    case 'go':
      if (state.checkin.energy == null) return; // require at least an energy tap
      return dispatch({ type: 'GO', ...generationContext() });
    case 'regenerate':
      return dispatch({ type: 'REGENERATE', ...generationContext() });
    case 'change-focus':
      return dispatch({ type: 'TOGGLE_PICKER', payload: 'focus' });
    case 'change-location':
      return dispatch({ type: 'TOGGLE_PICKER', payload: 'location' });
    case 'shorten':
      return dispatch({ type: 'TOGGLE_PICKER', payload: 'shorten' });
    case 'apply-adhoc': {
      const equipment = readAdHocSelection();
      dispatch({ type: 'SET_LOCATION', payload: { kind: 'adhoc', equipment } });
      return dispatch({ type: 'REGENERATE', ...generationContext() });
    }
    case 'start':
      return dispatch({ type: 'START' });
    case 'back':
      return dispatch({ type: 'BACK_TO_CHECKIN' });
    default:
      return;
  }
});

(async function bootstrap() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('Sortie: service worker registration failed', err);
      });
    });
  }
  const root = document.getElementById('app');
  if (root) root.innerHTML = '<p class="loading">Loading…</p>';
  try {
    await loadResources();
  } catch (err) {
    if (root) {
      root.innerHTML = `<section class="error"><h1>Sortie</h1><p>Could not load framework/data: ${String(err.message)}</p></section>`;
    }
    return;
  }
  mount();
})();
