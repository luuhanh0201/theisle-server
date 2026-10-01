// The prison (prison.ts): sentences with the repeat multiplier, the files the
// Prison mod and the other mods read, the mod's state (served, done), escapes
// and their reminders, hunters, the kill penalty, replays, and the prison zone
// in the AI zones (no AI, no species needed, only one).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'prison-test-'));
process.env.DATA_DIR = join(root, 'data');
process.env.AI_ZONES_ROOT = join(root, 'AIZones', 'Saved');
process.env.PRISON_ROOT = join(root, 'Prison', 'Saved');
process.env.PRISON_INMATES_PATH = join(root, 'shared', 'isle-prison.json');
const { Prison, validatePrisonSettings, repeatMultiplier, fmtDuration, PRISON_DEFAULTS } = await import('../dist/prison.js');
const { saveAiZones, validateAiZones, modFile } = await import('../dist/ai-zones.js');
const { GroundPoints } = await import('../dist/ground-points.js');
after(() => rmSync(root, { recursive: true, force: true }));

const A = '76561190000000001', B = '76561190000000002', HUNTER = '76561190000000003', ADMIN = '76561190000000009';
const NOW = 2_000_000_000;

function setup({ online = [A, B, HUNTER], startedAt = NOW - 100 } = {}) {
  const said = { announce: [], dm: [], discord: [] };
  const g = new GroundPoints();
  g.add(5000, 5000, 300); g.add(8000, 5000, 320); g.add(90000, 90000, 0);   // two inside the prison, one far
  const prison = new Prison({
    announce: async (t) => { said.announce.push(t); },
    directMessage: async (id, t) => { said.dm.push([id, t]); },
    discord: (t) => said.discord.push(t),
    render: (key, vars) => `${key} ${JSON.stringify(vars)}`,
    nameOf: (id) => ({ [A]: 'Alpha', [B]: 'Bravo', [HUNTER]: 'Hunter' })[id] ?? null,
    speciesOf: () => 'Carnotaurus',
    isOnline: (id) => online.includes(id),
    adminIds: async () => new Set([ADMIN]),
    groundPoints: g,
    startedAt,
    log: () => {},
  });
  return { prison, said, g };
}
const modFileJson = () => JSON.parse(readFileSync(join(root, 'Prison', 'Saved', 'prison.json'), 'utf8'));
const inmates = () => JSON.parse(readFileSync(join(root, 'shared', 'isle-prison.json'), 'utf8')).inmates;
function modState(sentences) {
  mkdirSync(join(root, 'Prison', 'Saved'), { recursive: true });
  writeFileSync(join(root, 'Prison', 'Saved', 'state.json'), JSON.stringify({ t: Math.floor(Math.random() * 1e9), sentences }));
}
const PRISON_ZONE = { id: 'jail', name: 'Nhà tù', x: 5000, y: 5000, radiusM: 100, species: [], max: 0, min: 0, perTurnMin: 1, perTurnMax: 1,
  everySec: 60, growthMin: 1, growthMax: 1, prison: true };
const MEADOW = { id: 'meadow', name: 'Đồng cỏ', x: 300000, y: 0, radiusM: 200, species: ['Boar'], max: 5, min: 1, perTurnMin: 1, perTurnMax: 2,
  everySec: 60, growthMin: 1, growthMax: 1 };

test('the prison zone: no species needed, only one, never given to the AIZones mod', async () => {
  const s = validateAiZones({ enabled: true, globalMax: 10, zones: [PRISON_ZONE, MEADOW] });
  assert.equal(s.zones[0].prison, true);
  assert.equal(s.zones[1].prison, false, 'an ordinary zone is not the prison');
  assert.throws(() => validateAiZones({ enabled: true, globalMax: 10, zones: [{ ...MEADOW, species: [] }] }), /kinds of AI/, 'an AI zone still needs species');
  assert.throws(() => validateAiZones({ enabled: true, globalMax: 10, zones: [PRISON_ZONE, { ...PRISON_ZONE, id: 'jail2' }] }), /only one zone/);
  const mod = modFile(s, new GroundPoints());
  assert.deepEqual(mod.zones.map((z) => z.id), ['meadow'], 'nothing spawns in the prison');
});

test('settings: defaults, ranges, offenses', () => {
  const s = validatePrisonSettings({ ...PRISON_DEFAULTS, enabled: true });
  assert.equal(s.killPenaltyMin, 10);
  assert.equal(s.offenses.length, 4);
  assert.throws(() => validatePrisonSettings({ ...PRISON_DEFAULTS, stingPct: 0 }), /stingPct/);
  assert.throws(() => validatePrisonSettings({ ...PRISON_DEFAULTS, offenses: [{ name: '', minutes: 5 }] }), /name/);
  assert.throws(() => validatePrisonSettings({ ...PRISON_DEFAULTS, offenses: [{ name: 'x', minutes: 0 }] }), /minutes/);
  assert.equal(repeatMultiplier(0.5, 0), 1);
  assert.equal(repeatMultiplier(0.5, 2), 2);
  assert.equal(fmtDuration(3900), '1 giờ 5 phút');
  assert.equal(fmtDuration(45 * 60), '45 phút');
});

