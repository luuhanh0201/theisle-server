// The daily / weekly quests (quests.ts): progress from the game's events, given by diet, a reward once.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'quests-'));
process.env.DATA_DIR = root;
const { PlayDays, balanceOf, dayOf } = await import('../dist/economy.js');
const { QuestProgress, questsOf, claimQuest, saveQuestSettings, validateQuestSettings, placesOf, weekOf } = await import('../dist/quests.js');
after(() => rmSync(root, { recursive: true, force: true }));

const A = '76561198000000001', B = '76561198000000002', ADMIN = '76561198000000009';
const MIDNIGHT = Date.UTC(2026, 9, 5) / 1000 - 7 * 3600;   // 2026-10-05 00:00 in Vietnam (a Monday)
const REX = 'BP_Tyrannosaurus_C', TRIKE = 'BP_Triceratops_C';
const make = (places = []) => {
  const play = new PlayDays();
  const q = new QuestProgress(play, () => places, (id) => id === ADMIN);
  const feed = (e) => { play.onEvent(e); q.onEvent(e); };
  return { q, feed };
};
const snap = (id, t, x, y, growth = 0.5, species = REX) => ({ type: 'snapshot', t, steamId: id, species, growth, loc: { x, y, z: 0 } });

test('minutes in game and alive without dying: a death starts the count again', () => {
  const { q, feed } = make();
  const t0 = MIDNIGHT + 3600;
  feed({ type: 'session_start', t: t0, steamId: A });
  feed({ type: 'death', t: t0 + 40 * 60, steamId: A });
  assert.equal(q.progress(A, 'survive', [dayOf(t0)], t0 + 40 * 60), 40, 'the best life so far');
  assert.equal(q.progress(A, 'survive', [dayOf(t0)], t0 + 70 * 60), 40, 'the new life has 30 min: the best stays 40');
  assert.equal(q.progress(A, 'survive', [dayOf(t0)], t0 + 100 * 60), 60, 'now 60 alive');
  assert.equal(q.progress(A, 'play', [dayOf(t0)], t0 + 100 * 60), 100);
});

test('kills as the board counts them: admins never, a grown killer only on prey above 40 %', () => {
  const { q, feed } = make();
  const t = MIDNIGHT + 7200;
  const kill = (killer, killerGrowth, growth) => feed({ type: 'death', t, steamId: B, attributed: true, killer, killerGrowth, growth });
  kill(A, 1, 0.8);   // counts
  kill(A, 1, 0.3);   // small prey for a grown killer
  kill(A, 0.3, 0.3); // a young killer: any
  kill(ADMIN, 1, 1); // an admin
  assert.equal(q.progress(A, 'kills', [dayOf(t)], t), 2);
  assert.equal(q.progress(ADMIN, 'kills', [dayOf(t)], t), 0);
});

test('growth and distance little by little; a jump (garage, teleport) is not; named places reached', () => {
  const places = placesOf({ features: [{ layer: 'landmark', kind: 'label', name: 'Mad Grotto', at: [1, 2] }, { layer: 'water', kind: 'label', name: 'Dam Lake', at: [100, 100] }, { layer: 'area', name: 'X', at: [0, 0] }] });
  assert.deepEqual(places, [{ name: 'Mad Grotto', x: 2000, y: 1000 }, { name: 'Dam Lake', x: 100000, y: 100000 }]);
  const { q, feed } = make(places);
  let t = MIDNIGHT + 3600;
  feed(snap(A, t, 0, 0, 0.5));
  for (let i = 1; i <= 10; i++) feed(snap(A, t += 5, i * 10_000, 0, 0.5 + i * 0.01));   // 100 m each, +1 % each
  feed(snap(A, t += 5, 900_000, 0, 0.9));   // teleported, grown by an admin
  feed(snap(A, t += 5, 900_000, 100_000 - 2_000, 0.9));   // 980 m in 5 s: not walked
  const day = [dayOf(t)];
  assert.equal(q.progress(A, 'distance', day, t), 1, '1 km walked');
  assert.equal(q.progress(A, 'growth', day, t), 10, '+10 %, the jump left out');
  assert.equal(q.progress(A, 'visit', day, t), 1, 'Mad Grotto (2000, 1000) passed by');
});

