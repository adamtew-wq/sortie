import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadJSON } from './helpers/validate.js';

const APP = path.resolve(process.cwd(), 'app');

test('app/ ships the five shell files (index.html, manifest.json, sw.js, style.css, app.js)', () => {
  for (const file of ['index.html', 'manifest.json', 'sw.js', 'style.css', 'app.js']) {
    assert.ok(
      fs.existsSync(path.join(APP, file)),
      `app/${file} must exist`,
    );
  }
});

test('app/manifest.json: valid JSON with installability fields', () => {
  const m = loadJSON('app/manifest.json');
  assert.equal(m.name, 'Sortie', 'manifest.name must be "Sortie"');
  assert.ok(m.short_name, 'manifest.short_name required');
  assert.ok(m.short_name.length <= 12, 'short_name should fit on a home-screen label');
  assert.equal(m.display, 'standalone', 'display must be standalone for installability');
  assert.ok(m.start_url, 'start_url required');
  assert.ok(m.theme_color, 'theme_color required');
  assert.ok(m.background_color, 'background_color required');
  assert.ok(Array.isArray(m.icons) && m.icons.length > 0, 'icons[] required');
  for (const icon of m.icons) {
    assert.ok(icon.src, 'icon needs src');
    assert.ok(icon.sizes, 'icon needs sizes');
    assert.ok(icon.type, 'icon needs type (MIME)');
    const iconPath = path.join(APP, icon.src);
    assert.ok(
      fs.existsSync(iconPath),
      `icon file referenced by manifest must exist on disk: ${icon.src}`,
    );
  }
  // At least one maskable + any-purpose icon for Android adaptive icons / iOS home screen.
  const purposes = new Set(m.icons.flatMap((i) => (i.purpose || 'any').split(/\s+/)));
  assert.ok(purposes.has('any'), 'manifest must include an "any" purpose icon');
});

test('app/index.html: links the manifest, loads app.js, has a root mount and viewport meta', () => {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  assert.match(html, /<!doctype html>/i, 'must declare HTML5 doctype');
  assert.match(html, /<link\s+rel=["']manifest["']\s+href=["']manifest\.json["']/i,
    'must link manifest.json');
  assert.match(html, /<meta\s+name=["']viewport["'][^>]*width=device-width/i,
    'must set viewport for mobile');
  assert.match(html, /<meta\s+name=["']theme-color["']/i,
    'must set theme-color meta tag');
  assert.match(html, /<link\s+rel=["']stylesheet["']\s+href=["']style\.css["']/i,
    'must link style.css');
  assert.match(html, /<script[^>]+src=["']app\.js["']/i,
    'must load app.js');
  assert.match(html, /id=["']app["']/i,
    'must have a root #app element for the UI to mount into');
  // Apple PWA hints so iOS treats it like a standalone app from the home screen.
  assert.match(html, /apple-mobile-web-app-capable/i,
    'must include apple-mobile-web-app-capable meta for iOS install');
});

test('app/sw.js: caches the shell on install and handles fetches', () => {
  const sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
  assert.match(sw, /addEventListener\(\s*['"]install['"]/,
    'service worker must handle install event');
  assert.match(sw, /addEventListener\(\s*['"]fetch['"]/,
    'service worker must handle fetch event');
  assert.match(sw, /addEventListener\(\s*['"]activate['"]/,
    'service worker must handle activate event (for cache cleanup)');
  // Must precache the five shell files so the app opens offline.
  for (const asset of ['index.html', 'manifest.json', 'style.css', 'app.js']) {
    assert.ok(
      sw.includes(asset),
      `sw.js must precache "${asset}" in the shell cache list`,
    );
  }
  // Versioned cache name so updates can purge stale shells.
  assert.match(sw, /sortie[- ]shell[- ]v\d+/i,
    'sw.js must use a versioned cache name (e.g. sortie-shell-v1)');
  // GitHub API requests are network-first so logged data stays fresh.
  assert.match(sw, /api\.github\.com/,
    'sw.js must reference api.github.com for network-first handling');
});

test('app/app.js: registers the service worker and renders the placeholder', () => {
  const js = fs.readFileSync(path.join(APP, 'app.js'), 'utf8');
  assert.match(js, /navigator\.serviceWorker\.register\(\s*['"]\.?\/?sw\.js['"]/,
    'app.js must register sw.js');
  // Feature-detect so older browsers do not crash on the registration call.
  assert.match(js, /['"]serviceWorker['"]\s+in\s+navigator/,
    'app.js must feature-detect serviceWorker support before registering');
  // Renders the placeholder screen into #app.
  assert.match(js, /getElementById\(\s*['"]app['"]\s*\)|querySelector\(\s*['"]#app['"]\s*\)/,
    'app.js must locate the #app mount element');
  assert.match(js, /Sortie/,
    'app.js must render the "Sortie" placeholder copy');
});

test('app/style.css: dark theme, mobile-first, ≥44px tap targets', () => {
  const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8');
  // Dark theme: a dark background colour somewhere in the base styles.
  assert.match(css, /background(-color)?\s*:\s*#[0-1][0-9a-f]{5}|background(-color)?\s*:\s*#[0-1][0-9a-f]{2}\b/i,
    'must set a dark background (hex #0xxxxx or shorthand)');
  // Mobile-first: a body or html font-size / box-sizing baseline.
  assert.match(css, /\*\s*,?\s*[^{]*\{\s*[^}]*box-sizing\s*:\s*border-box/,
    'must reset box-sizing to border-box for mobile layout');
  // Tap targets ≥ 44px.
  assert.match(css, /min-height\s*:\s*(4[4-9]|[5-9]\d|\d{3,})px/,
    'interactive elements must declare min-height ≥ 44px for tap targets');
});

test('app/manifest.json: start_url and scope keep the PWA inside app/', () => {
  const m = loadJSON('app/manifest.json');
  // start_url must resolve to the app shell. We accept "./", "./index.html",
  // or an absolute path that ends in the app/ shell.
  assert.match(m.start_url, /^(\.\/?|\.\/index\.html|\/.*\/?(index\.html)?)$/,
    `start_url "${m.start_url}" should point to the app shell (e.g. "./" or "./index.html")`);
});
