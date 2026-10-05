// A mutation item (panel → Vật phẩm → Mutation): a player uses it from their bag
// on the dino they play now, into the slot they pick (mods/DinoGarage
// garage/mutation.lua); its diet must fit the species; the copy is used up only
// once the mod says it is on the dino. npm test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'mutation-item-'));
process.env.DATA_DIR = join(root, 'data');
process.env.GARAGE_ROOT = join(root, 'garage');
process.env.PORTAL_TOKEN = 'portal-secret-token';
// The bag is open to admins only for now (player-api.ts BAG_ADMINS_ONLY): P1 is one.
process.env.ADMIN_STEAM_IDS = '76561198000000021';
mkdirSync(join(root, 'garage', 'stored'), { recursive: true });
const I = await import('../dist/items.js');
const { handlePlayerApi, startMutationUse, previewMutationUse } = await import('../dist/player-api.js');
const { Store } = await import('../dist/store.js');
after(() => rmSync(root, { recursive: true, force: true }));

const P1 = '76561198000000021';
const P2 = '76561198000000022';
const ADMIN = '76561199320940985';
const mut = (mutation) => ({ type: 'mutation', name: mutation, rarity: 'rare', data: { mutation } });

test('what an admin may save: a mutation the reference knows, its diet and slot rules from there', () => {
  assert.throws(() => I.validateItem({ ...mut('x'), data: {} }), /mutation is required/);
  assert.throws(() => I.validateItem(mut('Laser Eyes')), /unknown mutation/);
  assert.throws(() => I.validateItem(mut('Intraspecific Aggression')), /no longer in the game/);
  assert.deepEqual(I.validateItem(mut('cellular regeneration')).data,
    { mutation: 'Cellular Regeneration', diet: 'all', slot2: false, unlock: false }, 'the in-game name, whatever the case');
  assert.deepEqual(I.validateItem(mut('Cannibalistic')).data, { mutation: 'Cannibalistic', diet: 'carnivore', slot2: true, unlock: false });
  assert.deepEqual(I.validateItem(mut('Augmented Tapetum')).data, { mutation: 'Augmented Tapetum', diet: 'carnivore', slot2: false, unlock: true });
  assert.equal(I.validateItem({ ...mut('Cellular Regeneration'), data: { mutation: 'Cellular Regeneration', diet: 'carnivore' } }).data.diet, 'all',
    'the diet an admin sends is not trusted');
});

test('diet: who may use it', () => {
  assert.equal(I.dietRefusal('BP_Tyrannosaurus_C', 'all'), null);
  assert.equal(I.dietRefusal('BP_Tyrannosaurus_C', 'carnivore'), null);
  assert.match(I.dietRefusal('BP_Triceratops_C', 'carnivore'), /ăn thịt/);
  assert.equal(I.dietRefusal('Triceratops', 'herbivore'), null);
  assert.equal(I.dietRefusal('BP_Gallimimus_C', 'herbivore_omnivore'), null, 'an omnivore');
  assert.equal(I.dietRefusal('BP_Stegosaurus_C', 'herbivore_omnivore'), null, 'a herbivore');
  assert.match(I.dietRefusal('BP_Allosaurus_C', 'herbivore_omnivore'), /ăn cỏ \/ ăn tạp/);
  assert.match(I.dietRefusal('BP_Gallimimus_C', 'herbivore'), /ăn cỏ/, 'an omnivore is not a herbivore');
  assert.match(I.dietRefusal('BP_Unknownosaurus_C', 'carnivore'), /không rõ/);
});

