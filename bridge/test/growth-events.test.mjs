// Growth events (panel → Server → Vận hành, "Sự kiện tốc độ lớn"): GrowthMultiplier
// ×N between a start and an end, applied when the game starts (theisle.service
// ExecStartPre → cli-apply-settings.js --in-place), then back to the panel's value. npm test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'growth-events-'));
const G = await import('../dist/growth-events.js');
const { readManaged } = await import('../dist/gameini.js');
after(() => rmSync(root, { recursive: true, force: true }));
const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'dist', 'cli-apply-settings.js');
const now = Math.floor(Date.now() / 1000);
const H = 3600;

test('what an admin may set', () => {
  assert.throws(() => G.validateGrowthEvent({ start: now, end: now - 1, multiplier: 2 }, now), /sau bắt đầu/);
  assert.throws(() => G.validateGrowthEvent({ start: now - 2 * H, end: now - H, multiplier: 2 }, now), /quá khứ/);
  assert.throws(() => G.validateGrowthEvent({ start: now, end: now + 40 * 86400, multiplier: 2 }, now), /31 ngày/);
  assert.throws(() => G.validateGrowthEvent({ start: now, end: now + H, multiplier: 50 }, now), /0.1 đến 20/);
  assert.throws(() => G.validateGrowthEvent({ start: '2026', end: now + H, multiplier: 2 }, now), /epoch/);
  assert.deepEqual(G.validateGrowthEvent({ start: now, end: now + H, multiplier: 2.345, note: ' Cuối tuần ' }, now),
    { start: now, end: now + H, multiplier: 2.35, note: 'Cuối tuần' });
});

test('which multiplier a start writes', () => {
  const ev = [
    { id: 'a', start: now - H, end: now + H, multiplier: 2, note: null, createdBy: null },
    { id: 'b', start: now - 60, end: now + 60, multiplier: 3, note: null, createdBy: null },
  ];
  assert.deepEqual(G.effectiveGrowth(1, [], now), { multiplier: 1, event: null }, 'no event: the panel\'s');
  assert.equal(G.effectiveGrowth(1, ev.slice(0, 1), now).multiplier, 2);
  assert.equal(G.effectiveGrowth(1, ev, now).event.id, 'b', 'two at once: the latest started');
  assert.equal(G.effectiveGrowth(1.5, ev, now + 2 * H).multiplier, 1.5, 'after the end: the panel\'s again');
  assert.equal(G.effectiveGrowth(1, ev, now + H).multiplier, 1, 'the end itself is outside');
});

test('ExecStartPre: the event\'s multiplier while it runs, the panel\'s after; growth-applied.json says which', () => {
  const dir = join(root, 'data');
  mkdirSync(dir, { recursive: true });
  const ini = join(root, 'Game.ini');
  const settings = join(dir, 'game-settings.json');
  const base = '[/Script/TheIsle.TIGameSession]\nGrowthMultiplier=1\nMaxPlayerCount=100\n';
  writeFileSync(ini, base);
  writeFileSync(settings, JSON.stringify({ GrowthMultiplier: 1 }));
  const start = () => execFileSync('node', [cli, '--in-place', ini, settings], { encoding: 'utf8' });

  const ev = G.addGrowthEvent(dir, { start: now - 60, end: now + H, multiplier: 2, note: 'x2 cuối tuần' }, '76561199320940985');
  start();
  assert.equal(readManaged(readFileSync(ini, 'utf8')).GrowthMultiplier, 2, 'started during the event');
  assert.deepEqual(G.readGrowthApplied(dir).event, { id: ev.id, end: ev.end, note: 'x2 cuối tuần' });
  assert.equal(JSON.parse(readFileSync(settings, 'utf8')).GrowthMultiplier, 1, 'the panel\'s own value is not touched');

  G.removeGrowthEvent(dir, ev.id);
  start();
  assert.equal(readManaged(readFileSync(ini, 'utf8')).GrowthMultiplier, 1, 'no event: back to the panel\'s');
  assert.equal(G.readGrowthApplied(dir).event, null);

  // Not yet started: nothing changes until then.
  G.addGrowthEvent(dir, { start: now + H, end: now + 2 * H, multiplier: 3 }, null);
  start();
  assert.equal(readManaged(readFileSync(ini, 'utf8')).GrowthMultiplier, 1);
});

test('what the players hear once the game is up: the event, or that it ended; once', () => {
  const dir = join(root, 'data2');
  mkdirSync(dir, { recursive: true });
  const ini = join(root, 'Game2.ini');
  const settings = join(dir, 'game-settings.json');
  writeFileSync(ini, '[/Script/TheIsle.TIGameSession]\nGrowthMultiplier=1\n');
  writeFileSync(settings, JSON.stringify({ GrowthMultiplier: 1 }));
  const start = () => execFileSync('node', [cli, '--in-place', ini, settings], { encoding: 'utf8' });
  const ev = G.addGrowthEvent(dir, { start: now - 60, end: now + H, multiplier: 2, note: 'Cuối tuần' }, null);
  start();
  const on = G.startNotice(G.readGrowthApplied(dir), now + 120);
  assert.equal(on.key, 'growth.event.on');
  assert.equal(on.vars.multiplier, '2');
  assert.equal(G.startNotice(G.readGrowthApplied(dir), now + 3 * H), null, 'an old start: not this one');
  G.removeGrowthEvent(dir, ev.id);
  start();
  const off = G.startNotice(G.readGrowthApplied(dir), now + 120);
  assert.deepEqual([off.key, off.vars.multiplier], ['growth.event.off', '2']);
  start();
  assert.equal(G.startNotice(G.readGrowthApplied(dir), now + 120), null, 'the next start: nothing more to say');
});
