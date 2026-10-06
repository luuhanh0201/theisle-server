import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColorInput } from '@isle/ui';
import { byPlayer } from './items';
import { fixRarity } from './mutations/MutationItems';
import { chanceOf, dataFor } from './tickets/Tickets';
import { factorOf, typedHex } from './skins/SkinEditor';
import { overLimit, previewOf } from './skins/Skins';

const ref = (kind: string) => ({ name: 'X', description: '', diet: 'all', kind, unlock: null, status: 'live', femaleOnly: false });

test('a quest mutation is special, another never', () => {
  const d = { type: 'mutation' as const, name: 'a', rarity: 'rare', data: { mutation: 'X' } };
  expect(fixRarity(d, ref('unlock')).rarity).toBe('special');
  expect(fixRarity({ ...d, rarity: 'special' }, ref('normal')).rarity).toBe('legendary');
  expect(fixRarity(d, ref('normal')).rarity).toBe('rare');
});

test('tickets: new data by type, a prize chance', () => {
  expect(dataFor('mutation_ticket', 'special')).toEqual({ maxRarity: 'special' });
  expect(dataFor('growth_bag', 'rare')).toEqual({ amount: 0.1, below: 0.6 });
  expect(dataFor('prime_ticket', 'rare')).toEqual({});
  const pool = [{ itemId: 'a', qty: 1, weight: 10 }, { itemId: 'b', qty: 1, weight: 30 }];
  expect(chanceOf(pool, 0)).toBe('25.0%');
  expect(chanceOf(pool, 1)).toBe('75.0%');
  expect(chanceOf([], 0)).toBe('-');
});

test('owners by player, with their copies', () => {
  const o = (steamId: string) => ({ steamId, name: null, source: 'admin', grantedAt: 1, note: null });
  expect(byPlayer([o('1'), o('2'), o('1')]).map((x) => [x.steamId, x.n])).toEqual([['1', 2], ['2', 1]]);
});

test('skins: hex typed, light factor, past × 4 warned, the 3D preview', () => {
  expect(typedHex('FF0000')).toBe('#ff0000');
  expect(typedHex('#ff00')).toBeNull();
  expect(factorOf(0)).toBe(1);
  expect(factorOf(Math.log(4))).toBe(4);
  expect(factorOf(Math.log(0.05))).toBe(0.05);
  const data = { species: 'Carnotaurus', colors: { Body: { r: 1, g: 0, b: 0 } }, light: { Body: 3 }, brightness: 2, pattern: null, theme: null, variation: null };
  expect(overLimit(data)).toEqual(['Thân']);
  const p = previewOf(data, true);
  expect(p.colors['Body']).toBe('#ff0000');
  expect(p.female).toBe(true);
  expect(Object.keys(p.colors)).toHaveLength(10);
});

function Box() {
  const [v, setV] = useState('#112233');
  return <><ColorInput aria-label="Thân" value={v} onChange={setV} /><output>{v}</output></>;
}
test('the colour box: a hex typed is taken, Esc puts the first colour back, never the OS dialog', async () => {
  render(<Box />);
  expect(document.querySelector('input[type=color]')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Thân' }));
  const hexBox = screen.getByLabelText('Mã màu');
  await userEvent.clear(hexBox);
  await userEvent.type(hexBox, '#ff0000');
  expect(document.querySelector('output')!.textContent).toBe('#ff0000');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(document.querySelector('output')!.textContent).toBe('#112233');
  expect(screen.queryByLabelText('Mã màu')).toBeNull();
});
