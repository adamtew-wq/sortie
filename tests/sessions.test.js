import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadJSON, validate } from './helpers/validate.js';

const FIXTURES = path.resolve(process.cwd(), 'tests/fixtures/sessions');

test('5+ sample sessions ship in tests/fixtures/sessions/', () => {
  assert.ok(fs.existsSync(FIXTURES), 'tests/fixtures/sessions/ must exist');
  const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 5, `expected ≥5 sample sessions, found ${files.length}`);
});

test('every sample session validates against session-schema.json', () => {
  const schema = loadJSON('framework/session-schema.json');
  const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const session = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8'));
    const errors = validate(session, schema);
    assert.equal(errors.length, 0, `${file} schema errors:\n${errors.join('\n')}`);
  }
});

test('every sample session uses only equipment allowed by its declared profile', () => {
  const lib = loadJSON('framework/exercise-library.json');
  const byName = new Map(lib.exercises.map((e) => [e.name, e]));

  // Inventories mirror the placeholder defaults the onboarding slice will seed.
  const profiles = {
    Home: new Set([
      'bodyweight', 'dumbbells', 'pull-up-bar', 'kettlebell', 'bench', 'mat',
      'resistance-band', 'jump-rope', 'foam-roller', 'open-road', 'open-water',
      'bike', 'pool', 'treadmill',
    ]),
    Military: new Set([
      'bodyweight', 'dumbbells', 'pull-up-bar', 'kettlebell', 'bench', 'mat',
      'resistance-band', 'jump-rope', 'foam-roller', 'open-road', 'open-water',
      'bike', 'pool', 'treadmill', 'barbell', 'rack', 'platform', 'plates',
      'cable-machine', 'sled', 'rower', 'ski-erg', 'medicine-ball', 'box',
      'sandbag', 'tactical-vest',
    ]),
  };

  const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const s = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8'));
    const allowed = profiles[s.metadata.equipmentProfile];
    assert.ok(allowed, `${file}: unknown equipmentProfile ${s.metadata.equipmentProfile}`);
    const all = [...s.warmup, ...s.main, ...s.cooldown];
    for (const item of all) {
      const ex = byName.get(item.exercise);
      assert.ok(ex, `${file}: references unknown exercise "${item.exercise}"`);
      for (const eq of ex.equipment) {
        assert.ok(
          allowed.has(eq),
          `${file}: ${item.exercise} needs "${eq}" but profile ${s.metadata.equipmentProfile} lacks it`,
        );
      }
    }
  }
});

test('sample session with active knee niggle excludes squat and hinge patterns', () => {
  const session = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'knee-niggle-home.json'), 'utf8'));
  const lib = loadJSON('framework/exercise-library.json');
  const byName = new Map(lib.exercises.map((e) => [e.name, e]));
  const flagged = new Set(['squat', 'hinge']);
  for (const item of session.main) {
    const ex = byName.get(item.exercise);
    const patterns = ex.movementPatterns || [ex.movementPattern];
    for (const p of patterns) {
      assert.ok(!flagged.has(p), `${item.exercise} loads flagged pattern "${p}"`);
    }
  }
  // And the rehab protocol is woven in (warmup or accessory).
  const allBlocks = [...session.warmup, ...session.main, ...session.cooldown];
  assert.ok(
    allBlocks.some((b) => b.rehab === true),
    'knee-niggle session must weave in rehab work (block.rehab === true)',
  );
});

test('low-readiness session is shorter/lighter than the matching full-readiness session', () => {
  const low = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'low-readiness-home.json'), 'utf8'));
  const high = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'home-upper-push.json'), 'utf8'));
  assert.ok(low.metadata.duration <= high.metadata.duration,
    'low-readiness session should not exceed full-readiness duration');
  assert.ok(low.metadata.readiness < high.metadata.readiness,
    'low-readiness readiness score should be lower');
});
