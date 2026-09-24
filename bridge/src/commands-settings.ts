import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';

/**
 * Settings of the PlayerCommands mod (mods/PlayerCommands/Scripts/main.lua),
 * read fresh by the mod on every command — no restart needed.
 */
export const COMMANDS = ['slay', 'unstuck', 'prime', 'status'] as const;
export type CommandName = (typeof COMMANDS)[number];
export interface CommandsSettings {
  /** Seconds between two !slay by one player. */
  slayCooldown: number;
  /** Seconds between two !unstuck by one player. */
  unstuckCooldown: number;
  enabled: Record<CommandName, boolean>;
}
export const COMMANDS_DEFAULTS: CommandsSettings = {
  slayCooldown: 300,
  unstuckCooldown: 600,
  enabled: { slay: true, unstuck: true, prime: true, status: true },
};
const MAX_COOLDOWN = 86400;

const path = (): string => join(config.commandsRoot, 'settings.json');

function cooldown(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= 0 && n <= MAX_COOLDOWN ? n : null;
}

function normalise(raw: Record<string, unknown>, strict: boolean): CommandsSettings {
  const out: CommandsSettings = { ...COMMANDS_DEFAULTS, enabled: { ...COMMANDS_DEFAULTS.enabled } };
  for (const key of ['slayCooldown', 'unstuckCooldown'] as const) {
    if (raw[key] === undefined) continue;
    const v = cooldown(raw[key]);
    if (v === null) {
      if (strict) throw new ValidationError(`${key} must be a whole number 0–${MAX_COOLDOWN}`);
      continue;
    }
    out[key] = v;
  }
  const enabled = raw['enabled'];
  if (enabled !== undefined) {
    if (typeof enabled !== 'object' || enabled === null) {
      if (strict) throw new ValidationError('enabled must be an object');
    } else {
      for (const name of COMMANDS) {
        const v = (enabled as Record<string, unknown>)[name];
        if (v === undefined) continue;
        if (typeof v !== 'boolean') {
          if (strict) throw new ValidationError(`enabled.${name} must be true or false`);
          continue;
        }
        out.enabled[name] = v;
      }
    }
  }
  return out;
}

export async function readCommandsSettings(): Promise<CommandsSettings> {
  try {
    return normalise(JSON.parse(await readFile(path(), 'utf8')) as Record<string, unknown>, false);
  } catch {
    return normalise({}, false);
  }
}

export async function saveCommandsSettings(raw: unknown): Promise<CommandsSettings> {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('settings must be an object');
  const settings = normalise(raw as Record<string, unknown>, true);
  const tmp = `${path()}.tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
  await rename(tmp, path());
  return settings;
}
