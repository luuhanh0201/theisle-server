import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { ValidationError } from './garage.js';
import { readAiZones, zonePoints, type AiZone } from './ai-zones.js';
import { boundRadiusCm, zoneOutline } from './zone-shape.js';
import type { GroundPoints } from './ground-points.js';
import type { GameEvent } from './events.js';

/**
 * The prison (panel → Người chơi → Bỏ tù; Tính năng mod → Nhà tù). The
 * bridge owns the sentences; mods/Prison carries them out in the game.
 *
 *   DATA_DIR/prison.json            settings (incl. the offenses), the active
 *                                   sentences, the past ones, the hunters
 *   <Prison>/Saved/prison.json      what the mod reads: the zone (the AI zone
 *                                   ticked "Nhà tù"), ground spots inside it
 *                                   to drop inmates on, the sting for
 *                                   outsiders, the admins (exempt), and each
 *                                   inmate's total time and release flag
 *   <Prison>/Saved/state.json       the mod's: time served, escaped, done…
 *   shared/isle-prison.json         the inmates' SteamIDs, for PlayerCommands
 *                                   (!slay, !unstuck) and PteraCarry
 *
 * A sentence: an offense from the list (its minutes × 1 + repeatStep × the
 * earlier sentences of that player; the admin may change the number), a
 * reason. It is tied to the SteamID — every dino of theirs goes in. Time runs
 * only while they are online and inside (the mod counts it). Killing a fellow
 * inmate in the prison adds killPenaltyMin to the killer's sentence; whoever
 * kills an escaped inmate is credited as a hunter. Everything said to players
 * is in messages.ts (group "prison"); the log goes to Discord (kind "prison").
 */

export interface Offense { id: string; name: string; minutes: number }

export interface PrisonSettings {
  enabled: boolean;
  /** Added to a killer's sentence when they kill a fellow inmate in the prison. */
  killPenaltyMin: number;
  /** An escape is announced again every this many minutes while it lasts (0 = once). */
  remindMin: number;
  /** A repeat offender's sentence × (1 + repeatStep × earlier sentences). */
  repeatStep: number;
  /** Outsiders in the prison: warned, then `stingPct`% of max health every `stingEverySec`. */
  stingGraceSec: number;
  stingEverySec: number;
  stingPct: number;
  offenses: Offense[];
}

export const PRISON_DEFAULTS: PrisonSettings = {
  enabled: false, killPenaltyMin: 10, remindMin: 5, repeatStep: 0.5,
  stingGraceSec: 10, stingEverySec: 3, stingPct: 10,
  offenses: [
    { id: 'babykill', name: 'Giết baby', minutes: 30 },
    { id: 'kos', name: 'Giết không lý do (KOS)', minutes: 30 },
    { id: 'toxic', name: 'Toxic / chửi bới', minutes: 15 },
    { id: 'bug', name: 'Lợi dụng lỗi game', minutes: 60 },
  ],
};

export interface Sentence {
  id: string;
  steamId: string;
  name: string;
  offense: string;
  reason: string;
  /** The offense's minutes, the repeat multiplier, and what the admin decided. */
  baseMin: number;
  multiplier: number;
  minutes: number;
  /** Seconds to serve: minutes × 60 + extensions + kill penalties. */
  totalSec: number;
  /** Earlier sentences of this player when this one was given. */
  prior: number;
  by: string;
  at: number;
  /** An admin let them out early: the mod puts them back where they were arrested. */
  release?: boolean;
  releasedBy?: string;
  log: Array<{ t: number; text: string }>;
}

export interface PastSentence extends Sentence {
  endedAt: number;
  outcome: 'served' | 'released';
  served: number;
  escapes: number;
}

export interface Hunter { name: string; count: number; last: number }

interface PrisonData {
  settings: PrisonSettings;
  active: Sentence[];
  history: PastSentence[];
  hunters: Record<string, Hunter>;
}

/** What the mod reports per sentence (state.json). */
export interface ModSentenceState {
  served: number;
  escaped: boolean;
  escapes: number;
  inside: boolean;
  done: boolean;
  jailed: number;
  loc: { x: number; y: number } | null;
}