test('a player uses a mutation from their bag: checks, the command, used up only when the mod says so', async () => {
  const regen = await I.createItem(mut('Cellular Regeneration'), ADMIN);
  const cannibal = await I.createItem(mut('Cannibalistic'), ADMIN);
  const tapetum = await I.createItem(mut('Augmented Tapetum'), ADMIN);
  const a = await I.grantItem(P1, regen.id, 'admin', ADMIN);
  const b = await I.grantItem(P1, regen.id, 'admin', ADMIN);
  assert.notEqual(a.uid, b.uid, 'a mutation may be owned several times');
  const c = await I.grantItem(P1, cannibal.id, 'admin', ADMIN);
  const d = await I.grantItem(P1, tapetum.id, 'admin', ADMIN);

  const store = new Store();
  const t = Math.floor(Date.now() / 1000);
  let inmate = false;
  const call = async (path, method = 'GET', payload) => {
    const chunks = payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))];
    const req = { method, headers: { 'x-portal-token': 'portal-secret-token' }, async *[Symbol.asyncIterator]() { for (const ch of chunks) yield ch; } };
    let status = 0; let body = '';
    await handlePlayerApi(req, { writeHead: (s) => { status = s; }, end: (x) => { body = x; } }, path,
      { store, serverPhase: async () => 'running', prison: { isInmate: () => inmate, playerView: () => null } });
    return { status, body: body ? JSON.parse(body) : null };
  };
  const use = (uid, slot, who = P1) => call(`/player-api/items/${who}/use`, 'POST', { uid, slot });

  const me = (await call(`/player-api/me/${P1}`)).body;
  const shown = me.items.find((x) => x.uid === c.uid);
  assert.deepEqual([shown.type, shown.mutation, shown.diet, shown.slot2], ['mutation', 'Cannibalistic', 'carnivore', true], 'the bag shows what it is');

  assert.equal(me.bag, true, 'an admin sees the bag');
  assert.equal((await call(`/player-api/me/${P2}`)).body.bag, false, 'a player does not, for now');
  // …unless SVip (svip.ts: tries the features being tested; not unlimited: not an admin).
  const { resetSvipCache } = await import('../dist/svip.js');
  writeFileSync(join(root, 'data', 'svip.json'), JSON.stringify({ players: [{ steamId: P2 }, { steamId: 'nope' }], features: { bag: 'testing' } }));
  resetSvipCache();
  const p2 = (await call(`/player-api/me/${P2}`)).body;
  assert.deepEqual([p2.bag, p2.bagUnlimited, p2.svip], [true, false, true], 'an SVip sees the bag');
  writeFileSync(join(root, 'data', 'svip.json'), JSON.stringify({ players: [], features: { bag: 'testing' } }));
  resetSvipCache();
  assert.match((await use(a.uid, 1, P2)).body.error, /chưa mở/, 'nor may they use one');
  assert.match(shown.description, /./, 'what it does, for the bag');
  assert.equal((await use('own_nope', 1)).status, 403);
  assert.equal((await use(a.uid, 1)).status, 409, 'not in the game');
  store.apply({ type: 'session_start', t, steamId: P1, name: 'P1' });
  store.apply({ type: 'spawn', t, steamId: P1, name: 'P1', species: 'BP_Triceratops_C', growth: 0.8 });
  assert.match((await use(c.uid, 2)).body.error, /Triceratops.*ăn thịt/, 'a carnivore mutation on a Triceratops');
  inmate = true;
  assert.match((await use(a.uid, 1)).body.error, /ở tù/);
  inmate = false;

  const r = await use(a.uid, 3);
  assert.equal(r.status, 202);
  const inbox = () => JSON.parse(readFileSync(join(root, 'garage', 'inbox.json'), 'utf8')).commands;
  const cmd = inbox().find((x) => x.id === r.body.id);
  assert.deepEqual([cmd.type, cmd.mode, cmd.steamId, cmd.mutation, cmd.slot, cmd.unlock], ['mutation', 'place', P1, 'Cellular Regeneration', 3, false]);
  assert.equal((await use(a.uid, 3)).status, 409, 'the same copy twice before the mod answers');
  assert.equal((await I.inventoryOf(P1)).length, 4, 'still in the bag while on its way');

  await I.settleUse({ type: 'portal_command', action: 'mutation', id: r.body.id, ok: false });
  assert.equal((await I.inventoryOf(P1)).length, 4, 'refused by the mod (already on the dino…): the item stays');
  const r2 = await use(a.uid, 3);
  assert.equal(r2.status, 202, 'and may be used again');
  await I.settleUse({ type: 'portal_command', action: 'admin', id: r2.body.id, ok: true });
  assert.equal((await I.inventoryOf(P1)).length, 4, 'another kind of answer with that id: nothing');
  await I.settleUse({ type: 'portal_command', action: 'mutation', id: r2.body.id, ok: true });
  const left = await I.inventoryOf(P1);
  assert.deepEqual(left.map((o) => o.uid).sort(), [b.uid, c.uid, d.uid].sort(), 'that copy used up, the second one kept');
  await I.settleUse({ type: 'portal_command', action: 'mutation', id: r2.body.id, ok: true });
  assert.equal((await I.inventoryOf(P1)).length, 3, 'an answer counted once');
  // An admin's bag never runs out (index.ts passes player-api.ts bagUnlimited).
  const { bagUnlimited } = await import('../dist/player-api.js');
  assert.equal(await bagUnlimited(P1), true, 'P1 is an admin here');
  assert.equal(await bagUnlimited(P2), false);
  assert.equal(me.bagUnlimited, true, 'the bag says so');
  const r4 = await use(b.uid, 2);
  assert.equal(r4.status, 202);
  await I.settleUse({ type: 'portal_command', action: 'mutation', id: r4.body.id, ok: true }, bagUnlimited);
  assert.ok((await I.inventoryOf(P1)).some((o) => o.uid === b.uid), 'used, and still in the admin\'s bag');

  store.apply({ type: 'spawn', t: t + 5, steamId: P1, name: 'P1', species: 'BP_Tyrannosaurus_C', growth: 1 });
  assert.equal((await use(b.uid, 5)).status, 400, 'slot 1–4');
  assert.equal((await use(b.uid, '1')).status, 400);
  assert.match((await use(c.uid, 1)).body.error, /ô 2 hoặc 4/, 'a slot-2 mutation');
  const r3 = await use(d.uid, 1);
  assert.equal(r3.status, 202);
  assert.equal(inbox().find((x) => x.id === r3.body.id).unlock, true, 'a quest mutation is unlocked by the mod first');
  const skin = await I.createItem({ type: 'skin', name: 'Đen', data: { species: 'Tyrannosaurus', colors: { Body: { r: 0, g: 0, b: 0.1 } } } }, ADMIN);
  const s = await I.grantItem(P1, skin.id, 'admin', ADMIN);
  assert.equal((await use(s.uid, 1)).status, 400, 'a skin is not used on a dino this way');

  // The panel's "Dùng lên dino" (server.ts) goes through the same checks.
  assert.equal((await startMutationUse({ store, prison: { isInmate: () => true } }, P1, b.uid, 1)).status, 400, 'an inmate, from the panel too');
  const viaPanel = await startMutationUse({ store }, P1, b.uid, 1);
  assert.equal(viaPanel.status, 202);
  assert.equal(inbox().find((x) => x.id === viaPanel.body.id).mutation, 'Cellular Regeneration');
});

