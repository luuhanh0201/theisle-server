import { connect } from 'node:net';
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

export class Rcon {
  #queue: Promise<unknown> = Promise.resolve();
  readonly #opts: Required<RconOptions>;

  constructor(opts: RconOptions) {
    this.#opts = { idleMs: 500, timeoutMs: 8000, ...opts };
  }

  get enabled(): boolean {
    return this.#opts.password !== '';
  }

  /** Run a named command from RCON_COMMANDS. */
  run(name: string, rawArgs?: unknown): Promise<string> {
    const cmd = RCON_COMMANDS[name];
    if (cmd === undefined) return Promise.reject(new ValidationError(`unknown RCON command: ${name}`));
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

  #session(opcode: number, args: string, terminator: string): Promise<string> {
    const { host, port, password, idleMs, timeoutMs } = this.#opts;
    return new Promise<string>((resolve, reject) => {
      const socket = connect({ host, port });
      let phase: 'auth' | 'command' = 'auth';
      let buffer = '';
      let idle: NodeJS.Timeout | null = null;
      let finished = false;

      const finish = (error: Error | null, value = ''): void => {
        if (finished) return;
        finished = true;
        if (idle) clearTimeout(idle);
        clearTimeout(hard);
        socket.destroy();
        if (error) reject(error);
        else resolve(value);
      };
      const hard = setTimeout(() => {
        // A command that never answers is not an error: many opcodes do not.
        if (phase === 'command') finish(null, buffer.trim());
        else finish(new RconError(`RCON did not answer the login within ${timeoutMs}ms`));
      }, timeoutMs);

      const sendCommand = (): void => {
        phase = 'command';
        buffer = '';
        socket.write(Buffer.concat([Buffer.from([0x02, opcode]), Buffer.from(args, 'utf8')]));
        armIdle();
      };
      const onAuthDone = (): void => {
        if (!/password accepted/i.test(buffer)) {
          finish(new RconError('RCON rejected the password'));
          return;
        }
        sendCommand();
      };
      const armIdle = (): void => {
        if (idle) clearTimeout(idle);
        idle = setTimeout(() => {
          if (phase === 'auth') onAuthDone();
          else finish(null, buffer.trim());
        }, idleMs);
      };

      socket.on('connect', () => {
        socket.write(Buffer.concat([Buffer.from([0x01]), Buffer.from(password, 'utf8')]));
        armIdle();
      });
      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        if (phase === 'auth') {
          if (/password accepted/i.test(buffer)) onAuthDone();
          else armIdle();
          return;
        }
        if (buffer.endsWith(terminator) && terminator !== '\n\n') {
          finish(null, buffer.trim());
          return;
        }
        if (terminator === '\n\n' && buffer.includes('\n\n')) {
          finish(null, buffer.trim());
          return;
        }
        armIdle();
      });
      socket.on('error', (error) => finish(new RconError(`RCON connection failed: ${error.message}`)));
      socket.on('close', () => {
        if (phase === 'auth') finish(new RconError('RCON closed the connection during login'));
        else finish(null, buffer.trim());
      });
    });
  }
}
