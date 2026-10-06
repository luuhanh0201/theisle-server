import type { MutationsData } from '@isle/api';
import { genIndex, mutSlug, refAlert, refFor, tierList } from './reference';

const data: MutationsData = {
  notes: {}, sources: {}, matches: { 'Hemo': 'Hemomania' },
  reference: [
    { name: 'Hemomania', en: 'x', description: 'y', status: 'active', sources: [], tiers: '10% / 15% / 20%' },
    { name: 'Old One', en: 'x', description: 'y', status: 'removed', sources: [], aliases: ['Older'] },
  ],
};

test('the reference entry: the bridge\'s match, an exact name or an alias (MUT_ and case ignored)', () => {
  expect(refFor(data, 'Hemo')?.name).toBe('Hemomania');
  expect(refFor(data, 'MUT_hemomania')?.name).toBe('Hemomania');
  expect(refFor(data, 'older')?.name).toBe('Old One');
  expect(refFor(data, 'nope')).toBeNull();
  expect(refAlert(refFor(data, 'Old One'))).toContain('đã bị gỡ');
  expect(mutSlug('Cellular Regeneration')).toBe('cellular-regeneration');
});

test('strength by generation: the last value holds past the list', () => {
  const r = refFor(data, 'Hemomania')!;
  expect(tierList(r)).toEqual(['10%', '15%', '20%']);
  expect(genIndex(r, 0)).toBe(0);
  expect(genIndex(r, 9)).toBe(2);
});
