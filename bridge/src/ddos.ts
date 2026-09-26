import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';

/**
 * DDoS watch (panel → Server → Vận hành): the traffic coming INTO the VPS,
 * from /proc/net/dev of its main interface, every SAMPLE_S. Normal here is
 * tens of kbit/s and tens of packets/s per player (2026-09-26: 31 kbit/s,
 * 40 pkt/s with nobody on); a flood on the game's UDP port is tens of
 * thousands of packets a second.
 *
 * Over a threshold (packets/s OR Mbit/s) for `sustainSec`: an attack starts —
 * told once (Discord, log kind "ddos"); its peak is kept; below both for
 * CALM_S: it ended — told with how long and how hard. It only tells: stopping
 * a flood is the provider's job (anti-DDoS on the game's UDP port).
 *
 * When the link is so full that nothing gets out, the Discord queue keeps the
 * lines and the relay off the VPS says "unreachable" (relay/).
 */

export interface DdosSettings {
  enabled: boolean;
  /** Incoming packets a second that count as an attack. */
  pps: number;
  /** Incoming Mbit/s that count as an attack. */
  mbps: number;
  /** How long it must last before it is told (seconds). */
  sustainSec: number;
}

export const DDOS_DEFAULTS: DdosSettings = { enabled: true, pps: 20_000, mbps: 50, sustainSec: 30 };
export const SAMPLE_S = 5;
const CALM_S = 60;
const HISTORY = 120;                 // 10 minutes of samples for the panel

const settingsPath = (): string => join(config.dataDir, 'ddos.json');

function int(v: unknown, lo: number, hi: number, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new ValidationError(`${what} must be a whole number ${lo}–${hi}`);
  return v;
}

export function validateDdos(raw: unknown): DdosSettings {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('body must be an object');
  const r = raw as Record<string, unknown>;
  if (typeof r['enabled'] !== 'boolean') throw new ValidationError('enabled must be true or false');
  return {
    enabled: r['enabled'],
    pps: int(r['pps'], 1000, 10_000_000, 'pps'),
    mbps: int(r['mbps'], 1, 100_000, 'mbps'),
    sustainSec: int(r['sustainSec'], SAMPLE_S, 600, 'sustainSec'),
  };
}

export async function readDdos(): Promise<DdosSettings> {
  try {
    return validateDdos(JSON.parse(await readFile(settingsPath(), 'utf8')));
  } catch {
    return { ...DDOS_DEFAULTS };
  }
}