export interface PrisonDeps {
  announce: (text: string) => Promise<unknown>;
  directMessage: (steamId: string, text: string) => Promise<unknown>;
  discord: (text: string) => void;
  render: (key: string, vars: Record<string, string | number>) => string | null;
  nameOf: (steamId: string) => string | null;
  speciesOf: (steamId: string) => string | null;
  isOnline: (steamId: string) => boolean;
  adminIds: () => Promise<Set<string>>;
  groundPoints: GroundPoints;
  /** Events older than this are a replay (the bridge restarted): they set nothing off. */
  startedAt: number;
  log?: (msg: string) => void;
}

const MAX_OFFENSES = 40;
const MAX_HISTORY = 5000;
const DROPS = 30;
const STEAM_RE = /^\d{17}$/;

const dataPath = (): string => join(config.dataDir, 'prison.json');
const modPath = (): string => join(config.prisonRoot, 'prison.json');
const statePath = (): string => join(config.prisonRoot, 'state.json');

function int(v: unknown, lo: number, hi: number, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new ValidationError(`${what} must be a whole number ${lo}–${hi}`);
  return v;
}
function real(v: unknown, lo: number, hi: number, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new ValidationError(`${what} must be a number ${lo}–${hi}`);
  return v;
}
function text(v: unknown, max: number, what: string): string {
  if (typeof v !== 'string') throw new ValidationError(`${what} must be text`);
  // One line in the game's chat: no control characters, no commas (RCON splits on them).
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/,/g, ' ').trim().slice(0, max);
}

export function validatePrisonSettings(raw: unknown): PrisonSettings {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('body must be an object');
  const r = raw as Record<string, unknown>;
  if (typeof r['enabled'] !== 'boolean') throw new ValidationError('enabled must be true or false');
  const offRaw = r['offenses'] ?? [];
  if (!Array.isArray(offRaw) || offRaw.length > MAX_OFFENSES) throw new ValidationError(`offenses: a list of at most ${MAX_OFFENSES}`);
  const offenses = offRaw.map((o, i): Offense => {
    if (typeof o !== 'object' || o === null) throw new ValidationError(`offense ${i + 1} is not an object`);
    const x = o as Record<string, unknown>;
    const name = text(x['name'], 60, `offense ${i + 1}: name`);
    if (name === '') throw new ValidationError(`offense ${i + 1}: a name is required`);
    return {
      id: typeof x['id'] === 'string' && /^[a-z0-9]{1,16}$/.test(x['id']) ? x['id'] : randomBytes(4).toString('hex'),
      name,
      minutes: int(x['minutes'], 1, 100_000, `offense ${i + 1}: minutes`),
    };
  });
  if (new Set(offenses.map((o) => o.id)).size !== offenses.length) throw new ValidationError('two offenses have the same id');
  return {
    enabled: r['enabled'],
    killPenaltyMin: int(r['killPenaltyMin'], 0, 10_000, 'killPenaltyMin'),
    remindMin: int(r['remindMin'], 0, 600, 'remindMin'),
    repeatStep: Math.round(real(r['repeatStep'], 0, 10, 'repeatStep') * 100) / 100,
    stingGraceSec: int(r['stingGraceSec'], 0, 600, 'stingGraceSec'),
    stingEverySec: int(r['stingEverySec'], 1, 60, 'stingEverySec'),
    stingPct: int(r['stingPct'], 1, 100, 'stingPct'),
    offenses,
  };
}

