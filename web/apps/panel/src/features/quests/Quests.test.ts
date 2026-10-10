import { adjustError, moved, newQuest } from './Quests';
import { newMilestone } from './Milestones';

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

test('a new milestone: twice the biggest (at least 10, at most 1000), a free id', () => {
  expect(newMilestone([])).toEqual({ id: 'm10', players: 10, amber: 100, items: [] });
  const m = (players: number, id = `m${players}`) => ({ id, players, amber: 0, items: [] });
  expect(newMilestone([m(20), m(50)]).players).toBe(100);
  expect(newMilestone([m(20), m(50), m(100, 'm100')]).id).toBe('m200');
  expect(newMilestone([m(50), m(100)]).id).toBe('m200');
  expect(newMilestone([m(100), m(200, 'm200')]).id).toBe('m400');
  expect(newMilestone([m(50), m(25, 'm100')]).id).toBe('m100-2');
  expect(newMilestone([m(900)]).players).toBe(1000);
});
