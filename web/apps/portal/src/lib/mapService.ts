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
/** What the map was last given: the launcher's overlay gets it too (lib/overlay.ts, app.js pushOverlayGame). */
const last: { ai: unknown[]; fish: unknown[]; escapees: unknown[]; aiZones: unknown[] | null; heat: unknown } = {
  ai: [], fish: [], escapees: [], aiZones: null, heat: null,
};
export const mapData = (): Readonly<typeof last> & { friends: typeof friendSpots } => ({ ...last, friends: friendSpots });

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
  last.ai = ai.list ?? [];
  last.fish = Array.isArray(ai.fish) ? ai.fish : [];
  last.escapees = Array.isArray(ai.escapees) ? ai.escapees : [];
  map.setAi(last.ai);
  map.setFish(last.fish);
  map.setEscapees(last.escapees);
}
/** The AI zones the admins drew (public, like the map). */
export async function loadAiZones(): Promise<void> {
  if (!map) return;
  const r = await portalGet<{ zones?: unknown[] }>('/api/ai-zones').catch(() => null);
  if (r) { last.aiZones = r.zones ?? []; map.setAiZones(last.aiZones); }
}
/** Where players are (counts per 500 m square, every 5 minutes; logged in). */
export async function loadHeat(): Promise<void> {
  if (!map) return;
  const r = await portalGet<unknown>('/api/heatmap').catch(() => null);
  if (r) { last.heat = r; map.setHeat(r); }
}

/** For tests: forget the map. */
export function resetMapForTest(): void {
  map = null; root = null; friendSpots = null;
  Object.assign(last, { ai: [], fish: [], escapees: [], aiZones: null, heat: null });
}
