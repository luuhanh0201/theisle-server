/**
 * Apply the panel-managed Game.ini settings outside the bridge process.
 *
 *   node cli-apply-settings.js <Game.ini> <game-settings.json>
 *     deploy.sh: writes the Game.ini with the panel's settings to stdout.
 *
 *   node cli-apply-settings.js --in-place <Game.ini> <game-settings.json>
 *     theisle.service ExecStartPre: rewrites the live Game.ini before every
 *     start. The game saves its own in-memory config over Game.ini (e.g. after
 *     an RCON setting change), which can undo a panel save made while it ran;
 *     this puts the panel's values back. No settings file = nothing to do.
 *     A growth event running now (growth-events.ts) sets GrowthMultiplier over
 *     the panel's; what was written goes to growth-applied.json.
 *
 * An empty or missing settings file leaves the template defaults. Any error
 * exits non-zero so deploy stops instead of shipping a Game.ini that drops the
 * panel's work.
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { applySettings, validateSettings, withoutAdmins, type Settings } from './gameini.js';
import { config } from './config.js';
import { effectiveGrowth, readGrowthApplied, readGrowthEvents, writeGrowthApplied } from './growth-events.js';

const args = process.argv.slice(2);
const inPlace = args[0] === '--in-place';
const [iniPath, settingsPath] = inPlace ? args.slice(1) : args;
if (iniPath === undefined || settingsPath === undefined) {
  console.error('usage: cli-apply-settings [--in-place] <Game.ini> <game-settings.json>');
  process.exit(2);
}

function readSettings(path: string): Settings | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
  return raw === '' ? null : validateSettings(JSON.parse(raw));
}

/** Admins switched off in game (panel → Phân quyền), from admin-permissions.json next to the settings. */
function inGameOff(settingsFile: string): Set<string> {
  try {
    const d = JSON.parse(readFileSync(join(dirname(settingsFile), 'admin-permissions.json'), 'utf8')) as { admins?: Record<string, { ingame?: unknown }> };
    return new Set(Object.entries(d.admins ?? {}).filter(([, p]) => p.ingame === false).map(([id]) => id));
  } catch {
    return new Set();
  }
}

try {
  const saved = readSettings(settingsPath);
  const settings = saved === null ? null : withoutAdmins(saved, inGameOff(settingsPath), config.panel.superAdminId);
  const ini = readFileSync(iniPath, 'utf8');
  if (!inPlace) {
    process.stdout.write(applySettings(ini, settings ?? {}));
  } else {
    // A growth event running now: its multiplier over the panel's. One that has
    // just ended with no panel value to go back to: the game's default, 1.
    const dir = dirname(settingsPath);
    const events = readGrowthEvents(dir);
    const before = readGrowthApplied(dir);
    const panelBase = typeof settings?.['GrowthMultiplier'] === 'number' ? settings['GrowthMultiplier'] : null;
    const nowS = Math.floor(Date.now() / 1000);
    const g = effectiveGrowth(panelBase ?? 1, events, nowS);
    const managesGrowth = g.event !== null || panelBase !== null || before?.event != null;
    const wanted = managesGrowth ? { ...(settings ?? {}), GrowthMultiplier: g.multiplier } : settings;
    if (wanted !== null) applyInPlace(ini, wanted);
    if (managesGrowth) {
      const endedEvent = before?.event && !g.event ? events.find((e) => e.id === before.event?.id) : undefined;
      writeGrowthApplied(dir, { at: nowS, multiplier: g.multiplier,
        event: g.event ? { id: g.event.id, end: g.event.end, note: g.event.note } : null,
        ended: before?.event && !g.event
          ? { id: before.event.id, multiplier: endedEvent?.multiplier ?? before.multiplier, note: before.event.note } : null });
      if (g.event) console.log(`cli-apply-settings: growth event ${g.event.id} — GrowthMultiplier ${g.multiplier}`);
    }
  }
} catch (error) {
  console.error(`cli-apply-settings: ${(error as Error).message}`);
  process.exit(1);
}

function applyInPlace(ini: string, settings: Settings): void {
  const path = iniPath as string;
  const next = applySettings(ini, settings);
  if (next !== ini) {
    writeFileSync(`${path}.tmp`, next, 'utf8');
    renameSync(`${path}.tmp`, path);
    console.log(`cli-apply-settings: panel settings re-applied to ${path}`);
  }
}