export async function saveDdos(raw: unknown): Promise<DdosSettings> {
  const s = validateDdos(raw);
  await mkdir(config.dataDir, { recursive: true });
  const tmp = `${settingsPath()}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), 'utf8');
  await rename(tmp, settingsPath());
  return s;
}

// --- reading the interface -----------------------------------------------------

export interface Counters { rxBytes: number; rxPackets: number; txBytes: number; txPackets: number }

/** One interface's counters from /proc/net/dev, or null. */
export function parseNetDev(text: string, iface: string): Counters | null {
  for (const line of text.split('\n')) {
    const m = /^\s*([^:\s]+):\s*(.*)$/.exec(line);
    if (!m || m[1] !== iface) continue;
    const f = (m[2] as string).trim().split(/\s+/).map(Number);
    if (f.length < 10 || f.some((n) => !Number.isFinite(n))) return null;
    return { rxBytes: f[0] as number, rxPackets: f[1] as number, txBytes: f[8] as number, txPackets: f[9] as number };
  }
  return null;
}

/** The interface of the default route (/proc/net/route: destination 00000000). */
export function defaultIface(routeText: string): string | null {
  for (const line of routeText.split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f[1] === '00000000' && f[0]) return f[0];
  }
  return null;
}

export interface Sample { t: number; pps: number; mbps: number; outMbps: number }

export interface Attack { since: number; peakPps: number; peakMbps: number; onlineBefore: number | null }

export type DdosEvent =
  | { kind: 'start'; attack: Attack; now: Sample }
  | { kind: 'end'; attack: Attack; at: number };

/**
 * The rates between two readings, and what they mean: an attack starting
 * (over a threshold for sustainSec), going on, or ending (under both for CALM_S).
 */
export class DdosWatch {
  #prev: { t: number; c: Counters } | null = null;
  #overSince: number | null = null;
  #calmSince: number | null = null;
  #attack: Attack | null = null;
  #onlineAtFirstOver: number | null = null;
  readonly history: Sample[] = [];

  get attack(): Attack | null { return this.#attack; }

  /** A new reading at `t` (seconds); the events it causes. */
  feed(t: number, c: Counters, s: DdosSettings, online: number | null): DdosEvent[] {
    const prev = this.#prev;
    this.#prev = { t, c };
    if (prev === null || t <= prev.t) return [];
    const dt = t - prev.t;
    // Counters wrap or reset (interface restarted): skip that reading.
    if (c.rxBytes < prev.c.rxBytes || c.rxPackets < prev.c.rxPackets) return [];
    const sample: Sample = {
      t,
      pps: Math.round((c.rxPackets - prev.c.rxPackets) / dt),
      mbps: Math.round(((c.rxBytes - prev.c.rxBytes) * 8) / dt / 1e4) / 100,
      outMbps: Math.round(((c.txBytes - prev.c.txBytes) * 8) / dt / 1e4) / 100,
    };
    this.history.push(sample);
    if (this.history.length > HISTORY) this.history.splice(0, this.history.length - HISTORY);
    if (!s.enabled) { this.#overSince = null; return []; }

    const over = sample.pps >= s.pps || sample.mbps >= s.mbps;
    const events: DdosEvent[] = [];
    if (over) {
      this.#calmSince = null;
      if (this.#overSince === null) { this.#overSince = prev.t; this.#onlineAtFirstOver = online; }
      if (this.#attack) {
        this.#attack.peakPps = Math.max(this.#attack.peakPps, sample.pps);
        this.#attack.peakMbps = Math.max(this.#attack.peakMbps, sample.mbps);
      } else if (t - this.#overSince >= s.sustainSec) {
        const peak = this.history.filter((x) => x.t > (this.#overSince as number));
        this.#attack = {
          since: this.#overSince, onlineBefore: this.#onlineAtFirstOver,
          peakPps: Math.max(...peak.map((x) => x.pps)), peakMbps: Math.max(...peak.map((x) => x.mbps)),
        };
        events.push({ kind: 'start', attack: { ...this.#attack }, now: sample });
      }
    } else {
      this.#overSince = null;
      if (this.#attack) {
        if (this.#calmSince === null) this.#calmSince = t;
        if (t - this.#calmSince >= CALM_S) {
          events.push({ kind: 'end', attack: { ...this.#attack }, at: this.#calmSince });
          this.#attack = null;
          this.#calmSince = null;
        }
      }
    }
    return events;
  }
}

/** "180.000 gói/s" */
const n = (x: number): string => Math.round(x).toLocaleString('vi-VN');
const dur = (s: number): string => (s >= 3600 ? `${Math.floor(s / 3600)} giờ ${Math.round((s % 3600) / 60)} phút` : s >= 60 ? `${Math.round(s / 60)} phút` : `${s} giây`);

export function startText(e: Extract<DdosEvent, { kind: 'start' }>, online: number | null, fps: number | null): string {
  const game = [
    online !== null ? `${online} người online${e.attack.onlineBefore !== null && e.attack.onlineBefore !== online ? ` (trước đó ${e.attack.onlineBefore})` : ''}` : '',
    fps !== null ? `FPS server ${Math.round(fps)}` : '',
  ].filter(Boolean).join(' · ');
  return `🚨 **Nghi bị DDoS** — lưu lượng vào server **${n(e.now.pps)} gói/s · ${e.now.mbps} Mbit/s** (từ <t:${e.attack.since}:T>, đỉnh ${n(e.attack.peakPps)} gói/s · ${e.attack.peakMbps} Mbit/s)`
    + (game ? `\n${game}` : '');
}

export function endText(e: Extract<DdosEvent, { kind: 'end' }>): string {
  return `✅ **Hết lưu lượng bất thường** sau ${dur(e.at - e.attack.since)} — đỉnh **${n(e.attack.peakPps)} gói/s · ${e.attack.peakMbps} Mbit/s** (<t:${e.attack.since}:t>–<t:${e.at}:t>)`;
}
