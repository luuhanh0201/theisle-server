// Fish (fish-settings.ts): validation, and the species left out go into the
// game's DisallowedAIClasses next to what is already there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { validateFish, disallowedWith, FISH_DEFAULTS } = await import('../dist/fish-settings.js');

test('validation: ranges, known species', () => {
  assert.equal(validateFish({}).control, false);
  assert.deepEqual(validateFish({ species: ['Muskel', 'Catfish'] }).species, ['Catfish', 'Muskel'], 'in the game\'s order');
  assert.equal(validateFish({ cooldownSec: 2.25 }).cooldownSec, 2.3);
  assert.throws(() => validateFish({ perPlayer: 61 }), /perPlayer/);
  assert.throws(() => validateFish({ cooldownSec: 0 }), /cooldownSec/);
  assert.throws(() => validateFish({ species: ['Shark'] }), /unknown fish/);
  assert.deepEqual(validateFish({ tune: { MaxAIPerPlayer: 2, Radius: 1.5 } }).tune, { MaxAIPerPlayer: 2, Radius: 1.5 });
  assert.throws(() => validateFish({ tune: { 'a b': 1 } }), /property name/);
  assert.throws(() => validateFish({ tune: { X1: 'x' } }), /must be a number/);
});

test('species left out are disallowed; other entries kept; off = no fish disallowed', () => {
  const on = { ...FISH_DEFAULTS, control: true, species: ['Catfish', 'Longear'] };
  assert.deepEqual(disallowedWith(['Crab', 'Lizard', 'Muskel'], on), ['Crab', 'Lizard', 'Coalecanth', 'Forktail', 'Hoplo', 'Muskel']);
  assert.deepEqual(disallowedWith(['Crab', 'Hoplo'], { ...on, control: false }), ['Crab']);
});
