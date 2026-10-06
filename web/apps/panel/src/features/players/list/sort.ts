import type { PlayerRow } from '@isle/api';
import { dinoName } from '../../../lib/format';
import type { SortDir } from '../../../components/list/List';

export type Status = 'all' | 'online' | 'offline';
export const COLS = ['player', 'steamId', 'ping', 'garage', 'kd', 'damage', 'playtime', 'lastSeen'] as const;
export type Col = (typeof COLS)[number];
/** A new column sorts names and the ping up, the rest down (the panel before React). */
export const firstDir = (col: string): SortDir => (col === 'player' || col === 'steamId' || col === 'ping' ? 'asc' : 'desc');

/** The rows the search and the filter keep, sorted by `col` (not sorted: as the bridge sent them). */
export function viewOf(all: PlayerRow[], q: string, status: Status, col: string | null, d: SortDir): PlayerRow[] {
  const needle = q.trim().toLowerCase();
  const rows = all.filter((p) => {
    if (status === 'online' && !p.online) return false;
    if (status === 'offline' && p.online) return false;
    if (!needle) return true;
    return [p.name ?? '', p.steamId, dinoName(p.species)].some((v) => v.toLowerCase().includes(needle));
  });
  if (!col) return rows;
  const dir = d === 'asc' ? 1 : -1;
  const kd = (p: PlayerRow): number => (p.kills ?? 0) / Math.max(1, p.deaths ?? 0);
  const ping = (p: PlayerRow): number => (p.online && typeof p.ping === 'number' ? p.ping : dir === 1 ? Infinity : -Infinity);
  const cmp = (a: PlayerRow, b: PlayerRow): number => {
    switch (col) {
      case 'player': return (a.name || a.steamId).toLowerCase().localeCompare((b.name || b.steamId).toLowerCase(), 'vi');
      case 'steamId': return a.steamId.localeCompare(b.steamId);
      case 'ping': { const x = ping(a), y = ping(b); return x === y ? 0 : x < y ? -1 : 1; }
      case 'garage': return (a.garage ?? 0) - (b.garage ?? 0);
      case 'kd': return (kd(a) - kd(b)) || ((a.kills ?? 0) - (b.kills ?? 0));
      case 'damage': return (a.damageDealt ?? 0) - (b.damageDealt ?? 0);
      case 'playtime': return (a.playtime ?? 0) - (b.playtime ?? 0);
      case 'lastSeen': return a.online !== b.online ? (a.online ? 1 : -1) : (a.lastSeen ?? 0) - (b.lastSeen ?? 0);
      default: return 0;
    }
  };
  return [...rows].sort((a, b) => cmp(a, b) * dir);
}
