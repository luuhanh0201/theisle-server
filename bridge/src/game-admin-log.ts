import { open, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { audit } from './audit.js';
import { inGameOff } from './permissions.js';

/**
 * What admins do in the game (/adminpanel: bring, go to, heal, grow, set
 * vitals, weather, spectator mode…), into the panel's admin log (and from
 * there to Discord, kind "admin"). The game writes each one to TheIsle.log:
 *
 *   [2026.09.28-09.11.03:270][784]LogTheIsleCommandData: [2026.09.28-16.11.03] T-Rex Nổi Loạn [7656…579]
 *     used command: Bring at: Quang Tèo, [7656…629], Class: Deinosuchus, Gender: Male, Previous value: 0.000000%, New value: 0.000000%
 *
 * The first time is UTC. The log is read from where it was left (a restart
 * starts a new TheIsle.log); the time of the last line taken is kept in
 * DATA_DIR/game-admin-log.json, so a bridge restart neither repeats nor skips.
 * An admin whose rights in the game are switched off (permissions.ts) and who
 * still used one is logged as a failure: the game let them (until its restart).
 */

export interface GameAdminAction {
  t: number;
  steamId: string;
  name: string;
  command: string;
  target: { name: string; steamId: string; species: string; from: number; to: number } | null;
}

const LINE = /^\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})\]\[\s*\d+\]LogTheIsleCommandData: \[[^\]]*\] (.+?) \[(\d{17})\] used command: (.*?)\s*$/;
const TARGET = /^(.*?) at: (.*?), \[(\d{17})\], Class: (\w+), Gender: \w+, Previous value: ([\d.]+)%, New value: ([\d.]+)%$/;

/** One TheIsle.log line, or null when it is not an admin's command. */
export function parseAdminLine(line: string): GameAdminAction | null {
  const m = LINE.exec(line);
  if (m === null) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
  const t = Math.floor(Date.UTC(y as number, (mo as number) - 1, d, h, mi, s) / 1000);
  const what = m[10] as string;
  const tg = TARGET.exec(what);
  return {
    t, name: m[8] as string, steamId: m[9] as string,
    command: (tg ? tg[1] as string : what).replace(/!$/, '').trim(),
    target: tg ? { name: tg[2] as string, steamId: tg[3] as string, species: tg[4] as string, from: Number(tg[5]), to: Number(tg[6]) } : null,
  };
}

/** How the panel log reads a command (the game's own words for the rest). */
const VN: Record<string, string> = {
  'Bring': 'Kéo người chơi tới chỗ mình', 'Go to': 'Dịch chuyển tới người chơi', 'Heal': 'Hồi đầy máu',
  'Grow': 'Đặt growth', 'SetHunger': 'Đặt đói', 'SetThirst': 'Đặt khát', 'SetStamina': 'Đặt stamina',
  'SetHealth': 'Đặt máu', 'SetBlood': 'Đặt huyết', 'SetNutrientValue': 'Đặt dinh dưỡng', 'SetOxygen': 'Đặt oxy',
  'Changed weather': 'Đổi thời tiết', 'Enter Specmode': 'Vào chế độ quan sát (bay)', 'Leave Specmode': 'Thoát chế độ quan sát',
};
export const commandText = (c: string): string => VN[c] ?? c;

export function detailOf(a: GameAdminAction): string {
  if (a.target === null) return commandText(a.command);
  const g = a.target;
  const change = g.from !== g.to ? ` · ${round(g.from)}% → ${round(g.to)}%` : '';
  return `${commandText(a.command)} · ${g.name} (${g.steamId}) · ${g.species}${change}`;
}
const round = (n: number): number => Math.round(n * 10) / 10;

const statePath = (): string => join(config.dataDir, 'game-admin-log.json');

export class GameAdminLog {
  readonly #path: string;
  #offset = 0;
  #ino = -1;
  /** Lines up to this time (unix s) were taken before the bridge started. */
  #since = 0;
  #lastT = 0;
  #carry = '';
  #busy = false;

  constructor(path = config.game.logPath) {
    this.#path = path;
  }

  async load(): Promise<void> {
    try {
      const d = JSON.parse(await readFile(statePath(), 'utf8')) as { lastT?: unknown };
      if (typeof d.lastT === 'number') this.#lastT = d.lastT;
    } catch {
      // First run: only what happens from now on (the old log is not the panel's history).
      this.#lastT = Math.floor(Date.now() / 1000);
    }
    this.#since = this.#lastT;
  }

  /** Read what was added to the log since the last poll. */
  async poll(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const st = await stat(this.#path).catch(() => null);
      if (st === null) return;
      if (st.ino !== this.#ino || st.size < this.#offset) {
        // A new TheIsle.log (the game restarted): from its start.
        this.#ino = st.ino;
        this.#offset = 0;
        this.#carry = '';
      }
      if (st.size === this.#offset) return;
      const fh = await open(this.#path, 'r');
      try {
        const want = Math.min(st.size - this.#offset, 8 * 1024 * 1024);
        const buf = Buffer.alloc(want);
        const { bytesRead } = await fh.read(buf, 0, want, this.#offset);
        this.#offset += bytesRead;
        const text = this.#carry + buf.subarray(0, bytesRead).toString('utf8');
        const lines = text.split('\n');
        this.#carry = lines.pop() ?? '';
        await this.#take(lines);
      } finally {
        await fh.close();
      }
    } finally {
      this.#busy = false;
    }
  }

  async #take(lines: string[]): Promise<void> {
    let off: Set<string> | null = null;
    let last = this.#lastT;
    for (const raw of lines) {
      if (!raw.includes('used command:')) continue;
      const a = parseAdminLine(raw.replace(/\r$/, ''));
      if (a === null || a.t <= this.#since) continue;
      off ??= await inGameOff();
      const blocked = off.has(a.steamId);
      await audit({
        action: `in-game ${a.command}`, detail: detailOf(a), ok: !blocked,
        ...(blocked ? { error: 'quyền admin trong game đang TẮT nhưng game vẫn cho dùng, hết hẳn sau lần restart tới' } : {}),
      }, { steamId: a.steamId, name: a.name }, a.t);
      last = Math.max(last, a.t);
    }
    if (last !== this.#lastT) {
      this.#lastT = last;
      await writeFile(statePath(), JSON.stringify({ lastT: last }), 'utf8').catch((e: unknown) => console.error('[game-admin-log] cannot save', e));
    }
  }
}
