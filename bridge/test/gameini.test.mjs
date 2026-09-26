// Panel-managed Game.ini keys: validation, applying by section + key name, the
// CLI deploy.sh and the unit's ExecStartPre use, and the live save with its backup.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'gameini-test-'));
process.env.DATA_DIR = join(root, 'data');
process.env.GAME_CONFIG_DIR = join(root, 'cfg');
mkdirSync(process.env.GAME_CONFIG_DIR);
const { applySettings, validateSettings, readManaged, saveSettings, readLive } = await import('../dist/gameini.js');
after(() => rmSync(root, { recursive: true, force: true }));

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_RENDERED = readFileSync(join(here, '..', '..', 'config', 'Game.ini.template'), 'utf8')
  .replace('${MAX_PLAYERS}', '100').replace('${SERVER_NAME}', 'Test');

test('validation keeps managed keys, types them, rejects the rest', () => {
  assert.deepEqual(validateSettings({ MaxPlayerCount: '80', bEnableHumans: false, AllowedClasses: 'Carnotaurus, Dryosaurus Carnotaurus' }),
    { MaxPlayerCount: 80, bEnableHumans: false, AllowedClasses: ['Carnotaurus', 'Dryosaurus'] });
  assert.throws(() => validateSettings({ RconPassword: 'x' }), /not a panel-managed/);
  assert.throws(() => validateSettings({ MaxPlayerCount: 0 }), /1–500/);
  assert.throws(() => validateSettings({ bEnableHumans: 'yes' }), /true or false/);
  assert.throws(() => validateSettings({ WhitelistIDs: ['123'] }), /SteamID64/);
  assert.throws(() => validateSettings({ AllowedClasses: ['Rex\nRconPassword=x'] }), /valid/);
  assert.deepEqual(validateSettings({ MaxPlayerCount: null }), { MaxPlayerCount: null }, 'null = no line, game default');
});

test('apply: in the right section; defaults kept for unset keys', () => {
  const out = applySettings(TEMPLATE_RENDERED, { MaxPlayerCount: 60, AllowedClasses: ['Carnotaurus', 'Dryosaurus'], VIPs: ['76561198000000001'] });
  const m = readManaged(out);
  assert.equal(m.MaxPlayerCount, 60);
  assert.equal(m.bEnableHumans, false, 'template default kept');
  assert.deepEqual(m.AllowedClasses, ['Carnotaurus', 'Dryosaurus']);
  assert.equal((out.match(/^MaxPlayerCount=/gm) ?? []).length, 1, 'never duplicated');
  assert.match(out, /ServerName=Test/, 'everything else untouched');
  // AllowedClasses lines sit in the TIGameStateBase block, not TIGameSession.
  const stateBase = out.slice(out.indexOf('[/Script/TheIsle.TIGameStateBase]'));
  assert.match(stateBase, /AllowedClasses=Carnotaurus/);
});

test('apply is idempotent and an empty list clears the key', () => {
  const once = applySettings(TEMPLATE_RENDERED, { AllowedClasses: ['Carnotaurus'] });
  assert.equal(applySettings(once, { AllowedClasses: ['Carnotaurus'] }), once);
  const cleared = applySettings(once, { AllowedClasses: [] });
  assert.doesNotMatch(cleared, /AllowedClasses=/, 'an empty list removes the key');
});

// Exactly what the game wrote over Game.ini on the VPS (2026-09-23): its own
// header, every comment gone, and a key it saved itself (AIDensity).
const GAME_REWRITTEN = [
  ';METADATA=(Diff=true, UseCommands=true)',
  '[/Script/TheIsle.TIGameSession]',
  'ServerName=Test',
  'RconPassword=secret',
  'bEnableHumans=false',
  'MaxPlayerCount=100',
  'AIDensity=1',
  '',
  '[/Script/TheIsle.TIGameStateBase]',
  'AdminsSteamIDs=76561198000000009',
  'AllowedClasses=Beipiaosaurus',
  'AllowedClasses=Troodon',
  '',
  '',
].join('\n');

test('works on the file as the game rewrites it (no comments)', () => {
  const out = applySettings(GAME_REWRITTEN, { MaxPlayerCount: 60, AllowedClasses: ['Carnotaurus'], VIPs: ['76561198000000001'] });
  assert.equal(out, [
    ';METADATA=(Diff=true, UseCommands=true)',
    '[/Script/TheIsle.TIGameSession]',
    'ServerName=Test',
    'RconPassword=secret',
    'bEnableHumans=false',
    'MaxPlayerCount=60',
    'AIDensity=1',
    '',
    '[/Script/TheIsle.TIGameStateBase]',
    'AdminsSteamIDs=76561198000000009',
    'AllowedClasses=Carnotaurus',
    'VIPs=76561198000000001',
    '',
    '',
  ].join('\n'), 'replaced in place, new key after the last line, everything else untouched');
  assert.equal(applySettings(out, { MaxPlayerCount: 60, AllowedClasses: ['Carnotaurus'], VIPs: ['76561198000000001'] }), out, 'idempotent');
  assert.doesNotMatch(applySettings(out, { AllowedClasses: [] }), /AllowedClasses=/, 'an empty list removes the key');
});

