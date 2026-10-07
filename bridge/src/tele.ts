import { randomInt } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { ValidationError } from './garage.js';
import type { LivePlayer } from './live.js';

/**
 * Tele con non (owner, 2026-10-06): A takes a code on the Dino Live page, B types it there and
 * B's dino is moved next to A's. Both dinos small (growth at most maxGrowthPct / targetMaxGrowthPct,
 * 40 % by default), B not in a fight for the last combatS seconds, B stands still countdownS
 * seconds, then cooldownS before B may do it again. A code lives codeMinutes and works once.
 *
 * The bridge checks what it can see (the code, the growth in live.json, the cooldown) for a quick
 * answer; DinoGarage (garage/tele.lua) checks everything again on the game thread and moves the
 * dino: the "tele" inbox command (commands.ts), its outcome a `tele_result` event.
 *
 *   DATA_DIR/tele-settings.json   the panel's settings (Mods → Tele con non)
 *
 * Codes and cooldowns live in memory: a bridge restart forgets them (a code is minutes long).
 */
export interface TeleSettings {
  /** The dino that moves (B, who types the code): growth at most this %, 1–100. */
  maxGrowthPct: number;
  /** The dino it lands next to (A, who gave the code): growth at most this %. */
  targetMaxGrowthPct: number;
  /** How long a code works. */
  codeMinutes: number;
  /** Seconds before the one who moved may move again. */
  cooldownS: number;
  /** No fight (hit, been hit, lost health) for this many seconds before. */
  combatS: number;
  /** Stand still this many seconds before the move. */
  countdownS: number;
}

export const TELE_DEFAULTS: TeleSettings = { maxGrowthPct: 40, targetMaxGrowthPct: 40, codeMinutes: 5, cooldownS: 60, combatS: 60, countdownS: 5 };

const LIMITS: Record<keyof TeleSettings, [number, number]> = {
  maxGrowthPct: [1, 100], targetMaxGrowthPct: [1, 100], codeMinutes: [1, 60], cooldownS: [0, 3600], combatS: [0, 600], countdownS: [0, 60],
};

const path = (): string => join(config.dataDir, 'tele-settings.json');

function normalise(raw: Record<string, unknown>, strict: boolean): TeleSettings {
  const out: TeleSettings = { ...TELE_DEFAULTS };
  for (const key of Object.keys(LIMITS) as (keyof TeleSettings)[]) {
    const v = raw[key];
    if (v === undefined) continue;
    const [lo, hi] = LIMITS[key];
    if (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi) out[key] = v;
    else if (strict) throw new ValidationError(`${key} must be a whole number ${lo}–${hi}`);
  }
  return out;
}

export async function readTeleSettings(): Promise<TeleSettings> {
  try {
    return normalise(JSON.parse(await readFile(path(), 'utf8')) as Record<string, unknown>, false);
  } catch {
    return { ...TELE_DEFAULTS };
  }
}

