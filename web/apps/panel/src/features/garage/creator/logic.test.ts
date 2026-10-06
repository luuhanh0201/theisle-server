import type { CatalogSpecies } from '@isle/api';
import { DEFAULT_PRIME, codeOf, fillPrime, freeSlotName, impliedStacks, keepOffered, maximaAtGrowth, mutationChoices, primeCount, toggleTask } from './logic';

test('prime tasks: a new dino has 7 and 8; prime fills up to five, the usual ones first', () => {
  expect(primeCount(DEFAULT_PRIME)).toBe(2);
  const filled = fillPrime(DEFAULT_PRIME);
  expect(primeCount(filled)).toBe(5);
  expect(filled).toBe('1010101100');
  expect(fillPrime('1111100000')).toBe('1111100000');
  expect(toggleTask(DEFAULT_PRIME, 1, true)).toBe('1000001100');
  expect(codeOf({ 1: true, 10: true } as unknown as Record<string, boolean>)).toBe('1000000001');
});

test('elder slots imply entombments: ElderSlot3B = 3', () => {
  expect(impliedStacks({ Slot1: 'A', ElderSlot1A: 'B', ElderSlot3B: 'C' })).toBe(3);
  expect(impliedStacks({ ElderSlot2A: '' })).toBe(0);
});

test('mutation choices: this species first; others only when allowed; a choice no longer offered goes', () => {
  const cat: CatalogSpecies[] = [
    { species: 'BP_Rex_C', classPath: 'x', mutations: { active: [], parent: [], elder: [] }, evidence: { B: { count: 1, players: 1, groups: [] }, A: { count: 1, players: 1, groups: [] } } },
    { species: 'BP_Dilo_C', classPath: 'y', mutations: { active: [], parent: [], elder: [] }, evidence: { C: { count: 1, players: 1, groups: [] }, A: { count: 1, players: 1, groups: [] } } },
  ];
  expect(mutationChoices(cat, 'BP_Rex_C', false)).toEqual({ own: ['A', 'B'], others: [] });
  expect(mutationChoices(cat, 'BP_Rex_C', true)).toEqual({ own: ['A', 'B'], others: ['C'] });
  expect(mutationChoices(cat, null, true).own).toEqual([]);
  expect(keepOffered({ Slot1: 'A', Slot2: 'C' }, new Set(['A', 'B']))).toEqual({ Slot1: 'A' });
});

test('maxima between two readings: a straight line; outside: the nearest', () => {
  const pts = [{ growth: 0.5, max: { health: 100 } }, { growth: 1, max: { health: 200 } }];
  expect(maximaAtGrowth(pts, 0.75)?.['health']).toBe(150);
  expect(maximaAtGrowth(pts, 0.2)?.['health']).toBe(100);
  expect(maximaAtGrowth(pts, 1)?.['health']).toBe(200);
  expect(maximaAtGrowth([], 0.5)).toBeNull();
});

test('a free slot name next to the one taken', () => {
  expect(freeSlotName('admin', new Set(['admin', 'admin_2']))).toBe('admin_3');
  expect(freeSlotName('rex_7', new Set())).toBe('rex_2');
});
