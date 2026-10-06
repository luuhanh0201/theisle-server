// The bag's items for the player site's flows (Túi đồ, Cửa hàng): one of each kind made through the local bridge's
// admin API (as the panel does), given to "Live Tester" (in game, a Tyrannosaurus: 5 copies, enough for the old page
// and the React one to each use one after a refused try, and run again) and to "Rex Tester" (not in game: 1 copy each).
// The dino boxes draw a fixed growth: the flows compare what both sites show.
//   node e2e/seed-bag.mjs [bridge url] [admin token]        (local-portal.sh runs it)
const BRIDGE = process.argv[2] ?? 'http://127.0.0.1:8091';
const TOKEN = process.argv[3] ?? 'e2e-local-token';
const LIVE = '76561198000000013';
const REX = '76561198000000011';
const post = async (path, body) => {
  const r = await fetch(`${BRIDGE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN }, body: JSON.stringify(body) });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(b)}`);
  return b;
};
const make = async (def) => (await post('/api/items', def)).item.id;
const C = (r, g, b) => ({ r, g, b });

const ids = {};
ids.mutAll = await make({ type: 'mutation', name: 'Hồi máu nhanh', rarity: 'rare', data: { mutation: 'Cellular Regeneration' } });
ids.mutHerb = await make({ type: 'mutation', name: 'Báo bão', rarity: 'common', data: { mutation: 'Barometric Sensitivity' } });
ids.mutSlot2 = await make({ type: 'mutation', name: 'Ăn hồi máu', rarity: 'epic', data: { mutation: 'Gastronomic Regeneration' } });
ids.ticket = await make({ type: 'mutation_ticket', name: 'Phiếu đổi mutation', data: { maxRarity: 'epic' } });
ids.clear = await make({ type: 'mutation_clear', name: 'Phiếu bỏ mutation', rarity: 'rare' });
ids.prime = await make({ type: 'prime_ticket', name: 'Phiếu Prime', rarity: 'legendary' });
ids.growth = await make({ type: 'growth_bag', name: 'Túi tăng trưởng', rarity: 'rare', data: { amount: 0.1, below: 0.6 } });
ids.food = await make({ type: 'food_box', name: 'Hộp food', rarity: 'common', data: { amount: 0.2 } });
ids.salt = await make({ type: 'salt_lick', name: 'Đá muối', rarity: 'rare' });
ids.boxRandom = await make({ type: 'dino_box', name: 'Hộp dino ngẫu nhiên', rarity: 'epic', data: { pick: 'random', growthMin: 0.8, growthMax: 0.8 } });
ids.boxChoose = await make({ type: 'dino_box', name: 'Hộp dino tự chọn', rarity: 'legendary', data: { pick: 'choose', growthMin: 0.55, growthMax: 0.55 } });
ids.skinRex = await make({ type: 'skin', name: 'Rex lửa', rarity: 'epic', data: { species: 'Tyrannosaurus', colors: { Body: C(0.6, 0.1, 0.05), Flank: C(0.3, 0.05, 0.02), Eyes: C(1, 0.8, 0) } } });
ids.skinStego = await make({ type: 'skin', name: 'Stego rêu', rarity: 'common', data: { species: 'Stegosaurus', colors: { Body: C(0.1, 0.3, 0.1) } } });
ids.loot = await make({ type: 'loot_box', name: 'Hòm cổ đại', rarity: 'legendary',
  data: { pool: [{ itemId: ids.food, qty: 2, weight: 70 }, { itemId: ids.growth, qty: 1, weight: 25 }, { itemId: ids.prime, qty: 1, weight: 5 }] } });

const give = async (steamId, id, n) => { for (let i = 0; i < n; i++) await post(`/api/items/${id}/grant`, { steamId, note: 'e2e' }); };
for (const [k, id] of Object.entries(ids)) {
  // A skin is owned once; the rest: 5 copies to Live Tester, 1 to Rex.
  await give(LIVE, id, k.startsWith('skin') ? 1 : 5);
  await give(REX, id, 1);
}
console.log(`bag seeded: ${Object.keys(ids).length} items`);
