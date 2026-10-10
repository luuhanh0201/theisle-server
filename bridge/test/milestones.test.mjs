// The server's online milestones (milestones.ts): reached only when held N minutes at once, once ever;
// taken by everyone with enough minutes in game, once each, Hổ phách and items. npm test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'milestones-'));
process.env.DATA_DIR = join(root, 'data');
process.env.GARAGE_ROOT = join(root, 'garage');
mkdirSync(join(root, 'garage', 'stored'), { recursive: true });
const { MilestoneWatch, validateMilestones, saveMilestones, readMilestones, milestonesOf, claimMilestone, reopenMilestone, milestonesAdminView } = await import('../dist/milestones.js');
const { createItem, inventoryOf } = await import('../dist/items.js');
const { balanceOf } = await import('../dist/economy.js');
after(() => rmSync(root, { recursive: true, force: true }));

const A = '76561198000000001';
const B = '76561198000000002';
const HOUR = 3600;

test('validate: off by default, 20 / 50 / 100 / 200, numbers in range, unique ids', () => {
  const d = validateMilestones({});
  assert.equal(d.enabled, false);
  assert.deepEqual(d.defs.map((x) => x.players), [20, 50, 100, 200]);
  assert.equal(d.holdMinutes, 5);
  assert.equal(d.minPlayMinutes, 60);
  assert.throws(() => validateMilestones({ defs: [{ id: 'a', players: 0 }] }), /players/);
  assert.throws(() => validateMilestones({ defs: [{ id: 'a', players: 5 }, { id: 'a', players: 6 }] }), /unique/);
  assert.throws(() => validateMilestones({ defs: [{ id: 'a', players: 5, items: [{ itemId: 'x', qty: 0 }] }] }), /qty/);
  assert.throws(() => validateMilestones({ holdMinutes: -1 }), /holdMinutes/);
});

test('an item that does not exist is refused at save', async () => {
  await assert.rejects(() => saveMilestones({ enabled: true, defs: [{ id: 'm1', players: 2, amber: 0, items: [{ itemId: 'nope', qty: 1 }] }] }), /không có vật phẩm/);
});

test('held N minutes at once: reached once; a moment below starts the clock again; off: nothing', async () => {
  let online = 0;
  const reached = [];
  const w = new MilestoneWatch(() => online, (d, n) => reached.push([d.players, n]));
  await saveMilestones({ enabled: false, holdMinutes: 5, minPlayMinutes: 60, defs: [{ id: 'm2', players: 2, amber: 10, items: [] }, { id: 'm3', players: 3, amber: 30, items: [] }] });
  online = 5;
  const t0 = 1_000_000;
  assert.deepEqual(await w.tick(t0), [], 'off');
  assert.deepEqual(await w.tick(t0 + 600), []);
  const s = await readMilestones();
  await saveMilestones({ ...s, enabled: true });
  online = 2;
  assert.deepEqual(await w.tick(t0), []);
  assert.deepEqual(w.held(t0 + 60), { m2: 60 });
  online = 1;
  assert.deepEqual(await w.tick(t0 + 200), [], 'a moment below');
  assert.deepEqual(w.held(t0 + 200), {});
  online = 3;
  assert.deepEqual(await w.tick(t0 + 210), []);
  assert.deepEqual(await w.tick(t0 + 210 + 299), [], 'not yet 5 minutes');
  assert.deepEqual(await w.tick(t0 + 210 + 300), ['m2', 'm3']);
  assert.deepEqual(reached, [[2, 3], [3, 3]]);
  assert.deepEqual(await w.tick(t0 + 9999), [], 'once ever');
  const v = await milestonesAdminView();
  assert.deepEqual(Object.keys(v.reached).sort(), ['m2', 'm3']);
});

test('taken: enough minutes in game in all (not online then), once each; Hổ phách and items (each copy), two clicks at once give once', async () => {
  const box = await createItem({ type: 'prime_ticket', name: 'Phiếu Prime thử', rarity: 'common', data: {} }, null);
  const s = await readMilestones();
  await saveMilestones({ ...s, defs: s.defs.map((d) => (d.id === 'm2' ? { ...d, amber: 10, items: [{ itemId: box.id, qty: 2 }] } : d)) });
  await assert.rejects(() => claimMilestone(A, 'm2', 59 * 60), /đủ 60 phút/, '59 minutes is not enough');
  const before = await balanceOf(A);
  const got = await claimMilestone(A, 'm2', HOUR);
  assert.equal(got.players, 2);
  assert.equal(await balanceOf(A), before + 10);
  assert.equal((await inventoryOf(A)).filter((o) => o.itemId === box.id).length, 2);
  await assert.rejects(() => claimMilestone(A, 'm2', HOUR), /đã nhận/);
  const both = await Promise.allSettled([claimMilestone(B, 'm2', HOUR), claimMilestone(B, 'm2', HOUR)]);
  assert.deepEqual(both.map((r) => r.status).sort(), ['fulfilled', 'rejected'], 'two clicks at once: once');
  assert.equal((await inventoryOf(B)).filter((o) => o.itemId === box.id).length, 2);
  await assert.rejects(() => claimMilestone(A, 'nope', HOUR), /Không có mốc/);
  const view = await milestonesOf(A, HOUR, 4, {});
  assert.deepEqual(view.defs.map((d) => [d.id, d.reached, d.claimed]), [['m2', true, true], ['m3', true, false]]);
  assert.equal(view.eligible, true);
  assert.equal((await milestonesOf(B, 10 * 60, 4, {})).eligible, false);
  assert.deepEqual((await milestonesAdminView()).claimedCount, { m2: 2 });
});

test('not reached: refused; reopened by the panel: reached again later, taken again', async () => {
  await saveMilestones({ ...(await readMilestones()), defs: [...(await readMilestones()).defs, { id: 'm9', players: 9, amber: 5, items: [] }] });
  await assert.rejects(() => claimMilestone(A, 'm9', HOUR), /chưa đạt mốc 9/);
  assert.deepEqual(await reopenMilestone('m2'), { claimed: 2 });
  await assert.rejects(() => claimMilestone(A, 'm2', HOUR), /chưa đạt/);
  const s = await readMilestones();
  await saveMilestones({ ...s, enabled: false });
  assert.equal(await milestonesOf(A, HOUR, 0, {}), null, 'off: nothing on the home page');
  await assert.rejects(() => claimMilestone(A, 'm3', HOUR), /đang tắt/);
});
