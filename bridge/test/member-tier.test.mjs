// Who is who (member-tier.ts): admin over SVip over VIP over a plain player; written for the mod's
// garage (garage-settings.json members), the panel's own garage settings kept. npm test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'member-tier-'));
const ADMIN = '76561198000000001', SV = '76561198000000002', VIP = '76561198000000003', BOTH = '76561198000000004', PLAIN = '76561198000000005';
process.env.DATA_DIR = join(root, 'data');
process.env.GARAGE_ROOT = join(root, 'garage');
process.env.GAME_CONFIG_DIR = join(root, 'cfg');
process.env.ADMIN_STEAM_IDS = ADMIN;
process.env.SUPER_ADMIN_STEAM_ID = ADMIN;   // the deploy's own .env must not add one
for (const d of ['data', 'garage', 'cfg']) mkdirSync(join(root, d), { recursive: true });
writeFileSync(join(root, 'data', 'game-settings.json'), JSON.stringify({ VIPs: [VIP, BOTH] }));
writeFileSync(join(root, 'data', 'svip.json'), JSON.stringify({ players: [{ steamId: SV, note: '', addedAt: 1, by: null }, { steamId: BOTH, note: '', addedAt: 1, by: null }], features: {} }));
const T = await import('../dist/member-tier.js');
const { saveGarageSettings } = await import('../dist/garage.js');
after(() => rmSync(root, { recursive: true, force: true }));

test('the highest tier wins; anyone else is a plain player', async () => {
  assert.deepEqual(await T.memberTiers(), { [ADMIN]: 'admin', [SV]: 'svip', [VIP]: 'vip', [BOTH]: 'svip' });
  assert.equal(await T.tierOf(PLAIN), 'normal');
  assert.equal(await T.tierOf(BOTH), 'svip', 'VIP and SVip: SVip');
});

test('written for the mod once, the panel\'s garage settings kept', async () => {
  await saveGarageSettings({ redeemAt: 'stored', maxSlots: 4, cooldown: 100 });
  assert.equal(await T.syncGarageMembers(), true);
  assert.equal(await T.syncGarageMembers(), false, 'nothing changed: not written');
  const file = JSON.parse(readFileSync(join(root, 'garage', 'garage-settings.json'), 'utf8'));
  assert.equal(file.maxSlots, 4);
  assert.equal(file.redeemAt, 'stored');
  assert.equal(file.members[SV], 'svip');
});