/** "1 giờ 5 phút" / "45 phút" / "30 giây". */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} giây`;
  const m = Math.round(s / 60);
  const h = Math.floor(m / 60);
  if (h === 0) return `${m} phút`;
  return m % 60 === 0 ? `${h} giờ` : `${h} giờ ${m % 60} phút`;
}

/** × for a player with `prior` earlier sentences. */
export function repeatMultiplier(step: number, prior: number): number {
  return Math.round((1 + step * Math.max(0, prior)) * 100) / 100;
}

function emptyState(): ModSentenceState {
  return { served: 0, escaped: false, escapes: 0, inside: false, done: false, jailed: 0, loc: null };
}

function stateOf(raw: unknown): ModSentenceState {
  if (typeof raw !== 'object' || raw === null) return emptyState();
  const r = raw as Record<string, unknown>;
  const loc = r['loc'] as Record<string, unknown> | undefined;
  return {
    served: typeof r['served'] === 'number' ? r['served'] : 0,
    escaped: r['escaped'] === true,
    escapes: typeof r['escapes'] === 'number' ? r['escapes'] : 0,
    inside: r['inside'] === true,
    done: r['done'] === true,
    jailed: typeof r['jailed'] === 'number' ? r['jailed'] : 0,
    loc: loc && typeof loc['x'] === 'number' && typeof loc['y'] === 'number' ? { x: loc['x'], y: loc['y'] } : null,
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value)}\n`, 'utf8');
  await rename(tmp, path);
}

export class Prison {
  readonly #deps: PrisonDeps;
  #data: PrisonData = { settings: structuredClone(PRISON_DEFAULTS), active: [], history: [], hunters: {} };
  /** The mod's report, by sentence id. */
  #state: Record<string, ModSentenceState> = {};
  #stateAt = 0;
  /** Escaped sentences (from the mod's events, ahead of its next state file): id → since. */
  #escaped = new Map<string, number>();
  #remindedAt = new Map<string, number>();
  #modText = '';
  #inmatesText = '';
  #writing: Promise<void> = Promise.resolve();

