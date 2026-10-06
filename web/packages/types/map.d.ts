// The types of portal/public/map.js (imported as @portal/map, aliases.ts): the players' map engine, shared by the
// player site's Bản đồ page and the launcher's big map (bigmap.js). It draws into the element it is given.
export interface MapPoint { x: number; y: number }
export interface MapApi {
  setAi(list: unknown[]): void;
  setFish(list: unknown[]): void;
  setEscapees(list: unknown[]): void;
  setFriends(list: Array<{ name: string | null; x: number; y: number; yaw?: number | null }> | null): void;
  focus(p: MapPoint): void;
  setHeat(h: unknown): void;
  setAiZones(list: unknown[]): void;
  update(dino: unknown): void;
  getTarget(): (MapPoint & { name?: string }) | null;
  paintMini: (...args: unknown[]) => unknown;
  resetView(): void;
  setLook(look: { map?: number; dim?: number }): void;
  onTargetChange(cb: (() => void) | null): void;
}
export function createMap(root: HTMLElement, opts?: { overlay?: boolean }): MapApi;
export function loadWaypoints(): { target: unknown; saved: unknown[] };
export const LOOK_DEFAULT: { map: number; dim: number };
export function fmtDistance(m: number): string;
