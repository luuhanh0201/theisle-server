import { connect, type Socket } from 'node:net';
import { ValidationError } from './garage.js';

/**
 * Evrima RCON client (docs/reference/EVRIMA_RCON_Protocol.md).
 *
 *   auth     0x01 + password            reply "Password Accepted", no terminator
 *   command  0x02 + opcode + args       args UTF-8, comma-separated
 *
 * Responses have no common terminator: GetPlayerList ends with "\n\n",
 * everything else with "\n" or nothing at all. So every read ends on the
 * command's terminator OR after the stream has been idle for a moment — never
 * by waiting for the socket to close (it does not).
 *
 * One connection per command, and commands are queued: the server is not
 * known to handle interleaved requests, and admin traffic is tiny.
 */

export class RconError extends Error {}

export interface RconOptions {
  host: string;
  port: number;
  password: string;
  /** Silence that ends a response with no terminator. */
  idleMs?: number;
  /** Hard cap on one command, connect to last byte. */
  timeoutMs?: number;
}

type ArgKind = 'none' | 'text' | 'number' | 'className' | 'classList' | 'steamIds';

export interface RconCommand {
  opcode: number;
  label: string;
  args: ArgKind;
  /** Reads do not change the server. */
  read: boolean;
  /** Toggles flip a setting the game does not report back — the UI says so. */
  toggle?: boolean;
  terminator?: string;
}

/**
 * Everything the panel may send. Deliberately absent:
 *   0x60 Pause           — broken upstream, times out
 *   0x70 Command         — arbitrary console command, too much power for a web form
 *   0x22 SetGrowthMultiplier — args documented as "SteamID,value"; whether it is
 *                          per-player or global is unverified, so not exposed
 *   0x20/0x30 Ban/Kick   — the in-game admin panel already does these
 */
export const RCON_COMMANDS: Record<string, RconCommand> = {
  serverDetails: { opcode: 0x12, label: 'Thông tin server', args: 'none', read: true },
  getPlayables: { opcode: 0x14, label: 'Danh sách loài được chơi', args: 'none', read: true },
  getPlayerList: { opcode: 0x40, label: 'Danh sách người chơi', args: 'none', read: true, terminator: '\n\n' },
  getQueueStatus: { opcode: 0x93, label: 'Tình trạng hàng chờ', args: 'none', read: true },

  announce: { opcode: 0x10, label: 'Thông báo toàn server', args: 'text', read: false },
  save: { opcode: 0x50, label: 'Lưu game', args: 'none', read: false },
  wipeCorpses: { opcode: 0x13, label: 'Dọn xác', args: 'none', read: false },
  addPlayable: { opcode: 0x1a, label: 'Cho phép loài', args: 'className', read: false },
  removePlayable: { opcode: 0x1b, label: 'Cấm loài', args: 'className', read: false },
  addWhitelistIds: { opcode: 0x82, label: 'Thêm vào whitelist', args: 'steamIds', read: false },
  removeWhitelistIds: { opcode: 0x83, label: 'Bỏ khỏi whitelist', args: 'steamIds', read: false },
  adjustAiDensity: { opcode: 0x92, label: 'Mật độ AI', args: 'number', read: false },
  disableAiClasses: { opcode: 0x91, label: 'Tắt AI theo loài', args: 'classList', read: false },

  toggleGlobalChat: { opcode: 0x84, label: 'Chat toàn server', args: 'none', read: false, toggle: true },
  toggleHumans: { opcode: 0x86, label: 'Người (humans)', args: 'none', read: false, toggle: true },
  toggleAi: { opcode: 0x90, label: 'AI', args: 'none', read: false, toggle: true },
  toggleAiLearning: { opcode: 0x94, label: 'AI học', args: 'none', read: false, toggle: true },
  toggleMigrations: { opcode: 0x19, label: 'Di cư', args: 'none', read: false, toggle: true },
  toggleWhitelist: { opcode: 0x81, label: 'Whitelist', args: 'none', read: false, toggle: true },
  toggleGrowthMultiplier: { opcode: 0x21, label: 'Hệ số growth', args: 'none', read: false, toggle: true },
};

const CLASS_RE = /^[A-Za-z0-9_]{2,64}$/;
const STEAM_RE = /^\d{17}$/;

/** Turn user input into the argument string, or throw ValidationError. */
export function encodeArgs(kind: ArgKind, raw: unknown): string {
  switch (kind) {
    case 'none':
      return '';
    case 'text': {
      if (typeof raw !== 'string') throw new ValidationError('text required');
      // Commas split arguments and newlines end frames: neither may pass.
      const text = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/,/g, ';').trim();
      if (text === '') throw new ValidationError('text required');
      if (text.length > 200) throw new ValidationError('text is limited to 200 characters');
      return text;
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new ValidationError('number must be 0–100');
      return String(n);
    }
    case 'className': {
      if (typeof raw !== 'string' || !CLASS_RE.test(raw.trim())) {
        throw new ValidationError('class name must be letters, digits or _');
      }
      return raw.trim();
    }
    case 'classList':
    case 'steamIds': {
      const items = (Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,]+/))
        .map((x) => String(x).trim())
        .filter((x) => x !== '');
      const re = kind === 'steamIds' ? STEAM_RE : CLASS_RE;
      if (items.length === 0) throw new ValidationError('at least one value required');
      const bad = items.find((x) => !re.test(x));
      if (bad !== undefined) throw new ValidationError(`invalid value: ${bad}`);
      return items.join(',');
    }
  }
}

/** The kept RCON connection: whoever waits on it gets its data and its end. */
interface RconConnection {
  socket: Socket;
  ready: Promise<void>;
  onData: ((chunk: Buffer) => void) | null;
  onGone: (() => void) | null;
}