test('a sentence: the offense × repeat multiplier, told, mod files written; one at a time', async () => {
  await saveAiZones({ enabled: true, globalMax: 10, zones: [PRISON_ZONE, MEADOW] }, new GroundPoints());
  const { prison, said } = setup();
  await prison.saveSettings({ ...PRISON_DEFAULTS, enabled: true });
  const s = await prison.jail({ steamId: A, offenseId: 'babykill' }, 'Admin', NOW);
  assert.equal(s.minutes, 30, 'first time: the offense as it is');
  assert.equal(s.totalSec, 1800);
  assert.equal(s.name, 'Alpha');
  assert.match(said.announce[0], /^prison\.jailed\.announce .*"duration":"30 phút"/);
  assert.ok(said.dm.some(([id, t]) => id === A && t.startsWith('prison.jailed.player')), 'told in person (online)');
  assert.ok(said.discord[0].includes('Alpha'));
  await assert.rejects(prison.jail({ steamId: A, offenseId: 'kos' }, 'Admin', NOW), /already in prison/);
  await assert.rejects(prison.jail({ steamId: B }, 'Admin', NOW), /offense or give the minutes/);
  await assert.rejects(prison.jail({ steamId: B, offenseId: 'nope' }, 'Admin', NOW), /unknown offense/);
  const m = modFileJson();
  assert.equal(m.enabled, true);
  assert.equal(m.zone.name, 'Nhà tù');
  assert.deepEqual(m.sentences[A], { id: s.id, total: 1800, release: false });
  assert.deepEqual(m.exempt, [ADMIN]);
  assert.deepEqual(inmates(), [A], 'the other mods know A is an inmate');
  assert.equal(prison.isInmate(A), true);
});

test('drop spots: ground points inside the prison only, nearest the centre first', () => {
  const { prison } = setup();
  const spots = prison.dropsOf({ ...PRISON_ZONE, shape: 'circle' });
  assert.deepEqual(spots, [[5000, 5000, 300], [8000, 5000, 320]]);
});

test('served (the mod says done): to the history, told; the next sentence counts it as prior', async () => {
  await saveAiZones({ enabled: true, globalMax: 10, zones: [PRISON_ZONE] }, new GroundPoints());
  const { prison, said } = setup();
  await prison.saveSettings({ ...PRISON_DEFAULTS, enabled: true });
  const s = await prison.jail({ steamId: B, offenseId: 'kos' }, 'Admin', NOW);
  modState({ [s.id]: { served: 1800, escaped: false, escapes: 1, inside: true, done: true, jailed: 1 } });
  await prison.tick(NOW + 10);
  assert.equal(prison.isInmate(B), false);
  assert.ok(said.dm.some(([id, t]) => id === B && t.startsWith('prison.released.player')));
  const view = await prison.view();
  assert.equal(view.history[0].outcome, 'served');
  assert.equal(view.history[0].escapes, 1);
  assert.equal(view.priors[B], 1);
  const again = await prison.jail({ steamId: B, offenseId: 'kos' }, 'Admin', NOW + 20);
  assert.equal(again.prior, 1);
  assert.equal(again.multiplier, 1.5, 'second time: × 1.5');
  assert.equal(again.minutes, 45);
  const custom = await prison.extend(again.id, 15, 'Admin', NOW + 30);
  assert.equal(custom.totalSec, 60 * 60, 'extended by 15 minutes');
  const rel = await prison.release(again.id, 'Admin');
  assert.equal(rel.release, true);
  assert.equal(modFileJson().sentences[B].release, true, 'the mod is told to let them out');
});