test('a copy the dino has already: +1 đời within its max; the confirm box numbers; the rarity of a quest mutation', async () => {
  const T = await import('../dist/mutation-tiers.js');
  // Tables: "15% / 20% / 25% / 25%" stops growing at đời 3 (stacks 2); no table or one value never grows.
  assert.deepEqual(T.tierValues('Cellular Regeneration'), ['15%', '20%', '25%', '25%']);
  assert.equal(T.maxStacksOf('Cellular Regeneration'), 2);
  assert.equal(T.maxStacksOf('Augmented Tapetum'), 2, '"1 / 2 / 3"');
  assert.equal(T.maxStacksOf('Cannibalistic'), 0, 'no numbers: counts as maxed');
  assert.equal(T.maxStacksOf('Featherweight'), 0, 'one value');
  assert.equal(T.valueAt('Cellular Regeneration', 7), '25%', 'beyond the table the last holds');

  const regen = await I.createItem(mut('Cellular Regeneration'), ADMIN);
  const cannibal = await I.createItem(mut('Cannibalistic'), ADMIN);
  const hydro = await I.createItem(mut('Hydrodynamic'), ADMIN);
  const a = await I.grantItem(P1, regen.id, 'admin', ADMIN);
  const c = await I.grantItem(P1, cannibal.id, 'admin', ADMIN);
  const h = await I.grantItem(P1, hydro.id, 'admin', ADMIN);
  const store = new Store();
  const t = Math.floor(Date.now() / 1000);
  store.apply({ type: 'session_start', t, steamId: P1, name: 'P1' });
  store.apply({ type: 'spawn', t, steamId: P1, name: 'P1', species: 'BP_Tyrannosaurus_C', growth: 1,
    mutations: { Slot1: 'Cellular Regeneration', Slot2: 'Cannibalistic', ParentSlot1: 'Hydrodynamic' } });
  store.apply({ type: 'prime', t, steamId: P1, name: 'P1', species: 'BP_Tyrannosaurus_C', elderStacks: 1 });
  const ctx = { store };

  // The duplicate upgrade (+1 đời for the whole dino) is OFF (mutation-tiers.ts DUPLICATE_UPGRADE):
  // the owner wants one mutation stronger, and the game keeps no per-mutation tier.
  const pv = (await previewMutationUse(ctx, P1, a.uid)).body;
  assert.equal(pv.stacks, 1, 'đời 2');
  assert.deepEqual(pv.slots[0], { slot: 1, name: 'Cellular Regeneration', value: '20%', minGrowth: 0.25, open: true });
  assert.deepEqual(pv.has, ['Slot1']);
  assert.equal(pv.upgrade, null, 'no upgrade offered');
  assert.match((await startMutationUse(ctx, P1, a.uid, 3)).body.error, /ô 1 — dùng thêm không mạnh hơn/, 'not a second time in a slot');
  assert.match((await startMutationUse(ctx, P1, a.uid, null, true)).body.error, /tạm tắt/, 'the upgrade itself refused');
  assert.equal((await I.inventoryOf(P1)).some((o) => o.uid === a.uid), true, 'the item stays');
  assert.equal((await startMutationUse(ctx, P1, h.uid, 3)).status, 202, 'only in an inherited slot: may go in a slot');
  assert.ok(c.uid);

  // Rarity: a quest mutation is special and stays so; nothing else may be.
  const quest = await I.createItem({ ...mut('Augmented Tapetum'), rarity: 'common' }, ADMIN);
  assert.equal(quest.rarity, 'special');
  assert.equal((await I.updateItem(quest.id, { ...mut('Augmented Tapetum'), rarity: 'epic' })).after.rarity, 'special');
  assert.throws(() => I.validateItem({ ...mut('Hydrodynamic'), rarity: 'special' }), /mutation nhiệm vụ/);
  assert.throws(() => I.validateItem({ type: 'skin', name: 'x', rarity: 'special', data: { species: 'Tyrannosaurus', colors: {} } }), /mutation nhiệm vụ/);
  assert.equal(I.validateItem({ ...mut('Hydrodynamic'), rarity: 'epic' }).rarity, 'epic', 'others: the admin picks');
});