export class Rcon {
  #queue: Promise<unknown> = Promise.resolve();
  readonly #opts: Required<RconOptions>;

  constructor(opts: RconOptions) {
    this.#opts = { idleMs: 500, timeoutMs: 8000, ...opts };
  }

  get enabled(): boolean {
    return this.#opts.password !== '';
  }

  /** Told of every named command run (the Discord log shows the announcements: discord.ts). */
  onRun: ((name: string, args: unknown) => void) | null = null;

  /** Run a named command from RCON_COMMANDS. */
  run(name: string, rawArgs?: unknown): Promise<string> {
    const cmd = RCON_COMMANDS[name];
    if (cmd === undefined) return Promise.reject(new ValidationError(`unknown RCON command: ${name}`));
    if (this.onRun !== null) {
      try { this.onRun(name, rawArgs); } catch (error) { console.error('[rcon] listener failed:', error); }
    }
    let args: string;
    try {
      args = encodeArgs(cmd.args, rawArgs);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.exec(cmd.opcode, args, cmd.terminator ?? '\n');
  }

  /**
   * RCON DirectMessage (0x11, "SteamID64,message"): shown to that one player.
   * Commas split the arguments, so the message's are replaced, like announce.
   */
  directMessage(steamId: string, message: string): Promise<string> {
    if (!STEAM_RE.test(steamId)) return Promise.reject(new ValidationError(`invalid SteamID64: ${steamId}`));
    let text: string;
    try {
      text = encodeArgs('text', message);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.exec(0x11, `${steamId},${text}`);
  }

  /** Raw opcode call, queued behind any command already in flight. */
  exec(opcode: number, args = '', terminator = '\n'): Promise<string> {
    if (!this.enabled) return Promise.reject(new RconError('RCON is not configured (RCON_PASSWORD is empty)'));
    const run = this.#queue.then(() => this.#session(opcode, args, terminator));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  /**
   * ONE connection, logged in once and kept: the game never closes its side of
   * an RCON connection the client ends, so a connection per command left one
   * dead socket (CLOSE-WAIT) in the game per command — 422 after 3 h on
   * 2026-09-26, and the server's FPS fell from 30 to 4 with them. It is only
   * replaced when the game closes it (a restart) or it fails.
   */
  #conn: RconConnection | null = null;

  #connection(): Promise<RconConnection> {
    if (this.#conn !== null && !this.#conn.socket.destroyed) {
      const c = this.#conn;
      return c.ready.then(() => c);
    }
    const { host, port, password, idleMs, timeoutMs } = this.#opts;
    const socket = connect({ host, port });
    const conn: RconConnection = { socket, ready: Promise.resolve(), onData: null, onGone: null };
    this.#conn = conn;
    const gone = (): void => {
      if (this.#conn === conn) this.#conn = null;
      const g = conn.onGone;
      conn.onGone = null;
      g?.();
    };
    conn.ready = new Promise<void>((resolve, reject) => {
      let buffer = '';
      let idle: NodeJS.Timeout | null = null;
      let done = false;
      const end = (error: Error | null): void => {
        if (done) return;
        done = true;
        if (idle) clearTimeout(idle);
        clearTimeout(hard);
        if (error) { socket.destroy(); gone(); reject(error); } else resolve();
      };
      const hard = setTimeout(() => end(new RconError(`RCON did not answer the login within ${timeoutMs}ms`)), timeoutMs);
      const check = (): void => {
        if (/password accepted/i.test(buffer)) end(null);
        else end(new RconError('RCON rejected the password'));
      };
      conn.onData = (chunk) => {
        buffer += chunk.toString('utf8');
        if (/password accepted/i.test(buffer)) { end(null); return; }
        if (idle) clearTimeout(idle);
        idle = setTimeout(check, idleMs);
      };
      conn.onGone = () => end(new RconError('RCON closed the connection during login'));
      socket.on('connect', () => {
        socket.write(Buffer.concat([Buffer.from([0x01]), Buffer.from(password, 'utf8')]));
        idle = setTimeout(check, idleMs);
      });
      socket.on('error', (error) => { end(new RconError(`RCON connection failed: ${error.message}`)); socket.destroy(); gone(); });
    });
    // Data with no command waiting (a late reply) is dropped.
    socket.on('data', (chunk: Buffer) => conn.onData?.(chunk));
    socket.on('close', gone);
    return conn.ready.then(() => { conn.onData = null; conn.onGone = null; return conn; });
  }

  #session(opcode: number, args: string, terminator: string): Promise<string> {
    const { idleMs, timeoutMs } = this.#opts;
    return this.#connection().then((conn) => new Promise<string>((resolve) => {
      let buffer = '';
      let idle: NodeJS.Timeout | null = null;
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        if (idle) clearTimeout(idle);
        clearTimeout(hard);
        conn.onData = null;
        conn.onGone = null;
        resolve(buffer.trim());
      };
      // A command that never answers is not an error: many opcodes do not.
      const hard = setTimeout(finish, timeoutMs);
      const armIdle = (): void => {
        if (idle) clearTimeout(idle);
        idle = setTimeout(finish, idleMs);
      };
      conn.onData = (chunk) => {
        buffer += chunk.toString('utf8');
        if (terminator !== '\n\n' && buffer.endsWith(terminator)) { finish(); return; }
        if (terminator === '\n\n' && buffer.includes('\n\n')) { finish(); return; }
        armIdle();
      };
      conn.onGone = finish;
      conn.socket.write(Buffer.concat([Buffer.from([0x02, opcode]), Buffer.from(args, 'utf8')]));
      armIdle();
    }));
  }

  /** Close the kept connection (the bridge is stopping). */
  close(): void {
    this.#conn?.socket.destroy();
    this.#conn = null;
  }
}
