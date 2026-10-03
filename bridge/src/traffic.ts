import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';

/**
 * Traffic of the site and the launcher (owner's request, 2026-10-03), shown on
 * the panel's "Truy cập" page. The portal (and the launcher through it) tells
 * the bridge (POST /player-api/track); counted per day, server local time:
 *
 *   view            a page load of the player site: on the web or inside the launcher;
 *                   visitors = an HMAC of IP + browser + day the portal makes (no IP kept)
 *   download_click  "Tải cho Windows / Linux" pressed on /tai.html
 *   download_file   an installer served by our server. The proxy in front caches
 *                   the installers, so most downloads never reach us: a floor, not the count
 *   launcher        a launcher running (its random install id, version, OS); `first`:
 *                   its first start after a fresh install (no settings file yet)
 *   login           a Steam login done: on the web or for the launcher
 *   active          a logged-in player using the site / the launcher that day
 *
 * DATA_DIR/traffic.json; days older than KEEP_DAYS go.
 */

export const KEEP_DAYS = 120;

export interface TrafficDay {
  views: { web: number; launcher: number };
  visitors: { web: string[]; launcher: string[] };
  downloadClicks: { win: number; linux: number };
  downloadFiles: { win: number; linux: number; update: number };
  installs: { win: number; linux: number; other: number };
  /** Install ids of the launchers that ran that day. */
  launchers: string[];
  /** Launchers that ran, by version. */
  versions: Record<string, number>;
  logins: { web: number; launcher: number };
  /** SteamIDs that logged in that day, and the ones logging in for the first time since counting began. */
  loginUsers: string[];
  newUsers: string[];
  active: { web: string[]; launcher: string[] };
  /** The same counts hour by hour (0–23, server time), for the "Hôm nay" chart; uniques count the first time that day. */
  hours?: Partial<Record<HourMetric, number[]>>;
}

export const HOUR_METRICS = ['viewsWeb', 'viewsLauncher', 'visitorsWeb', 'visitorsLauncher', 'clicksWin', 'clicksLinux',
  'files', 'filesUpdate', 'installs', 'launchers', 'loginsWeb', 'loginsLauncher', 'activeWeb', 'activeLauncher', 'newUsers'] as const;
export type HourMetric = typeof HOUR_METRICS[number];

interface TrafficFile { days: Record<string, TrafficDay>; knownUsers: string[]; knownInstalls: string[] }

export type TrafficEvent =
  | { kind: 'view'; where: 'web' | 'launcher'; visitor: string }
  | { kind: 'download_click'; os: 'win' | 'linux' }
  | { kind: 'download_file'; os: 'win' | 'linux'; update: boolean }
  | { kind: 'launcher'; id: string; os: 'win' | 'linux' | 'other'; version: string; first: boolean }
  | { kind: 'login'; via: 'web' | 'launcher'; steamId: string }
  | { kind: 'active'; where: 'web' | 'launcher'; steamId: string };

const emptyDay = (): TrafficDay => ({
  views: { web: 0, launcher: 0 }, visitors: { web: [], launcher: [] },
  downloadClicks: { win: 0, linux: 0 }, downloadFiles: { win: 0, linux: 0, update: 0 },
  installs: { win: 0, linux: 0, other: 0 }, launchers: [], versions: {},
  logins: { web: 0, launcher: 0 }, loginUsers: [], newUsers: [], active: { web: [], launcher: [] },
});

const pad = (n: number): string => String(n).padStart(2, '0');
/** "YYYY-MM-DD" of a time, server local. */
export const dayKey = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const HEX = /^[0-9a-f]{16,64}$/;
const STEAM = /^\d{17}$/;
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,4}$/;
const oneOf = <T extends string>(v: unknown, list: readonly T[], what: string): T => {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw new ValidationError(`${what}: one of ${list.join(', ')}`);
  return v as T;
};

/** A tracking event as the portal sends it, checked. */
export function parseTrafficEvent(raw: unknown): TrafficEvent {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('body must be an object');
  const r = raw as Record<string, unknown>;
  switch (r['kind']) {
    case 'view': {
      if (typeof r['visitor'] !== 'string' || !HEX.test(r['visitor'])) throw new ValidationError('visitor: hex');
      return { kind: 'view', where: oneOf(r['where'], ['web', 'launcher'] as const, 'where'), visitor: r['visitor'] };
    }
    case 'download_click': return { kind: 'download_click', os: oneOf(r['os'], ['win', 'linux'] as const, 'os') };
    case 'download_file': return { kind: 'download_file', os: oneOf(r['os'], ['win', 'linux'] as const, 'os'), update: r['update'] === true };
    case 'launcher': {
      if (typeof r['id'] !== 'string' || !HEX.test(r['id'])) throw new ValidationError('id: hex');
      if (typeof r['version'] !== 'string' || !VERSION.test(r['version'])) throw new ValidationError('version: x.y.z');
      return { kind: 'launcher', id: r['id'], os: oneOf(r['os'], ['win', 'linux', 'other'] as const, 'os'), version: r['version'], first: r['first'] === true };
    }
    case 'login':
    case 'active': {
      if (typeof r['steamId'] !== 'string' || !STEAM.test(r['steamId'])) throw new ValidationError('steamId');
      const where = oneOf(r['kind'] === 'login' ? r['via'] : r['where'], ['web', 'launcher'] as const, 'where');
      return r['kind'] === 'login' ? { kind: 'login', via: where, steamId: r['steamId'] } : { kind: 'active', where, steamId: r['steamId'] };
    }
    default: throw new ValidationError('kind: view, download_click, download_file, launcher, login or active');
  }
}

