import { adjustError, moved, newQuest } from './Quests';

test('a new quest takes the first free id', () => {
  const q = (id: string) => ({ ...newQuest([]), id });
  expect(newQuest([]).id).toBe('q1');
  expect(newQuest([q('q2'), q('x')]).id).toBe('q3');
  expect(newQuest([q('q3'), q('q4')]).id).toBe('q5');
});

test('a shop listing moved up or down, never past the ends', () => {
  expect(moved(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
  expect(moved(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  expect(moved(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
});

test('an amber adjustment needs a SteamID, a whole non-zero number and a reason', () => {
  expect(adjustError('123', 5, 'x')).toMatch(/SteamID/);
  expect(adjustError('76561198000000011', 0, 'x')).toMatch(/khác 0/);
  expect(adjustError('76561198000000011', 1.5, 'x')).toMatch(/khác 0/);
  expect(adjustError('76561198000000011', -20, '')).toBe('Cần ghi lý do');
  expect(adjustError('76561198000000011', -20, 'đền bù')).toBeNull();
});