test('a key only counts in its own section; a missing section is appended', () => {
  const ini = '[/Script/TheIsle.TIGameSession]\nAllowedClasses=Stray\nMaxPlayerCount=1\n';
  const out = applySettings(ini, { MaxPlayerCount: 5, AllowedClasses: ['Troodon'] });
  assert.equal(out, '[/Script/TheIsle.TIGameSession]\nAllowedClasses=Stray\nMaxPlayerCount=5\n\n[/Script/TheIsle.TIGameStateBase]\nAllowedClasses=Troodon');
  assert.equal(applySettings('[/Script/TheIsle.TIGameSession]\n', { AllowedClasses: [] }), '[/Script/TheIsle.TIGameSession]\n', 'nothing to write, no empty section');
});

test('deploy CLI: same result as the bridge, and fails loudly', () => {
  const ini = join(root, 'rendered.ini');
  const settings = join(root, 'settings.json');
  writeFileSync(ini, TEMPLATE_RENDERED);
  writeFileSync(settings, JSON.stringify({ MaxPlayerCount: 42 }));
  const cli = join(here, '..', 'dist', 'cli-apply-settings.js');
  const out = execFileSync('node', [cli, ini, settings], { encoding: 'utf8' });
  assert.equal(out, applySettings(TEMPLATE_RENDERED, { MaxPlayerCount: 42 }));
  const none = execFileSync('node', [cli, ini, join(root, 'missing.json')], { encoding: 'utf8' });
  assert.equal(readManaged(none).MaxPlayerCount, 100, 'no settings file = template defaults');
  writeFileSync(settings, JSON.stringify({ RconPassword: 'x' }));
  assert.throws(() => execFileSync('node', [cli, ini, settings], { stdio: 'pipe' }), /not a panel-managed/);
});

test('ExecStartPre CLI: re-applies in place, no-op without settings', () => {
  const cli = join(here, '..', 'dist', 'cli-apply-settings.js');
  const ini = join(root, 'live.ini');
  const settings = join(root, 'live-settings.json');
  writeFileSync(ini, GAME_REWRITTEN);
  execFileSync('node', [cli, '--in-place', ini, join(root, 'none.json')]);
  assert.equal(readFileSync(ini, 'utf8'), GAME_REWRITTEN, 'no settings file: untouched');
  writeFileSync(settings, JSON.stringify({ AllowedClasses: [] }));
  execFileSync('node', [cli, '--in-place', ini, settings]);
  assert.equal(readFileSync(ini, 'utf8'), applySettings(GAME_REWRITTEN, { AllowedClasses: [] }));
});

test('live save: validates first, backs up, writes settings and Game.ini', async () => {
  const live = join(process.env.GAME_CONFIG_DIR, 'Game.ini');
  writeFileSync(live, TEMPLATE_RENDERED);
  await assert.rejects(() => saveSettings({ MaxPlayerCount: 9999 }), /1–500/);
  assert.equal(readFileSync(live, 'utf8'), TEMPLATE_RENDERED, 'a rejected save changes nothing');

  await saveSettings({ MaxPlayerCount: 70, bEnableHumans: true });
  const state = await readLive();
  assert.deepEqual(state.settings, { MaxPlayerCount: 70, bEnableHumans: true });
  assert.equal(state.effective.MaxPlayerCount, 70);
  assert.equal(state.effective.bEnableHumans, true);
  assert.equal(readdirSync(join(process.env.DATA_DIR, 'ini-backups')).length, 1);
  assert.match(readFileSync(live, 'utf8'), /RconPassword=\$\{RCON_PASSWORD\}|RconPassword=/, 'rest of the file preserved');
});

test('the known roster is valid AllowedClasses input and renders one line each', async () => {
  const { KNOWN_PLAYABLES } = await import('../dist/gameini.js');
  assert.equal(KNOWN_PLAYABLES.length, 22);
  const settings = validateSettings({ AllowedClasses: KNOWN_PLAYABLES });
  const out = applySettings(TEMPLATE_RENDERED, settings);
  assert.equal((out.match(/^AllowedClasses=/gm) ?? []).length, 22);
  assert.match(out, /^AllowedClasses=Tyrannosaurus$/m);
});