test('the game\'s answer to a mutation item (or an admin action) reaches the bridge', async () => {
  // 2026-10-02: events.ts dropped portal_command "mutation" / "admin" as unrecognised:
  // the bag never heard back and the copy was never used up.
  const { parseEvent } = await import('../dist/events.js');
  const line = { type: 'portal_command', id: 1190, steamId: P1, action: 'mutation', slot: '3', ok: true, t: 1, messages: ['Đã thêm'] };
  assert.equal(parseEvent(line)?.action, 'mutation');
  assert.equal(parseEvent({ ...line, action: 'admin', slot: undefined })?.action, 'admin');
  assert.equal(parseEvent({ ...line, action: 'fly' }), null, 'anything else still refused');
});

test('the tickets, and each slot only from the growth the game opens it at', async () => {
  const P3 = '76561198000000023';
  process.env.ADMIN_STEAM_IDS = `76561198000000021,${P3}`;
  const { readFileSync: rf } = await import('node:fs');
  const hydro = await I.createItem({ ...mut('Hydrodynamic'), rarity: 'rare' }, ADMIN);
  await I.createItem({ ...mut('Hemomania'), rarity: 'epic' }, ADMIN);
  await I.createItem({ ...mut('Barometric Sensitivity'), rarity: 'common' }, ADMIN);
  await I.createItem(mut('Augmented Tapetum'), ADMIN);   // quest: special
  const ticketRare = await I.createItem({ type: 'mutation_ticket', name: 'Phiếu Hiếm', data: { maxRarity: 'rare' } }, ADMIN);
  const ticketSpecial = await I.createItem({ type: 'mutation_ticket', name: 'Phiếu Đặc biệt', data: { maxRarity: 'special' } }, ADMIN);
  assert.equal(ticketRare.rarity, 'rare', 'a ticket shows the rarity it reaches');
  assert.throws(() => I.validateItem({ type: 'mutation_ticket', name: 'x', data: { maxRarity: 'mythic' } }), /maxRarity/);
  const clear = await I.createItem({ type: 'mutation_clear', name: 'Phiếu bỏ', rarity: 'rare', data: {} }, ADMIN);
  const prime = await I.createItem({ type: 'prime_ticket', name: 'Phiếu Prime', rarity: 'legendary', data: {} }, ADMIN);
  const h = await I.grantItem(P3, hydro.id, 'admin', ADMIN);
  const tr = await I.grantItem(P3, ticketRare.id, 'admin', ADMIN);
  const ts = await I.grantItem(P3, ticketSpecial.id, 'admin', ADMIN);
  const cl = await I.grantItem(P3, clear.id, 'admin', ADMIN);
  const pr = await I.grantItem(P3, prime.id, 'admin', ADMIN);

  const store = new Store();
  const t = Math.floor(Date.now() / 1000);
  store.apply({ type: 'session_start', t, steamId: P3, name: 'P3' });
  store.apply({ type: 'spawn', t, steamId: P3, name: 'P3', species: 'BP_Tyrannosaurus_C', growth: 0.6, mutations: { Slot1: 'Efficient Digestion' } });
  const ctx = { store };
  const inbox = () => JSON.parse(rf(join(root, 'garage', 'inbox.json'), 'utf8')).commands;

  // Slots open at 25 / 50 / 75 / 75 % (the game's own, from players' picks).
  assert.match((await startMutationUse(ctx, P3, h.uid, 3)).body.error, /Ô 3 mở từ 75%.*đang 60%/);
  const ok2 = await startMutationUse(ctx, P3, h.uid, 2);
  assert.equal(ok2.status, 202);
  assert.equal(inbox().find((x) => x.id === ok2.body.id).minGrowth, 0.5, 'the mod checks the growth again');
  const pv = (await previewMutationUse(ctx, P3, tr.uid)).body;
  assert.deepEqual(pv.slots.map((x) => x.open), [true, true, false, false]);

  // Phiếu đổi mutation: any mutation still in the game of the species' diet; quest ones on a special ticket only.
  const pool = pv.pool.map((m) => m.name);
  assert.ok(pool.includes('Hydrodynamic') && pool.includes('Hemomania'), 'every normal mutation, with or without an item');
  assert.ok(!pool.includes('Intraspecific Aggression'), 'not one gone from the game');
  assert.ok(!pool.includes('Barometric Sensitivity'), 'a herbivore mutation not offered to a Rex');
  assert.ok(!pool.includes('Augmented Tapetum'), 'a quest mutation only on a special ticket');
  assert.ok((await previewMutationUse(ctx, P3, ts.uid)).body.pool.some((m) => m.name === 'Augmented Tapetum'));
  assert.match((await startMutationUse(ctx, P3, tr.uid, 2, false, 'Augmented Tapetum')).body.error, /trong danh sách/);
  const tk = await startMutationUse(ctx, P3, tr.uid, 2, false, 'Hydrodynamic');
  assert.equal(tk.status, 202);
  assert.deepEqual((({ mode, mutation, slot }) => ({ mode, mutation, slot }))(inbox().find((x) => x.id === tk.body.id)), { mode: 'place', mutation: 'Hydrodynamic', slot: 2 });

  // Phiếu bỏ mutation: a slot that holds one.
  assert.match((await startMutationUse(ctx, P3, cl.uid, 4)).body.error, /Ô 4 đang trống/);
  const c1 = await startMutationUse(ctx, P3, cl.uid, 1);
  assert.deepEqual((({ mode, slot }) => ({ mode, slot }))(inbox().find((x) => x.id === c1.body.id)), { mode: 'clear', slot: 1 });

  // Phiếu Prime: grown and not prime yet.
  assert.match((await startMutationUse(ctx, P3, pr.uid, null)).body.error, /100%/);
  store.apply({ type: 'snapshot', t: t + 1, steamId: P3, name: 'P3', species: 'BP_Tyrannosaurus_C', growth: 1, health: 1 });
  const p1 = await startMutationUse(ctx, P3, pr.uid, null);
  assert.equal(p1.status, 202, JSON.stringify(p1.body));
  assert.equal(inbox().find((x) => x.id === p1.body.id).mode, 'prime');
  store.apply({ type: 'prime', t: t + 2, steamId: P3, name: 'P3', species: 'BP_Tyrannosaurus_C', prime: true, elderStacks: 0 });
  await I.settleUse({ type: 'portal_command', action: 'mutation', id: p1.body.id, ok: false });
  assert.match((await startMutationUse(ctx, P3, pr.uid, null)).body.error, /đã là prime/);
});

