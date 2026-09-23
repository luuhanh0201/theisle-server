// Mutation reference matching and name validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findReference, normaliseMutationName, MUTATION_REFERENCE } from '../dist/mutation-reference.js';
import { MUTATION_NAME_RE } from '../dist/catalog.js';

test('real in-game names match their reference entry', () => {
  assert.equal(findReference('Reniculate Kidneys')?.name, 'Reniculate Kidneys');
  assert.equal(findReference('Reniculate Kidney')?.name, 'Reniculate Kidneys', 'alias');
  assert.equal(findReference('Reinforced Tendons')?.name, 'Reinforced Tendons');
  assert.equal(findReference('PhotosyntheticTissueStatAdder')?.name, 'Photosynthetic Tissue', 'suffixed internal name');
  assert.equal(findReference('hydro_regenerative')?.name, 'Hydro-regenerative');
  assert.equal(findReference('MUT_Hematophagy')?.name, 'Hematophagy');
});

test('matching never picks a shorter name inside a longer one, or guesses', () => {
  // "Photosynthetic Regeneration" must not match "Photosynthetic Tissue" or vice versa.
  assert.equal(findReference('Photosynthetic Regeneration')?.name, 'Photosynthetic Regeneration');
  assert.equal(findReference('Totally Unknown Thing'), null);
  assert.equal(findReference(''), null);
  assert.equal(findReference('Hemo'), null, 'a fragment is not a match');
});

test('reference data is well-formed', () => {
  const seen = new Set();
  for (const r of MUTATION_REFERENCE) {
    const k = normaliseMutationName(r.name);
    assert.ok(!seen.has(k), `duplicate ${r.name}`);
    seen.add(k);
    assert.ok(r.description.length > 5, `${r.name} has a description`);
    assert.ok(r.sources.length > 0, `${r.name} cites a source`);
    assert.ok(MUTATION_NAME_RE.test(r.name), `${r.name} passes the name check`);
    if (r.status !== 'active') assert.ok(r.statusNote, `${r.name} explains its status`);
  }
});

test('the name check accepts real FNames and rejects junk', () => {
  for (const ok of ['Reniculate Kidneys', 'Hydro-regenerative', 'PhotosyntheticTissueStatAdder', 'MUT_A', 'X']) {
    assert.ok(MUTATION_NAME_RE.test(ok), ok);
  }
  for (const bad of ['', ' Lead', 'Trail ', '../x', 'a;b', '<b>', 'x'.repeat(65), 'Tab\tX']) {
    assert.ok(!MUTATION_NAME_RE.test(bad), JSON.stringify(bad));
  }
});