test('prime tasks done one at a time; many at once (garage, admin) are not', () => {
  const { q, feed } = make();
  const t = MIDNIGHT + 3600;
  const prime = (tt, met) => feed({ type: 'prime', t: tt, steamId: A, species: REX, conditions: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [n, met.includes(n)])) });
  prime(t, [7, 8]);
  prime(t + 60, [7, 8, 3]);
  prime(t + 120, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(q.progress(A, 'prime', [dayOf(t)], t + 200), 1);
});

test('given by diet, the same all day; a reward once, only when done; the week adds its days up', async () => {
  assert.throws(() => validateQuestSettings({ perDay: 3, defs: [{ id: 'a', kind: 'fly', label: 'x', target: 1, reward: 1 }] }), /unknown kind/);
  await saveQuestSettings({ perDay: 1, defs: [
    { id: 'hunt', kind: 'kills', label: 'Hạ 1 dino', target: 1, reward: 100, diet: 'carnivore', period: 'day' },
    { id: 'walk', kind: 'distance', label: 'Đi 1 km', target: 1, reward: 30, diet: 'all', period: 'day', enabled: false },
    { id: 'graze', kind: 'play', label: 'Chơi 30 phút', target: 30, reward: 40, diet: 'herbivore', period: 'day' },
    { id: 'week', kind: 'play', label: 'Chơi 2 giờ trong tuần', target: 120, reward: 500, diet: 'all', period: 'week' },
  ] });
  const { q, feed } = make();
  const t = MIDNIGHT + 3600;
  const trike = await questsOf(B, TRIKE, q, t);
  assert.deepEqual(trike.daily.map((x) => x.id), ['graze'], 'a herbivore: no hunting; the switched-off one never');
  assert.deepEqual((await questsOf(B, REX, q, t + 60)).daily.map((x) => x.id), ['graze'], 'the same all day, whatever is played later');
  const rex = await questsOf(A, REX, q, t);
  assert.deepEqual(rex.daily.map((x) => x.id), ['hunt']);
  await assert.rejects(() => claimQuest(A, 'hunt', REX, q, t), /Chưa xong: 0\/1/);
  feed({ type: 'death', t: t + 10, steamId: B, attributed: true, killer: A, killerGrowth: 1, growth: 1 });
  assert.deepEqual(await claimQuest(A, 'hunt', REX, q, t + 20), { reward: 100, balance: 100, label: 'Hạ 1 dino' });
  await assert.rejects(() => claimQuest(A, 'hunt', REX, q, t + 30), /đã nhận/);
  await assert.rejects(() => claimQuest(A, 'graze', REX, q, t + 30), /không phải của bạn/);
  assert.equal(await balanceOf(A), 100);
  // The week: Monday 60 min, Tuesday 60 min.
  feed({ type: 'session_start', t: t + 100, steamId: A }); feed({ type: 'session_end', t: t + 100 + 3600, steamId: A });
  feed({ type: 'session_start', t: t + 86400, steamId: A }); feed({ type: 'session_end', t: t + 86400 + 3600, steamId: A });
  const w = (await questsOf(A, REX, q, t + 86400 + 3700)).weekly;
  assert.deepEqual([w.id, w.progress, w.done], ['week', 120, true]);
  assert.equal(weekOf(dayOf(MIDNIGHT)), weekOf(dayOf(MIDNIGHT + 6 * 86400)), 'Monday to Sunday one week');
  assert.notEqual(weekOf(dayOf(MIDNIGHT)), weekOf(dayOf(MIDNIGHT - 1)), 'Sunday before: the week before');
  await claimQuest(A, 'week', REX, q, t + 86400 + 3700);
  const ledger = readFileSync(join(root, 'economy-ledger.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(ledger.map((l) => l.reason), ['Nhiệm vụ ngày: Hạ 1 dino', 'Nhiệm vụ tuần: Chơi 2 giờ trong tuần']);
});