test('an item deleted: out of the catalog and of every bag', async () => {
  const it = await I.createItem({ ...mut('Wader'), rarity: 'rare' }, ADMIN);
  await I.grantItem(P1, it.id, 'admin', ADMIN);
  await I.grantItem(P2, it.id, 'admin', ADMIN);
  await I.grantItem(P2, it.id, 'admin', ADMIN);
  const gone = await I.deleteItem(it.id);
  assert.equal(gone.copies, 3);
  assert.equal(await I.getItem(it.id), null);
  assert.ok(!(await I.inventoryOf(P2)).some((o) => o.itemId === it.id));
  assert.equal(await I.deleteItem(it.id), null, 'twice: nothing');
});

test('Túi tăng trưởng and Hộp food: on the dino played now; the growth bag only below its mark, then +its amount', async () => {
  const P5 = '76561198000000025';
  const { readFileSync: rf } = await import('node:fs');
  const bagItem = await I.createItem({ type: 'growth_bag', name: 'Túi tăng trưởng 10%', rarity: 'rare', data: {} }, ADMIN);
  assert.deepEqual(bagItem.data, { amount: 0.1, below: 0.6 }, 'the owner\'s defaults: +10 % under 60 %');
  const food = await I.createItem({ type: 'food_box', name: 'Hộp food lớn', rarity: 'rare', data: { amount: 0.5 } }, ADMIN);
  assert.throws(() => I.validateItem({ type: 'food_box', name: 'x', data: { amount: 2 } }), /amount must be/);
  assert.throws(() => I.validateItem({ type: 'growth_bag', name: 'x', data: { below: 0 } }), /below must be/);
  const g = await I.grantItem(P5, bagItem.id, 'admin', ADMIN);
  const f = await I.grantItem(P5, food.id, 'admin', ADMIN);
  const store = new Store();
  const t = Math.floor(Date.now() / 1000);
  store.apply({ type: 'session_start', t, steamId: P5, name: 'P5' });
  store.apply({ type: 'spawn', t, steamId: P5, name: 'P5', species: 'BP_Triceratops_C', growth: 0.6, mutations: {} });
  const ctx = { store };
  const inbox = () => JSON.parse(rf(join(root, 'garage', 'inbox.json'), 'utf8')).commands;
  assert.match((await startMutationUse(ctx, P5, g.uid, null)).body.error, /dưới 60% \(dino đang 60%\)/);
  store.apply({ type: 'snapshot', t: t + 1, steamId: P5, name: 'P5', species: 'BP_Triceratops_C', growth: 0.55, health: 1 });
  const gr = await startMutationUse(ctx, P5, g.uid, null);
  assert.equal(gr.status, 202, JSON.stringify(gr.body));
  assert.deepEqual((({ mode, amount, below }) => ({ mode, amount, below }))(inbox().find((x) => x.id === gr.body.id)), { mode: 'growth', amount: 0.1, below: 0.6 });
  const fo = await startMutationUse(ctx, P5, f.uid, null);
  assert.equal(fo.status, 202);
  assert.deepEqual((({ mode, amount }) => ({ mode, amount }))(inbox().find((x) => x.id === fo.body.id)), { mode: 'food', amount: 0.5 });
  // Used up only once the mod says it worked (a full dino, a grown one: the item stays).
  await I.settleUse({ type: 'portal_command', id: fo.body.id, action: 'mutation', ok: false });
  assert.ok((await I.inventoryOf(P5)).some((o) => o.uid === f.uid));
  await I.settleUse({ type: 'portal_command', id: gr.body.id, action: 'mutation', ok: true });
  assert.equal((await I.inventoryOf(P5)).some((o) => o.uid === g.uid), false);
});

