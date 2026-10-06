import { parseHash, pickSub } from './router';
import { subAllowed, tabAllowed } from './nav';

const all = { perms: null, super: false };
const modsOnly = { perms: new Set(['mods.view']), super: false };

test('addresses: #tab/sub, an old one moved, nonsense goes to the overview', () => {
  expect(parseHash('#mods/tele')).toEqual({ tab: 'mods', sub: 'tele' });
  expect(parseHash('#server/ptera-carry')).toEqual({ tab: 'mods', sub: 'ptera' });
  expect(parseHash('#nope')).toEqual({ tab: 'overview', sub: null });
  expect(parseHash('')).toEqual({ tab: 'overview', sub: null });
});

test('the sub-page: the one asked when allowed, else the first allowed', () => {
  expect(pickSub(all, 'mods', 'tele')).toBe('tele');
  expect(pickSub(all, 'mods', 'nope')).toBe('commands');
  expect(pickSub(all, 'overview', null)).toBe(null);
  const svipOnly = { perms: new Set(['svip.edit']), super: false };
  expect(pickSub(svipOnly, 'members', 'admins')).toBe('svip');
});

test('permissions: pages hidden without theirs; "*" is the super admin only', () => {
  expect(tabAllowed(modsOnly, 'mods')).toBe(true);
  expect(tabAllowed(modsOnly, 'players')).toBe(false);
  expect(subAllowed({ perms: new Set(['config.view']), super: false }, 'members', 'perms')).toBe(false);
  expect(subAllowed({ perms: new Set(), super: true }, 'members', 'perms')).toBe(true);
  expect(tabAllowed(all, 'traffic')).toBe(true);
});

test('before /api/me answers nothing is hidden: a deep link to a super-admin page stays', () => {
  const pending = { perms: null, super: false };
  expect(pickSub(pending, 'members', 'perms')).toBe('perms');
  expect(subAllowed({ perms: new Set(), super: false }, 'members', 'perms')).toBe(false);
});

test('a sub-page with a part after a colon (#server/cfg:spawn) is kept; an unknown one falls back', () => {
  expect(parseHash('#server/cfg%3Aspawn')).toEqual({ tab: 'server', sub: 'cfg:spawn' });
  expect(pickSub(all, 'server', 'cfg:spawn')).toBe('cfg:spawn');
  expect(pickSub(all, 'server', 'nope:x')).toBe('ops');
});