const addTo = (list: string[], v: string): boolean => { if (list.includes(v)) return false; list.push(v); return true; };

/** One day for the panel: counts only (no ids). */
export interface TrafficDayView {
  day: string;
  views: { web: number; launcher: number };
  visitors: { web: number; launcher: number };
  downloadClicks: { win: number; linux: number };
  downloadFiles: { win: number; linux: number; update: number };
  installs: { win: number; linux: number; other: number };
  launchers: number;
  logins: { web: number; launcher: number };
  loginUsers: number;
  newUsers: number;
  active: { web: number; launcher: number };
}

export class Traffic {
  #data: TrafficFile = { days: {}, knownUsers: [], knownInstalls: [] };
  #known = { users: new Set<string>(), installs: new Set<string>() };
  #saveTimer: NodeJS.Timeout | null = null;
  readonly #path: string;

  constructor(path = join(config.dataDir, 'traffic.json')) { this.#path = path; }

  async load(): Promise<void> {
    try {
      const d = JSON.parse(await readFile(this.#path, 'utf8')) as Partial<TrafficFile>;
      this.#data = { days: d.days ?? {}, knownUsers: d.knownUsers ?? [], knownInstalls: d.knownInstalls ?? [] };
    } catch { /* nothing yet */ }
    this.#known = { users: new Set(this.#data.knownUsers), installs: new Set(this.#data.knownInstalls) };
  }

  record(e: TrafficEvent, nowMs = Date.now()): void {
    const key = dayKey(nowMs);
    const day = this.#data.days[key] ?? (this.#data.days[key] = emptyDay());
    const hour = new Date(nowMs).getHours();
    const tick = (m: HourMetric): void => {
      const hours = day.hours ?? (day.hours = {});
      const list = hours[m] ?? (hours[m] = Array.from({ length: 24 }, () => 0));
      list[hour] = (list[hour] ?? 0) + 1;
    };
    switch (e.kind) {
      case 'view':
        day.views[e.where] += 1;
        tick(e.where === 'web' ? 'viewsWeb' : 'viewsLauncher');
        if (addTo(day.visitors[e.where], e.visitor)) tick(e.where === 'web' ? 'visitorsWeb' : 'visitorsLauncher');
        break;
      case 'download_click': day.downloadClicks[e.os] += 1; tick(e.os === 'win' ? 'clicksWin' : 'clicksLinux'); break;
      case 'download_file':
        if (e.update) { day.downloadFiles.update += 1; tick('filesUpdate'); } else { day.downloadFiles[e.os] += 1; tick('files'); }
        break;
      case 'launcher':
        if (addTo(day.launchers, e.id)) { day.versions[e.version] = (day.versions[e.version] ?? 0) + 1; tick('launchers'); }
        // A fresh install, once: a launcher that was already there (an update) is not one.
        if (e.first && !this.#known.installs.has(e.id)) { day.installs[e.os] += 1; tick('installs'); }
        if (!this.#known.installs.has(e.id)) { this.#known.installs.add(e.id); this.#data.knownInstalls.push(e.id); }
        break;
      case 'login':
        day.logins[e.via] += 1;
        tick(e.via === 'web' ? 'loginsWeb' : 'loginsLauncher');
        addTo(day.loginUsers, e.steamId);
        if (!this.#known.users.has(e.steamId)) {
          this.#known.users.add(e.steamId); this.#data.knownUsers.push(e.steamId);
          if (addTo(day.newUsers, e.steamId)) tick('newUsers');
        }
        break;
      case 'active': if (addTo(day.active[e.where], e.steamId)) tick(e.where === 'web' ? 'activeWeb' : 'activeLauncher'); break;
    }
    this.#prune(nowMs);
    this.#saveSoon();
  }

  /** The last `days` days (oldest first, empty days included), and the distinct counts over them. */
  view(days: number, nowMs = Date.now()): { days: TrafficDayView[]; total: { visitors: number; launchers: number; users: number; active: number } } {
    const out: TrafficDayView[] = [];
    const visitors = new Set<string>(); const launchers = new Set<string>(); const users = new Set<string>(); const active = new Set<string>();
    for (let i = days - 1; i >= 0; i--) {
      const key = dayKey(nowMs - i * 86_400_000);
      const d = this.#data.days[key] ?? emptyDay();
      for (const v of [...d.visitors.web, ...d.visitors.launcher]) visitors.add(v);
      for (const v of d.launchers) launchers.add(v);
      for (const v of d.loginUsers) users.add(v);
      for (const v of [...d.active.web, ...d.active.launcher]) active.add(v);
      out.push({
        day: key, views: { ...d.views }, visitors: { web: d.visitors.web.length, launcher: d.visitors.launcher.length },
        downloadClicks: { ...d.downloadClicks }, downloadFiles: { ...d.downloadFiles }, installs: { ...d.installs },
        launchers: d.launchers.length, logins: { ...d.logins }, loginUsers: d.loginUsers.length, newUsers: d.newUsers.length,
        active: { web: d.active.web.length, launcher: d.active.launcher.length },
      });
    }
    return { days: out, total: { visitors: visitors.size, launchers: launchers.size, users: users.size, active: active.size } };
  }

  /**
   * From `from` to `to` ("YYYY-MM-DD", at most KEEP_DAYS days): one point a day; a single day:
   * one point an hour (its hourly counts). Totals over the range (distinct people / machines).
   */
  range(from: string, to: string): { unit: 'day' | 'hour'; points: Array<{ label: string } & Record<HourMetric, number>>;
    total: Record<HourMetric, number> & { visitors: number; launcherMachines: number; users: number; active: number } } {
    const keys: string[] = [];
    const start = new Date(`${from}T12:00:00`); const end = new Date(`${to}T12:00:00`);
    for (let d = start; d <= end && keys.length < KEEP_DAYS; d = new Date(d.getTime() + 86_400_000)) keys.push(dayKey(d.getTime()));
    const zero = (): Record<HourMetric, number> => Object.fromEntries(HOUR_METRICS.map((m) => [m, 0])) as Record<HourMetric, number>;
    const ofDay = (d: TrafficDay): Record<HourMetric, number> => ({
      viewsWeb: d.views.web, viewsLauncher: d.views.launcher, visitorsWeb: d.visitors.web.length, visitorsLauncher: d.visitors.launcher.length,
      clicksWin: d.downloadClicks.win, clicksLinux: d.downloadClicks.linux, files: d.downloadFiles.win + d.downloadFiles.linux,
      filesUpdate: d.downloadFiles.update, installs: d.installs.win + d.installs.linux + d.installs.other, launchers: d.launchers.length,
      loginsWeb: d.logins.web, loginsLauncher: d.logins.launcher, activeWeb: d.active.web.length, activeLauncher: d.active.launcher.length,
      newUsers: d.newUsers.length,
    });
    const total = zero();
    const visitors = new Set<string>(); const machines = new Set<string>(); const users = new Set<string>(); const active = new Set<string>();
    const points: Array<{ label: string } & Record<HourMetric, number>> = [];
    for (const k of keys) {
      const d = this.#data.days[k] ?? emptyDay();
      const c = ofDay(d);
      for (const m of HOUR_METRICS) total[m] += c[m];
      for (const v of [...d.visitors.web, ...d.visitors.launcher]) visitors.add(v);
      for (const v of d.launchers) machines.add(v);
      for (const v of d.loginUsers) users.add(v);
      for (const v of [...d.active.web, ...d.active.launcher]) active.add(v);
      if (keys.length > 1) points.push({ label: k, ...c });
    }
    if (keys.length === 1) {
      const d = this.#data.days[keys[0] as string] ?? emptyDay();
      for (let h = 0; h < 24; h++) {
        const p = zero();
        for (const m of HOUR_METRICS) p[m] = d.hours?.[m]?.[h] ?? 0;
        points.push({ label: `${String(h).padStart(2, '0')}:00`, ...p });
      }
    }
    return { unit: keys.length === 1 ? 'hour' : 'day', points, total: { ...total, visitors: visitors.size, launcherMachines: machines.size, users: users.size, active: active.size } };
  }

  /** Launchers seen over the last `days` days, by version (the newest version each install ran). */
  versions(days: number, nowMs = Date.now()): Record<string, number> {
    const out: Record<string, number> = {};
    for (let i = days - 1; i >= 0; i--) {
      for (const [v, n] of Object.entries(this.#data.days[dayKey(nowMs - i * 86_400_000)]?.versions ?? {})) out[v] = (out[v] ?? 0) + n;
    }
    return out;
  }

  #prune(nowMs: number): void {
    const oldest = dayKey(nowMs - KEEP_DAYS * 86_400_000);
    for (const k of Object.keys(this.#data.days)) if (k < oldest) delete this.#data.days[k];
  }

  #saveSoon(): void {
    if (this.#saveTimer !== null) return;
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      this.flush().catch((error: unknown) => console.error('[traffic] cannot save:', error));
    }, 5000);
    this.#saveTimer.unref?.();
  }

  async flush(): Promise<void> {
    await mkdir(join(this.#path, '..'), { recursive: true });
    const tmp = `${this.#path}.tmp`;
    await writeFile(tmp, JSON.stringify(this.#data), 'utf8');
    await rename(tmp, this.#path);
  }
}
