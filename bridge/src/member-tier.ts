import { readLive } from './gameini.js';
import { type MemberTier, saveGarageMembers } from './garage.js';
import { adminIds } from './panel-auth.js';
import { readSvip } from './svip.js';

/**
 * Who is who (owner, 2026-10-05): người thường, VIP, SVip, admin, highest first.
 *
 *   admin   the server's admins (panel-auth.ts adminIds)
 *   svip    the panel's SVip list (svip.ts); also the game's VIP at start (cli-apply-settings.ts)
 *   vip     the game's VIP list (Game.ini VIPs, panel → Thành viên → VIP)
 *
 * The garage gives each its slots and wait (garage.ts garageRuleFor); the mod reads the list
 * from garage-settings.json `members`, written by syncGarageMembers.
 */

/** The game's VIP list: the panel's saved one, else what Game.ini says now. */
export async function vipIds(): Promise<Set<string>> {
  const live = await readLive();
  const fromPanel = live.settings['VIPs'];
  const fromIni = live.effective['VIPs'];
  const list = Array.isArray(fromPanel) ? fromPanel : Array.isArray(fromIni) ? fromIni : [];
  return new Set(list.filter((s) => /^\d{17}$/.test(s)));
}

/** Everyone above a plain player, by SteamID (sorted, so the file only changes when someone does). */
export async function memberTiers(): Promise<Record<string, Exclude<MemberTier, 'normal'>>> {
  const [admins, svip, vips] = await Promise.all([adminIds(), readSvip(), vipIds()]);
  const out = new Map<string, Exclude<MemberTier, 'normal'>>();
  for (const id of vips) out.set(id, 'vip');
  for (const p of svip.players) out.set(p.steamId, 'svip');
  for (const id of admins) out.set(id, 'admin');
  return Object.fromEntries([...out].sort(([a], [b]) => a.localeCompare(b)));
}

export async function tierOf(steamId: string): Promise<MemberTier> {
  return (await memberTiers())[steamId] ?? 'normal';
}

/** The members list into the garage's settings for the mod; true when it changed. */
export async function syncGarageMembers(): Promise<boolean> {
  return saveGarageMembers(await memberTiers());
}
