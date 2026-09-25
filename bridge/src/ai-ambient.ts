import { readLive, saveSettings } from './gameini.js';

/**
 * The game's own AI — rabbits, chickens, boars… it spawns around players
 * (Game.ini bSpawnAI) — on or off, from the AI zones card. With it off, only
 * the zones' species live on the island (the AIZones mod spawns by itself:
 * checked 2026-09-26 02:02 — with bSpawnAI false the zone kept its AI and
 * refilled its minimum after a reset).
 *
 * Two places: the running server (RCON ToggleAI, a flip — so it is only sent
 * when ServerDetails says the state differs) and Game.ini, so a restart does
 * not turn it back. ToggleAI's own reply text is not trusted: it said "AI
 * spawns are now On" while ServerDetails turned to bSpawnAI: false.
 */

interface RconLike {
  readonly enabled: boolean;
  run(name: string, args?: unknown): Promise<string>;
}

export interface AmbientState {
  /** The running server's bSpawnAI (ServerDetails), null when RCON cannot tell. */
  live: boolean | null;
  /** Game.ini's bSpawnAI (what a restart gives), null when unreadable. */
  ini: boolean | null;
}

/** bSpawnAI from a ServerDetails reply, or null. */
export function parseSpawnAi(details: string): boolean | null {
  const m = /bSpawnAI:\s*(true|false)/i.exec(details);
  return m ? m[1]!.toLowerCase() === 'true' : null;
}

async function liveState(rcon: RconLike): Promise<boolean | null> {
  if (!rcon.enabled) return null;
  try {
    return parseSpawnAi(await rcon.run('serverDetails'));
  } catch {
    return null;
  }
}

export async function readAmbient(rcon: RconLike): Promise<AmbientState> {
  const cfg = await readLive();
  const ini = cfg.effective['bSpawnAI'] ?? cfg.settings['bSpawnAI'];
  return { live: await liveState(rcon), ini: typeof ini === 'boolean' ? ini : null };
}

/** Turn the game's AI on or off, now (if it differs) and in Game.ini. */
export async function setAmbient(rcon: RconLike, on: boolean): Promise<AmbientState & { toggled: boolean }> {
  let toggled = false;
  const now = await liveState(rcon);
  if (now !== null && now !== on) {
    await rcon.run('toggleAi');
    toggled = true;
  }
  const cfg = await readLive();
  await saveSettings({ ...cfg.settings, bSpawnAI: on });
  return { ...(await readAmbient(rcon)), toggled };
}
