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
 *
 * An empty or missing settings file leaves the template defaults. Any error
 * exits non-zero so deploy stops instead of shipping a Game.ini that drops the
 * panel's work.
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { applySettings, validateSettings, type Settings } from './gameini.js';

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

try {
  const settings = readSettings(settingsPath);
  const ini = readFileSync(iniPath, 'utf8');
  if (!inPlace) {
    process.stdout.write(applySettings(ini, settings ?? {}));
  } else if (settings !== null) {
    const next = applySettings(ini, settings);
    if (next !== ini) {
      writeFileSync(`${iniPath}.tmp`, next, 'utf8');
      renameSync(`${iniPath}.tmp`, iniPath);
      console.log(`cli-apply-settings: panel settings re-applied to ${iniPath}`);
    }
  }
} catch (error) {
  console.error(`cli-apply-settings: ${(error as Error).message}`);
  process.exit(1);
}
