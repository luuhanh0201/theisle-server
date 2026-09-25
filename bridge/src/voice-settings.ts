import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';

/**
 * Server-wide voice settings, set on the admin panel (Server → Voice):
 *   nameMode  what players see of whoever is talking near them —
 *             'name' their in-game name, 'id' a short tag (#A3F9, the same
 *             person keeps it), 'none' nothing ("Có người đang nói").
 * Applies to the "who is near" list at once, and to the name inside the voice
 * room from each player's next join.
 */
export const NAME_MODES = ['name', 'id', 'none'] as const;
export type NameMode = (typeof NAME_MODES)[number];
export interface VoiceSettings { nameMode: NameMode }
export const VOICE_DEFAULTS: VoiceSettings = { nameMode: 'name' };

const path = (): string => join(config.dataDir, 'voice-settings.json');
let cached: VoiceSettings | null = null;

function normalise(raw: Record<string, unknown>, strict: boolean): VoiceSettings {
  const out = { ...VOICE_DEFAULTS };
  const m = raw['nameMode'];
  if (m !== undefined) {
    if ((NAME_MODES as readonly unknown[]).includes(m)) out.nameMode = m as NameMode;
    else if (strict) throw new ValidationError(`nameMode must be one of ${NAME_MODES.join(', ')}`);
  }
  return out;
}

/** Read once, then kept in memory (the voice poll asks twice a second per player). */
export async function readVoiceSettings(): Promise<VoiceSettings> {
  if (cached !== null) return cached;
  try {
    cached = normalise(JSON.parse(await readFile(path(), 'utf8')) as Record<string, unknown>, false);
  } catch {
    cached = normalise({}, false);
  }
  return cached;
}

export async function saveVoiceSettings(raw: unknown): Promise<VoiceSettings> {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('settings must be an object');
  const settings = normalise(raw as Record<string, unknown>, true);
  await mkdir(dirname(path()), { recursive: true });
  const tmp = `${path()}.tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
  await rename(tmp, path());
  cached = settings;
  return settings;
}

/** "#A3F9": a short, stable tag for a voice identity (v + 16 hex). */
export function voiceTag(identity: string): string {
  return `#${identity.slice(1, 5).toUpperCase()}`;
}

/** What others see of a player under `mode`. */
export function shownName(mode: NameMode, name: string | null, identity: string): string | null {
  if (mode === 'name') return name;
  if (mode === 'id') return voiceTag(identity);
  return null;
}