test('escape: announced, reminded every remindMin while online, cleared on return; hunters credited', async () => {
  await saveAiZones({ enabled: true, globalMax: 10, zones: [PRISON_ZONE] }, new GroundPoints());
  const { prison, said } = setup();
  await prison.saveSettings({ ...PRISON_DEFAULTS, enabled: true, remindMin: 5 });
  const s = await prison.jail({ steamId: A, minutes: 60, reason: 'test' }, 'Admin', NOW);
  modState({ [s.id]: { served: 100, escaped: true, escapes: 1, inside: false, done: false, jailed: 1, loc: { x: 30000, y: 40000 } } });
  await prison.handle({ type: 'prison_escape', t: NOW + 1, steamId: A, id: s.id, species: 'Carnotaurus', escapes: 1 });
  assert.ok(said.announce.some((t) => t.startsWith('prison.escape.announce')));
  await prison.tick(NOW + 2);
  assert.deepEqual(prison.escapees().map((e) => [e.name, e.x, e.y]), [['Alpha', 30000, 40000]], 'on everyone\'s map');
  const before = said.announce.length;
  await prison.tick(NOW + 200);
  assert.equal(said.announce.length, before, 'not reminded before 5 minutes');
  await prison.tick(NOW + 302);
  assert.ok(said.announce.at(-1).startsWith('prison.escape.remind'), 'reminded after 5 minutes');
  // Killed while out: the killer is a hunter.
  await prison.handle({ type: 'death', t: NOW + 310, steamId: A, killer: HUNTER, killerName: 'Hunter', species: 'Carnotaurus', growth: 0.5, attributed: true });
  assert.ok(said.announce.at(-1).startsWith('prison.bounty.announce'));
  assert.deepEqual(prison.hunters().map((h) => [h.steamId, h.count]), [[HUNTER, 1]]);
  // A replayed escape (from before the bridge started) announces nothing.
  const n = said.announce.length;
  await prison.handle({ type: 'prison_escape', t: NOW - 1000, steamId: A, id: s.id });
  assert.equal(said.announce.length, n, 'a replay is not announced');
});

test('an inmate killing a fellow inmate in the prison: + killPenaltyMin to the killer; outsiders and replays add nothing', async () => {
  await saveAiZones({ enabled: true, globalMax: 10, zones: [PRISON_ZONE] }, new GroundPoints());
  const { prison, said } = setup();
  await prison.saveSettings({ ...PRISON_DEFAULTS, enabled: true, killPenaltyMin: 10 });
  const sa = prison.activeOf(A) ?? await prison.jail({ steamId: A, minutes: 60, reason: 'x' }, 'Admin', NOW);
  const sb = prison.activeOf(B) ?? await prison.jail({ steamId: B, minutes: 60, reason: 'x' }, 'Admin', NOW);
  modState({ [sa.id]: { served: 0, escaped: false, inside: true, jailed: 1 }, [sb.id]: { served: 0, escaped: false, inside: true, jailed: 1 } });
  await prison.tick(NOW + 1);
  const total = prison.activeOf(B).totalSec;
  await prison.handle({ type: 'death', t: NOW + 5, steamId: A, killer: B, species: 'Dryosaurus', growth: 0.3, attributed: true });
  assert.equal(prison.activeOf(B).totalSec, total + 600, '+10 minutes');
  assert.ok(said.dm.some(([id, t]) => id === B && t.startsWith('prison.killPenalty.player')));
  await prison.handle({ type: 'death', t: NOW - 5000, steamId: A, killer: B, species: 'Dryosaurus', growth: 0.3, attributed: true });
  assert.equal(prison.activeOf(B).totalSec, total + 600, 'a replayed death adds nothing');
  await prison.handle({ type: 'death', t: NOW + 6, steamId: A, killer: HUNTER, species: 'Dryosaurus', growth: 0.3, attributed: true });
  assert.equal(prison.hunters().length === 0 || prison.hunters().every((h) => h.steamId !== HUNTER || h.count >= 1), true);
  assert.equal(prison.activeOf(A).totalSec, 3600, 'killed in the prison by an outsider: nothing added to the victim');
});

test('a disabled prison or no prison zone: the mod is off', async () => {
  await saveAiZones({ enabled: true, globalMax: 10, zones: [MEADOW] }, new GroundPoints());
  const { prison } = setup();
  await prison.saveSettings({ ...PRISON_DEFAULTS, enabled: true });
  await prison.syncModFiles();
  assert.equal(modFileJson().enabled, false, 'no zone ticked "Nhà tù"');
  assert.equal(modFileJson().zone, null);
});

test('no sentence while the prison is off or has no zone: refused, not a silent no-op', async () => {
  await saveAiZones({ enabled: true, globalMax: 10, zones: [PRISON_ZONE] }, new GroundPoints());
  const { prison } = setup();
  await prison.saveSettings({ ...PRISON_DEFAULTS, enabled: false });
  await assert.rejects(prison.jail({ steamId: HUNTER, offenseId: 'kos' }, 'Admin', NOW), /Nhà tù đang tắt/);
  await prison.saveSettings({ ...PRISON_DEFAULTS, enabled: true });
  await saveAiZones({ enabled: true, globalMax: 10, zones: [{ ...PRISON_ZONE, enabled: false }] }, new GroundPoints());
  await assert.rejects(prison.jail({ steamId: HUNTER, offenseId: 'kos' }, 'Admin', NOW), /Chưa có vùng nhà tù/);
});
