import { getJson } from '@isle/api';
import { loadMap } from '../../lib/map';
import { LAYER, WATER_V, type AiLive, type Flora, type MapPlayer } from './data';
import { az, changed, gd, lm, moveTo, requestDraw, type AiZonesView, type GuardView } from './store';
import { toMap } from './zones';

let loading: Promise<void> | null = null;
/** The base image and the places (VulnonaMAP, cli-fetch-map.js), the water outlines and mask; once. */
export function loadMapData(): Promise<void> {
  loading ??= (async () => {
    try {
      const { data, img } = await loadMap();
      lm.data = data as unknown as typeof lm.data;
      lm.img = img;
      // The waters outlined (scripts/build-water-areas.py): highlighted with the Nguồn nước layer.
      getJson<{ areas?: typeof lm.water }>(`/map/water-areas.json?v=${WATER_V}`).then((w) => { lm.water = Array.isArray(w?.areas) ? w.areas : []; requestDraw(); }).catch(() => undefined);
      // Every water pixel of the map, tinted once in the layer's colour.
      const mask = new Image();
      mask.src = `/map/water-mask.png?v=${WATER_V}`;
      mask.decode().then(() => {
        const c = document.createElement('canvas');
        c.width = mask.naturalWidth; c.height = mask.naturalHeight;
        const x = c.getContext('2d');
        if (!x) return;
        x.drawImage(mask, 0, 0);
        x.globalCompositeOperation = 'source-in';
        x.fillStyle = LAYER['water']!.color; x.fillRect(0, 0, c.width, c.height);
        lm.waterTint = c;
        requestDraw();
      }).catch(() => undefined);
    } catch (e) {
      lm.failed = e instanceof Error ? e.message : String(e);
      loading = null;
    }
    changed();
  })();
  return loading;
}

/** GET /api/map: the players with their trail and the AI alive (every 2 s). */
export function setPlayers(players: MapPlayer[], ai: AiLive | null): void {
  lm.players = players;
  for (const p of players) moveTo(p);
  lm.ai = ai;
  changed();
}
/** GET /api/map/live: positions, heading and AI every second, so the map lags the game by about a second. */
export function applyLive(live: { players?: Array<{ steamId: string; loc: MapPlayer['loc']; yaw?: number; health?: number }>; ai?: AiLive | null }): void {
  for (const lp of live.players ?? []) {
    const p = lm.players.find((x) => x.steamId === lp.steamId);
    if (!p) continue;
    p.loc = lp.loc;
    if (typeof lp.yaw === 'number') p.yaw = lp.yaw;
    if (typeof lp.health === 'number') p.health = lp.health;
    moveTo(p);
  }
  if (live.ai) lm.ai = live.ai;
  changed();
}
/** GET /api/map/flora: the island's real plants (mods/Flora), when fresh. */
export function setFlora(flora: Flora | null): void {
  lm.flora = flora && !flora.stale ? flora : null;
  lm.floraZones = lm.flora ? lm.flora.spawners.filter((sp) => (sp.shape?.spline?.length ?? 0) >= 3)
    .map((sp) => ({ sp, ring: (sp.shape?.spline ?? []).map(toMap) })) : [];
  changed();
}
/** GET /api/ai-zones: the zones; the draft is the server's copy unless the admin is editing it. */
export function setAiZones(d: AiZonesView): void {
  az.data = d;
  az.status = d.status;
  az.points = d.points ?? {};
  az.speciesLabel = Object.fromEntries(d.species.map((s) => [s.key, s.label]));
  az.speciesCls = Object.fromEntries(d.species.map((s) => [s.key, s.cls]));
  if (!az.dirty) az.draft = { enabled: d.enabled, globalMax: d.globalMax, zones: structuredClone(d.zones), ignoreOccupants: [...(d.ignoreOccupants ?? [])] };
  changed();
}
/** GET /api/zone-guard: the small-dinos rule (kept while edited). */
export function setGuard(d: GuardView): void {
  gd.data = d;
  if (!gd.dirty) {
    gd.draft = { enabled: d.enabled, graceSec: d.graceSec, everySec: d.everySec, pct: d.pct, defaultMax: d.defaultMax, maxBySpecies: { ...d.maxBySpecies }, sanctuaries: [...d.sanctuaries] };
  }
  changed();
}