test('float and text keys: validated, rendered, read back', async () => {
  const { MANAGED, GROUPS } = await import('../dist/gameini.js');
  const s = validateSettings({ AIDensity: '1.5', GrowthMultiplier: 2, ServerName: '  [VN] Test - Sandbox  ', Discord: '' });
  assert.deepEqual(s, { AIDensity: 1.5, GrowthMultiplier: 2, ServerName: '[VN] Test - Sandbox', Discord: null },
    'empty text = no line (the game would show "None")');
  assert.throws(() => validateSettings({ AIDensity: 9 }), /0–5/);
  assert.throws(() => validateSettings({ AIDensity: 'lots' }), /number/);
  assert.throws(() => validateSettings({ ServerName: 'x\nRconPassword=pwned' }), /single line/, 'no key injection');
  assert.throws(() => validateSettings({ ServerName: 'x'.repeat(101) }), /100/);
  const out = applySettings(GAME_REWRITTEN, s);
  assert.match(out, /^AIDensity=1\.5$/m);
  assert.equal((out.match(/^AIDensity=/gm) ?? []).length, 1, 'the game-written AIDensity line is replaced, not doubled');
  assert.match(out, /^ServerName=\[VN\] Test - Sandbox$/m);
  const back = readManaged(out);
  assert.equal(back.AIDensity, 1.5);
  assert.equal(back.ServerName, '[VN] Test - Sandbox');
  // Every key has a group the panel knows and a default of its own type.
  for (const [key, spec] of Object.entries(MANAGED)) {
    assert.ok(spec.group in GROUPS, `${key}: unknown group ${spec.group}`);
    if (spec.type !== 'list') {
      const t = spec.type === 'bool' ? 'boolean' : spec.type === 'text' ? 'string' : 'number';
      assert.equal(typeof spec.default, t, `${key}: default type`);
    }
  }
  // Names as the live server has them, not as some hosting docs spell them.
  assert.ok('bRandomWeatherEnabled' in MANAGED && !('bServerDynamicWeather' in MANAGED));
  assert.ok('SpeciesMigrationTime' in MANAGED && !('MaxMigrationTime' in MANAGED));
  // Keys the panel must never own.
  for (const k of ['RconPassword', 'RconPort', 'QueuePort', 'ServerPassword', 'MapName']) {
    assert.ok(!(k in MANAGED), `${k} must stay out of the panel`);
  }
});

test('null removes the key so the game uses its own default', () => {
  const out = applySettings(GAME_REWRITTEN, validateSettings({ AIDensity: null, bUseRegionSpawning: null }));
  assert.doesNotMatch(out, /^AIDensity=/m, 'existing line removed');
  assert.doesNotMatch(out, /bUseRegionSpawning/, 'nothing written for an absent key');
  assert.match(out, /^MaxPlayerCount=100$/m, 'other keys untouched');
});

test('admins: panel-owned, SteamID64 only, never emptied', () => {
  assert.deepEqual(validateSettings({ AdminsSteamIDs: '76561198000000009, 76561198000000010' }),
    { AdminsSteamIDs: ['76561198000000009', '76561198000000010'] });
  assert.throws(() => validateSettings({ AdminsSteamIDs: [] }), /at least 1/, 'no lock-out');
  assert.throws(() => validateSettings({ AdminsSteamIDs: ['123'] }), /SteamID64/);
  const out = applySettings(GAME_REWRITTEN, { AdminsSteamIDs: ['76561198000000010', '76561198000000011'] });
  assert.equal((out.match(/^AdminsSteamIDs=/gm) ?? []).length, 2);
  assert.doesNotMatch(out, /76561198000000009/, 'replaced, not appended');
  const state = out.slice(out.indexOf('[/Script/TheIsle.TIGameStateBase]'));
  assert.match(state, /^AdminsSteamIDs=76561198000000010$/m, 'in TIGameStateBase');
});

test('the ambient fish numbers go in their own section, the rest untouched', () => {
  const ini = '[/Script/TheIsle.TIGameSession]\nbSpawnAI=true\n';
  const out = applySettings(ini, { MaxAmbientFishPerPlayer: 20, AmbientFishSoftLimitPerWater: 40, AmbientFishSpawnAttemptsPerPlayer: 2 });
  assert.match(out, /\[\/Script\/TheIsle\.TIGameSession\]\nbSpawnAI=true\n/);
  assert.match(out, /\[\/Script\/TheIsle\.TIAIWorldSpawner\]\nMaxAmbientFishPerPlayer=20\nAmbientFishSoftLimitPerWater=40\nAmbientFishSpawnAttemptsPerPlayer=2/);
  assert.deepEqual(readManaged(out).MaxAmbientFishPerPlayer, 20);
  assert.equal(applySettings(out, { MaxAmbientFishPerPlayer: 20, AmbientFishSoftLimitPerWater: 40, AmbientFishSpawnAttemptsPerPlayer: 2 }), out, 'idempotent');
});