export async function saveTeleSettings(raw: unknown): Promise<TeleSettings> {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('settings must be an object');
  const settings = normalise(raw as Record<string, unknown>, true);
  await mkdir(config.dataDir, { recursive: true });
  const tmp = `${path()}.tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
  await rename(tmp, path());
  return settings;
}

/** No 0 / O, 1 / I: a code read aloud or copied by hand. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

/** What a player typed → the code (upper case, spaces and dashes dropped), or null. */
export function normaliseCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const c = raw.toUpperCase().replace(/[\s-]/g, '');
  if (c.length !== CODE_LENGTH) return null;
  for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null;
  return c;
}

/** BP_Tyrannosaurus_C (or a class path) → Tyrannosaurus, for a message. */
const speciesName = (c: string): string => (c.split('.').pop() ?? c).replace(/^BP_/, '').replace(/_C$/, '');

/** A growth share 0–1 → whole % for a message. */
const pct = (g: number): number => Math.floor(g * 100 + 1e-6);
/** At most `maxPct` (40 % allowed at 40). */
export const growthAllowed = (growth: number, maxPct: number): boolean => growth * 100 <= maxPct + 1e-6;

/**
 * Why B (`me`) cannot be moved to A (`target`) now, by what live.json shows, or null. A growth
 * the file does not have is let through: the mod reads the game's own.
 */
export function teleRefusal(me: LivePlayer | null, target: LivePlayer | null, s: TeleSettings,
  species: { me: string | null; target: string | null } = { me: null, target: null }): string | null {
  if (me === null) return 'Bạn cần đang trong game, điều khiển một con dino.';
  if (target === null) return 'Người đưa mã đang không ở trong game.';
  // Only to a dino of the same species (owner, 2026-10-07); the mod checks the game's own classes again.
  if (species.me && species.target && species.me !== species.target) {
    return `Chỉ tele tới dino cùng loài (bạn: ${speciesName(species.me)}, người đưa mã: ${speciesName(species.target)}).`;
  }
  if (me.growth !== null && !growthAllowed(me.growth, s.maxGrowthPct)) {
    return `Chỉ dino từ ${s.maxGrowthPct}% tăng trưởng trở xuống mới tele được (dino của bạn ${pct(me.growth)}%).`;
  }
  if (target.growth !== null && !growthAllowed(target.growth, s.targetMaxGrowthPct)) {
    return `Dino của người đưa mã đã lớn hơn ${s.targetMaxGrowthPct}%: không tele tới được.`;
  }
  return null;
}

/** Why A cannot give a code now, or null: in game, a small enough dino. */
export function codeRefusal(me: LivePlayer | null, s: TeleSettings): string | null {
  if (me === null) return 'Bạn cần đang trong game, điều khiển một con dino để lấy mã.';
  if (me.growth !== null && !growthAllowed(me.growth, s.targetMaxGrowthPct)) {
    return `Chỉ dino từ ${s.targetMaxGrowthPct}% tăng trưởng trở xuống mới lấy mã được (dino của bạn ${pct(me.growth)}%).`;
  }
  return null;
}

interface Code {
  code: string;
  owner: string;
  expiresAt: number;
  /** Being used: by whom, its inbox command, until when it is held for them. */
  use: { by: string; cmdId: number; until: number } | null;
}

/** What the mod said about one use: started (null: not yet), and its end (null: not yet). */
export interface UseOutcome { started: boolean | null; final: { ok: boolean } | null }

export class TeleCodes {
  readonly #byCode = new Map<string, Code>();
  /** The one who moved → when (unix s). */
  readonly #moved = new Map<string, number>();

  #sweep(nowS: number): void {
    for (const [k, c] of this.#byCode) if (c.use === null && c.expiresAt < nowS) this.#byCode.delete(k);
  }

  #ofOwner(owner: string): Code | null {
    for (const c of this.#byCode.values()) if (c.owner === owner) return c;
    return null;
  }

  /** A new code for `owner` (their old one dropped). Refused while their code is being used. */
  issue(owner: string, s: TeleSettings, nowS: number, rnd: (max: number) => number = randomInt): { code: string; expiresAt: number } {
    this.#sweep(nowS);
    const old = this.#ofOwner(owner);
    if (old !== null && old.use !== null) throw new ValidationError('Mã của bạn đang được dùng, chờ vài giây.');
    if (old !== null) this.#byCode.delete(old.code);
    let code = '';
    do {
      code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[rnd(CODE_ALPHABET.length)];
    } while (this.#byCode.has(code));
    const c: Code = { code, owner, expiresAt: nowS + s.codeMinutes * 60, use: null };
    this.#byCode.set(code, c);
    return { code, expiresAt: c.expiresAt };
  }

  /** Their code, while it works. */
  mine(owner: string, nowS: number): { code: string; expiresAt: number; inUse: boolean } | null {
    this.#sweep(nowS);
    const c = this.#ofOwner(owner);
    return c === null ? null : { code: c.code, expiresAt: c.expiresAt, inUse: c.use !== null };
  }

  /** Drop their code (not one being used). */
  drop(owner: string): void {
    const c = this.#ofOwner(owner);
    if (c !== null && c.use === null) this.#byCode.delete(c.code);
  }

  /** Seconds before `steamId` may move again (0: now). */
  cooldownLeft(steamId: string, s: TeleSettings, nowS: number): number {
    const at = this.#moved.get(steamId);
    return at === undefined ? 0 : Math.max(0, at + s.cooldownS - nowS);
  }

  /** The owner of `code` for `user` to move to, or a refusal (ValidationError). */
  lookup(code: string, user: string, nowS: number): { owner: string } {
    this.#sweep(nowS);
    const c = this.#byCode.get(code);
    if (c === undefined || (c.use === null && c.expiresAt < nowS)) throw new ValidationError('Mã không đúng hoặc đã hết hạn.');
    if (c.owner === user) throw new ValidationError('Đây là mã của bạn: đưa mã cho người khác nhập.');
    if (c.use !== null) throw new ValidationError(c.use.by === user ? 'Bạn đang dùng mã này, chờ kết quả.' : 'Mã đang được người khác dùng.');
    return { owner: c.owner };
  }

  /** Hold `code` for `by` while the mod runs their move (released by settle()). */
  reserve(code: string, by: string, cmdId: number, until: number): void {
    const c = this.#byCode.get(code);
    if (c !== undefined) c.use = { by, cmdId, until };
  }

  /**
   * Settle the codes being used by what the mod said: moved = the code is gone and the cooldown
   * starts; refused, failed or no word by `until` = the code works again (until it expires).
   */
  settle(outcome: (by: string, cmdId: number) => UseOutcome, nowS: number): void {
    for (const [k, c] of this.#byCode) {
      if (c.use === null) continue;
      const o = outcome(c.use.by, c.use.cmdId);
      if (o.final?.ok === true) {
        this.#moved.set(c.use.by, nowS);
        this.#byCode.delete(k);
      } else if (o.started === false || o.final !== null || nowS > c.use.until) {
        c.use = null;
      }
    }
    if (this.#moved.size > 5000) this.#moved.clear();
  }
}

/** The bridge's codes (one process, in memory). */
export const teleCodes = new TeleCodes();