test('Túi tăng trưởng 5% for every dino (below 100 %) and Đá muối (the sickness after vomiting)', async () => {
  const P6 = '76561198000000026';
  const { readFileSync: rf } = await import('node:fs');
  const five = await I.createItem({ type: 'growth_bag', name: 'Túi tăng trưởng 5%', rarity: 'common', data: { amount: 0.05, below: 1 } }, ADMIN);
  const salt = await I.createItem({ type: 'salt_lick', name: 'Đá muối', rarity: 'rare', data: { anything: 1 } }, ADMIN);
  assert.deepEqual(salt.data, {}, 'nothing to set');
  const g = await I.grantItem(P6, five.id, 'admin', ADMIN);
  const sl = await I.grantItem(P6, salt.id, 'admin', ADMIN);
  const store = new Store();
  const t = Math.floor(Date.now() / 1000);
  store.apply({ type: 'session_start', t, steamId: P6, name: 'P6' });
  store.apply({ type: 'spawn', t, steamId: P6, name: 'P6', species: 'BP_Tyrannosaurus_C', growth: 1, mutations: {} });
  const ctx = { store };
  const inbox = () => JSON.parse(rf(join(root, 'garage', 'inbox.json'), 'utf8')).commands;
  assert.match((await startMutationUse(ctx, P6, g.uid, null)).body.error, /đã 100%/);
  store.apply({ type: 'snapshot', t: t + 1, steamId: P6, name: 'P6', species: 'BP_Tyrannosaurus_C', growth: 0.98, health: 1 });
  const gr = await startMutationUse(ctx, P6, g.uid, null);
  assert.equal(gr.status, 202, '98 %: any dino under 100 %');
  assert.deepEqual((({ mode, amount, below }) => ({ mode, amount, below }))(inbox().find((x) => x.id === gr.body.id)), { mode: 'growth', amount: 0.05, below: 1 });
  const cu = await startMutationUse(ctx, P6, sl.uid, null);
  assert.equal(cu.status, 202);
  assert.equal(inbox().find((x) => x.id === cu.body.id).mode, 'cure');
});
