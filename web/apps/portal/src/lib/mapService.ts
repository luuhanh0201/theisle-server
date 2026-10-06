import { createMap, type MapApi } from '@portal/map';
import { portalGet } from './http';

/**
 * The one map of the site (map.js), as app.js kept it: made the first time a logged-in player needs it,
 * then kept for the whole visit (its zoom, layers, target, trail). The Bản đồ page shows its element; the
 * launcher's mini map and big map (Overlay block) draw from the same map.
 */
let map: MapApi | null = null;
let root: HTMLDivElement | null = null;
/** The friends' spots last read (/api/friends), given to the map when it is made later. */
let friendSpots: Parameters<MapApi['setFriends']>[0] = null;

export function getMap(): { map: MapApi; root: HTMLDivElement } {
  if (!map || !root) {
    root = document.createElement('div');
    map = createMap(root);
    if (friendSpots !== null) map.setFriends(friendSpots);
    void loadAiZones();
    void loadHeat();
  }
  return { map, root };
}
export const mapIfMade = (): MapApi | null => map;

export function setFriendSpots(spots: Parameters<MapApi['setFriends']>[0]): void {
  friendSpots = spots;
  map?.setFriends(spots);
}

/** The live AI, its fish and the escaped inmates (/api/ai, logged in). */
export async function loadAi(): Promise<void> {
  if (!map) return;
  const ai = await portalGet<{ list?: unknown[]; fish?: unknown[]; escapees?: unknown[] }>('/api/ai').catch(() => null);
  if (!ai) return;
  map.setAi(ai.list ?? []);
  map.setFish(Array.isArray(ai.fish) ? ai.fish : []);
  map.setEscapees(Array.isArray(ai.escapees) ? ai.escapees : []);
}
/** The AI zones the admins drew (public, like the map). */
export async function loadAiZones(): Promise<void> {
  if (!map) return;
  const r = await portalGet<{ zones?: unknown[] }>('/api/ai-zones').catch(() => null);
  if (r) map.setAiZones(r.zones ?? []);
}
/** Where players are (counts per 500 m square, every 5 minutes; logged in). */
export async function loadHeat(): Promise<void> {
  if (!map) return;
  const r = await portalGet<unknown>('/api/heatmap').catch(() => null);
  if (r) map.setHeat(r);
}

/** For tests: forget the map. */
export function resetMapForTest(): void { map = null; root = null; friendSpots = null; }
