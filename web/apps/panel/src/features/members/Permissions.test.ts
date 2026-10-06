import { effective, withPerm } from './Permissions';

const roles = { mod: { label: 'Kiểm duyệt', perms: ['a', 'b'] }, full: { label: 'Toàn quyền', perms: ['a', 'b', 'c'] } };

test('a permission off the role is an exception; back as the role has it, the exception goes', () => {
  const d = { role: 'mod', allow: [], deny: [], ingame: true };
  const extra = withPerm(roles, d, 'c', true);
  expect(extra.allow).toEqual(['c']);
  expect([...effective(roles, extra)].sort()).toEqual(['a', 'b', 'c']);
  const less = withPerm(roles, extra, 'a', false);
  expect(less.deny).toEqual(['a']);
  expect([...effective(roles, less)].sort()).toEqual(['b', 'c']);
  expect(withPerm(roles, less, 'a', true).deny).toEqual([]);
  expect(withPerm(roles, less, 'c', false).allow).toEqual([]);
});