  constructor(deps: PrisonDeps) { this.#deps = deps; }

  #log(msg: string): void { (this.#deps.log ?? ((m) => console.info(m)))(msg); }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(dataPath(), 'utf8')) as Partial<PrisonData>;
      this.#data = {
        settings: (() => { try { return validatePrisonSettings(raw.settings); } catch { return structuredClone(PRISON_DEFAULTS); } })(),
        active: Array.isArray(raw.active) ? raw.active : [],
        history: Array.isArray(raw.history) ? raw.history : [],
        hunters: typeof raw.hunters === 'object' && raw.hunters !== null ? raw.hunters : {},
      };
    } catch { /* first start: the defaults */ }
  }

  /** Save (one write at a time) and hand the mods their files. */
  #save(): Promise<void> {
    this.#writing = this.#writing.then(async () => {
      await writeJson(dataPath(), this.#data);
      await this.syncModFiles();
    }).catch((error: unknown) => this.#log(`[prison] save failed: ${(error as Error).message}`));
    return this.#writing;
  }

  get settings(): PrisonSettings { return this.#data.settings; }

  activeOf(steamId: string): Sentence | null {
    return this.#data.active.find((s) => s.steamId === steamId) ?? null;
  }

  isInmate(steamId: string): boolean { return this.activeOf(steamId) !== null; }

  /** Earlier sentences of a player (the active one not counted). */
  priorOf(steamId: string): number {
    return this.#data.history.filter((h) => h.steamId === steamId).length;
  }

  #served(s: Sentence): ModSentenceState { return this.#state[s.id] ?? emptyState(); }

  remainingOf(s: Sentence): number { return Math.max(0, s.totalSec - this.#served(s).served); }

  #isEscaped(s: Sentence): boolean { return this.#escaped.has(s.id) || this.#served(s).escaped; }

  async saveSettings(raw: unknown): Promise<PrisonSettings> {
    this.#data.settings = validatePrisonSettings(raw);
    await this.#save();
    return this.#data.settings;
  }

  /**
   * A new sentence. `minutes` decided by the admin (the panel shows the
   * offense × the repeat multiplier); without it, that is used.
   */
  async jail(raw: unknown, by: string, now = Math.floor(Date.now() / 1000)): Promise<Sentence> {
    if (typeof raw !== 'object' || raw === null) throw new ValidationError('body must be an object');
    const r = raw as Record<string, unknown>;
    const steamId = r['steamId'];
    if (typeof steamId !== 'string' || !STEAM_RE.test(steamId)) throw new ValidationError('steamId must be a SteamID64');
    if (this.activeOf(steamId)) throw new ValidationError('this player is already in prison (extend the sentence instead)');
    // A sentence nobody carries out would be a silent no-op: the prison must be on, with its zone.
    if (!this.#data.settings.enabled) throw new ValidationError('Nhà tù đang tắt: bật "Bật nhà tù" ở Cài đặt nhà tù rồi lưu, sau đó mới bỏ tù.');
    const zone = (await readAiZones()).zones.find((z) => z.prison && z.enabled);
    if (zone === undefined) throw new ValidationError('Chưa có vùng nhà tù đang bật: tick "🔒 Nhà tù" cho một vùng trên Bản đồ rồi lưu.');
    const offense = this.#data.settings.offenses.find((o) => o.id === r['offenseId']) ?? null;
    if (r['offenseId'] !== undefined && r['offenseId'] !== null && r['offenseId'] !== '' && offense === null) throw new ValidationError('unknown offense');
    const noMinutes = r['minutes'] === undefined || r['minutes'] === null;
    if (offense === null && noMinutes) throw new ValidationError('pick an offense or give the minutes');
    const prior = this.priorOf(steamId);
    const multiplier = repeatMultiplier(this.#data.settings.repeatStep, prior);
    const baseMin = offense?.minutes ?? 0;
    const minutes = noMinutes ? Math.max(1, Math.round(baseMin * multiplier)) : int(r['minutes'], 1, 100_000, 'minutes');
    const reason = text(r['reason'] ?? '', 200, 'reason') || (offense?.name ?? '');
    if (reason === '') throw new ValidationError('a reason is required');
    const name = text(r['name'] ?? '', 60, 'name') || this.#deps.nameOf(steamId) || steamId;
    const s: Sentence = {
      id: randomBytes(5).toString('hex'), steamId, name,
      offense: offense?.name ?? 'Khác', reason, baseMin, multiplier, minutes,
      totalSec: minutes * 60, prior, by, at: now, log: [],
    };
    this.#data.active.push(s);
    await this.#save();
    const vars = { name, duration: fmtDuration(s.totalSec), reason, offense: s.offense, prior, times: prior + 1 };
    const ann = this.#deps.render('prison.jailed.announce', vars);
    if (ann !== null) await this.#deps.announce(ann).catch(() => undefined);
    if (this.#deps.isOnline(steamId)) {
      const dm = this.#deps.render('prison.jailed.player', vars);
      if (dm !== null) await this.#deps.directMessage(steamId, dm).catch(() => undefined);
    }
    this.#deps.discord(`🔒 **${name}** \`${steamId}\` bị bỏ tù ${fmtDuration(s.totalSec)} — ${s.offense}: ${reason}`
      + `${prior > 0 ? ` (tiền án: ${prior}, ×${multiplier})` : ''} — bởi ${by}`);
    this.#log(`[prison] ${name} (${steamId}) jailed ${minutes} min by ${by}: ${reason}`);
    return s;
  }

  async extend(id: string, minutes: unknown, by: string, now = Math.floor(Date.now() / 1000)): Promise<Sentence> {
    const s = this.#data.active.find((x) => x.id === id);
    if (!s) throw new ValidationError('no such active sentence');
    const m = int(minutes, -100_000, 100_000, 'minutes');
    if (m === 0) throw new ValidationError('minutes must not be 0');
    s.totalSec = Math.max(this.#served(s).served, s.totalSec + m * 60);
    s.log.push({ t: now, text: `${m > 0 ? '+' : ''}${m} phút (${by})` });
    await this.#save();
    const dm = this.#deps.render('prison.extended.player', { minutes: m, left: fmtDuration(this.remainingOf(s)) });
    if (dm !== null && this.#deps.isOnline(s.steamId)) await this.#deps.directMessage(s.steamId, dm).catch(() => undefined);
    this.#deps.discord(`⏱️ Án của **${s.name}** \`${s.steamId}\` ${m > 0 ? '+' : ''}${m} phút — còn ${fmtDuration(this.remainingOf(s))} (bởi ${by})`);
    return s;
  }

  async release(id: string, by: string): Promise<Sentence> {
    const s = this.#data.active.find((x) => x.id === id);
    if (!s) throw new ValidationError('no such active sentence');
    s.release = true;
    s.releasedBy = by;
    await this.#save();
    this.#deps.discord(`🔓 **${s.name}** \`${s.steamId}\` được thả sớm bởi ${by} (sẽ ra khi online)`);
    return s;
  }

  /** The sentence is over (the mod says done): to the history. */
  async #finish(s: Sentence, now: number): Promise<void> {
    const st = this.#served(s);
    this.#data.active = this.#data.active.filter((x) => x.id !== s.id);
    this.#data.history.push({ ...s, endedAt: now, outcome: s.release ? 'released' : 'served', served: Math.round(st.served), escapes: st.escapes });
    if (this.#data.history.length > MAX_HISTORY) this.#data.history.splice(0, this.#data.history.length - MAX_HISTORY);
    this.#escaped.delete(s.id);
    this.#remindedAt.delete(s.id);
    await this.#save();
    const vars = { name: s.name };
    const dm = this.#deps.render('prison.released.player', vars);
    if (dm !== null) await this.#deps.directMessage(s.steamId, dm).catch(() => undefined);
    const ann = this.#deps.render('prison.released.announce', vars);
    if (ann !== null) await this.#deps.announce(ann).catch(() => undefined);
    this.#deps.discord(`🔓 **${s.name}** \`${s.steamId}\` đã ra tù (${s.release ? 'thả sớm' : 'mãn hạn'}, ngồi ${fmtDuration(st.served)}, trốn ${st.escapes} lần)`);
    this.#log(`[prison] ${s.name} (${s.steamId}) out: ${s.release ? 'released' : 'served'}`);
  }

  /** The mod's state file, the finished sentences, the escape reminders. Every few seconds. */
  async tick(now = Math.floor(Date.now() / 1000)): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(statePath(), 'utf8')) as { t?: unknown; sentences?: Record<string, unknown> };
      const t = typeof raw.t === 'number' ? raw.t : 0;
      if (t !== this.#stateAt) {
        this.#stateAt = t;
        const next: Record<string, ModSentenceState> = {};
        for (const [id, v] of Object.entries(raw.sentences ?? {})) next[id] = stateOf(v);
        this.#state = next;
        // The state file is newer than the last escape / return event: it decides.
        for (const id of [...this.#escaped.keys()]) if (next[id] && !next[id].escaped) this.#escaped.delete(id);
      }
    } catch { /* no state yet */ }
    for (const s of [...this.#data.active]) {
      if (this.#served(s).done) await this.#finish(s, now);
    }
    const remind = this.#data.settings.remindMin * 60;
    if (remind > 0) {
      for (const s of this.#data.active) {
        if (!this.#isEscaped(s) || !this.#deps.isOnline(s.steamId)) continue;
        const since = this.#escaped.get(s.id) ?? now;
        if (now - (this.#remindedAt.get(s.id) ?? since) < remind) continue;
        this.#remindedAt.set(s.id, now);
        const text = this.#deps.render('prison.escape.remind', { name: s.name, minutes: Math.max(1, Math.round((now - since) / 60)),
          species: this.#deps.speciesOf(s.steamId) ?? '?', left: fmtDuration(this.remainingOf(s)) });
        if (text !== null) await this.#deps.announce(text).catch(() => undefined);
      }
    }
    await this.syncModFiles();
  }

  /** The mod's file and the inmates list, rewritten only when they change. */
  async syncModFiles(): Promise<void> {
    const zones = await readAiZones();
    const zone: AiZone | undefined = zones.zones.find((z) => z.prison && z.enabled);
    const s = this.#data.settings;
    const mod = {
      enabled: s.enabled && zone !== undefined,
      zone: zone === undefined ? null : {
        name: zone.name, x: zone.x, y: zone.y, radius: boundRadiusCm(zone),
        ...(zoneOutline(zone) ? { poly: zoneOutline(zone) } : {}),
      },
      drops: zone === undefined ? [] : this.dropsOf(zone),
      sting: { grace: s.stingGraceSec, every: s.stingEverySec, pct: s.stingPct },
      exempt: [...await this.#deps.adminIds()].sort(),
      sentences: Object.fromEntries(this.#data.active.map((x) => [x.steamId, { id: x.id, total: x.totalSec, release: x.release === true }])),
    };
    const modText = JSON.stringify(mod);
    if (modText !== this.#modText) {
      await writeJson(modPath(), mod);
      this.#modText = modText;
    }
    const inmates = { inmates: this.#data.active.map((x) => x.steamId).sort() };
    const inmatesText = JSON.stringify(inmates);
    if (inmatesText !== this.#inmatesText) {
      await writeJson(config.prisonInmatesPath, inmates);
      this.#inmatesText = inmatesText;
    }
  }

  /** Ground spots inside the prison (x, y, z), nearest the centre first: where inmates are dropped. */
  dropsOf(zone: AiZone): Array<[number, number, number]> {
    return zonePoints(zone, this.#deps.groundPoints, 400)
      .sort((a, b) => Math.hypot(a[0] - zone.x, a[1] - zone.y) - Math.hypot(b[0] - zone.x, b[1] - zone.y))
      .slice(0, DROPS)
      .map((p) => [Math.round(p[0]), Math.round(p[1]), Math.round(p[2])]);
  }

  /**
   * The mod's events (jailed, escape, returned, released) and the deaths the
   * prison cares about. Old events (a replay at start) only keep the escape
   * flags right.
   */
  async handle(event: GameEvent): Promise<void> {
    const e = event as GameEvent & Record<string, unknown>;
    const live = e.t >= this.#deps.startedAt - 10;
    const type = e.type as string;
    if (type === 'prison_escape' || type === 'prison_returned' || type === 'prison_jailed' || type === 'prison_released') {
      const s = this.#data.active.find((x) => x.id === e['id']);
      if (!s) return;
      if (type === 'prison_escape') {
        this.#escaped.set(s.id, e.t);
        this.#remindedAt.set(s.id, e.t);
        if (!live) return;
        const vars = { name: s.name, species: typeof e['species'] === 'string' ? e['species'] : this.#deps.speciesOf(s.steamId) ?? '?',
          left: fmtDuration(this.remainingOf(s)), escapes: typeof e['escapes'] === 'number' ? e['escapes'] : 1 };
        const ann = this.#deps.render('prison.escape.announce', vars);
        if (ann !== null) await this.#deps.announce(ann).catch(() => undefined);
        this.#deps.discord(`🚨 **${s.name}** \`${s.steamId}\` vượt ngục (lần ${vars.escapes})`);
        return;
      }
      if (type === 'prison_returned' || type === 'prison_jailed') {
        const was = this.#escaped.delete(s.id);
        this.#remindedAt.delete(s.id);
        if (!live) return;
        if (type === 'prison_returned' && was) {
          const ann = this.#deps.render('prison.returned.announce', { name: s.name });
          if (ann !== null) await this.#deps.announce(ann).catch(() => undefined);
          this.#deps.discord(`🔒 **${s.name}** \`${s.steamId}\` đã quay lại nhà tù`);
        }
        if (type === 'prison_jailed') {
          const dm = this.#deps.render('prison.moved.player', { left: fmtDuration(this.remainingOf(s)), reason: s.reason });
          if (dm !== null) await this.#deps.directMessage(s.steamId, dm).catch(() => undefined);
        }
        return;
      }
      // prison_released: finish now, not at the next state file.
      if (live) {
        const st = this.#served(s);
        this.#state[s.id] = { ...st, done: true, served: typeof e['served'] === 'number' ? Math.max(st.served, e['served']) : st.served };
        await this.#finish(s, e.t);
      }
      return;
    }
    if (type !== 'death' || !live) return;
    const victimId = typeof e['steamId'] === 'string' ? e['steamId'] : null;
    const victim = victimId === null ? null : this.activeOf(victimId);
    const killerId = typeof e['killer'] === 'string' ? e['killer'] : null;
    if (victim === null || killerId === null || killerId === victimId) return;
    if (this.#isEscaped(victim)) {
      // A hunter brought an escaped inmate down.
      const name = (typeof e['killerName'] === 'string' ? e['killerName'] : null) ?? this.#deps.nameOf(killerId) ?? killerId;
      const h = this.#data.hunters[killerId] ?? { name, count: 0, last: 0 };
      this.#data.hunters[killerId] = { name, count: h.count + 1, last: e.t };
      this.#escaped.delete(victim.id);
      await this.#save();
      const ann = this.#deps.render('prison.bounty.announce', { hunter: name, name: victim.name, count: h.count + 1 });
      if (ann !== null) await this.#deps.announce(ann).catch(() => undefined);
      this.#deps.discord(`🏹 **${name}** \`${killerId}\` đã hạ kẻ vượt ngục **${victim.name}** (thợ săn: ${h.count + 1} lần)`);
      return;
    }
    const killer = this.activeOf(killerId);
    const penalty = this.#data.settings.killPenaltyMin;
    if (killer === null || penalty <= 0) return;
    // An inmate killed a fellow inmate in the prison (health is held there: a one-shot).
    killer.totalSec += penalty * 60;
    killer.log.push({ t: e.t, text: `+${penalty} phút: giết bạn tù ${victim.name}` });
    await this.#save();
    const dm = this.#deps.render('prison.killPenalty.player', { minutes: penalty, name: victim.name, left: fmtDuration(this.remainingOf(killer)) });
    if (dm !== null) await this.#deps.directMessage(killerId, dm).catch(() => undefined);
    this.#deps.discord(`⚖️ **${killer.name}** \`${killerId}\` giết bạn tù **${victim.name}** trong tù: án +${penalty} phút`);
  }

  /** Escaped inmates where the mod last saw them (for every player's map). */
  escapees(): Array<{ steamId: string; name: string; species: string | null; x: number; y: number; since: number }> {
    const out = [];
    for (const s of this.#data.active) {
      const st = this.#served(s);
      if (!this.#isEscaped(s) || st.loc === null || !this.#deps.isOnline(s.steamId)) continue;
      out.push({ steamId: s.steamId, name: s.name, species: this.#deps.speciesOf(s.steamId), x: st.loc.x, y: st.loc.y,
        since: this.#escaped.get(s.id) ?? this.#stateAt });
    }
    return out;
  }

  hunters(limit = 50): Array<{ steamId: string } & Hunter> {
    return Object.entries(this.#data.hunters).map(([steamId, h]) => ({ steamId, ...h }))
      .sort((a, b) => b.count - a.count || b.last - a.last).slice(0, limit);
  }

  /** One player's own view (the portal): their sentence, if any. */
  playerView(steamId: string): { offense: string; reason: string; remainingSec: number; totalSec: number; escaped: boolean; inside: boolean; at: number } | null {
    const s = this.activeOf(steamId);
    if (s === null) return null;
    const st = this.#served(s);
    return { offense: s.offense, reason: s.reason, remainingSec: Math.round(this.remainingOf(s)), totalSec: s.totalSec,
      escaped: this.#isEscaped(s), inside: st.inside, at: s.at };
  }

  /** Everything for the panel. */
  async view(): Promise<unknown> {
    const zones = await readAiZones();
    const zone = zones.zones.find((z) => z.prison) ?? null;
    const priors: Record<string, number> = {};
    for (const h of this.#data.history) priors[h.steamId] = (priors[h.steamId] ?? 0) + 1;
    return {
      settings: this.#data.settings,
      zone: zone === null ? null : { id: zone.id, name: zone.name, enabled: zone.enabled, drops: this.dropsOf(zone).length },
      modState: { t: this.#stateAt },
      active: this.#data.active.map((s) => {
        const st = this.#served(s);
        return { ...s, served: Math.round(st.served), remainingSec: Math.round(this.remainingOf(s)), escaped: this.#isEscaped(s),
          escapes: st.escapes, inside: st.inside, online: this.#deps.isOnline(s.steamId), jailed: st.jailed > 0, loc: st.loc };
      }),
      history: this.#data.history.slice(-200).reverse(),
      priors,
      hunters: this.hunters(),
    };
  }
}
