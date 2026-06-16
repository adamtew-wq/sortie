// Wiring checks for the daily-loop UI (issue #6). Because the test runner has
// no DOM we cannot click buttons end-to-end; instead we verify that:
//   - app/ui/state.js exists and exports the public API.
//   - app/app.js is an ES module that imports the UI state module and renders
//     into #app.
//   - app/index.html loads app.js with type="module" so ES imports resolve.
//   - app/sw.js precaches the new shell pieces so the daily loop works offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const APP = path.resolve(process.cwd(), 'app');

test('app/ui/state.js exists and exports the public API', () => {
  const file = path.join(APP, 'ui', 'state.js');
  assert.ok(fs.existsSync(file), 'app/ui/state.js must exist');
  const src = fs.readFileSync(file, 'utf8');
  for (const sym of ['initialState', 'reducer', 'mapCheckinToInputs', 'renderCheckin', 'renderSuggestion']) {
    assert.match(
      src,
      new RegExp(`export\\s+(function|const|let|var)\\s+${sym}\\b`),
      `app/ui/state.js must export ${sym}`,
    );
  }
});

test('app/app.js loads the UI state module and renders the check-in on boot', () => {
  const js = fs.readFileSync(path.join(APP, 'app.js'), 'utf8');
  assert.match(js, /import[^;]+['"]\.\/ui\/state\.js['"]/,
    'app.js must import the UI state module');
  // Still registers the service worker (preserved from the shell slice).
  assert.match(js, /navigator\.serviceWorker\.register\(\s*['"]\.?\/?sw\.js['"]/,
    'app.js must still register sw.js');
  // Renders by reading #app — preserves the pwa-shell contract.
  assert.match(js, /getElementById\(\s*['"]app['"]\s*\)|querySelector\(\s*['"]#app['"]\s*\)/,
    'app.js must locate the #app mount element');
});

test('app/index.html loads app.js as a module so ES imports resolve', () => {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  assert.match(html, /<script[^>]+type=["']module["'][^>]*src=["']app\.js["']/i,
    'index.html must load app.js with type="module"');
});

test('app/sw.js precaches the UI state and engine modules so the daily loop works offline', () => {
  const sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
  assert.match(sw, /ui\/state\.js/, 'sw.js must precache ui/state.js');
  assert.match(sw, /engine\/index\.js/, 'sw.js must precache engine/index.js');
});
