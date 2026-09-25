import { audit } from './audit.js';
import { AI_BY_KEY } from './ai-species.js';
import { ConflictError, ValidationError } from './garage.js';
import { leftVars, renderMessage } from './messages.js';
import type { DropResult } from './ai-drop.js';

/**
 * "Làm mới AI" from the admin panel: warn players, have the AIZones mod kill
 * the AI (all, or the chosen kinds), clear the corpses with the game's own
 * RCON WipeCorpses, and say it is done. The game and the zones then spawn
 * new ones.
 *
 * The mod kills; it never destroys (a Lua K2_DestroyActor on an actor the
 * game already removed crashes the server — docs/lua-safety-rules.md, and the
 * AIZones header). One reset at a time; the countdown can be cancelled.
 */

export type ResetStep = 'countdown' | 'killing' | 'wiping' | 'done' | 'failed' | 'cancelled';

export interface ResetOp {
  id: number;
  step: ResetStep;
  /** Species keys (ai-species.ts); empty = every AI. */
  species: string[];
  countdownSec: number;
  wipeCorpses: boolean;
  startedAt: number;
  runAt: number;
  killed?: number;
  message?: string;
  finishedAt?: number;
}

interface RconLike {
  readonly enabled: boolean;
  run(name: string, args?: unknown): Promise<string>;
}

export interface AiResetDeps {
  rcon: RconLike;
  /** Queue the mod's reset command; resolves with its id. */
  enqueue: (classes: string[]) => Promise<{ id: number }>;
  result: (id: number) => Promise<DropResult | null>;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** How long to wait for the mod to report (it may take ~30 s to kill a crowd). */
  answerTimeoutMs?: number;
  pollMs?: number;
  settleMs?: number;
}

export interface ResetRequest { countdownSec: number; species: string[]; wipeCorpses: boolean }

export function validateReset(raw: unknown): ResetRequest {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('body must be an object');
  const r = raw as Record<string, unknown>;
  const countdownSec = r['countdownSec'];
  if (typeof countdownSec !== 'number' || !Number.isInteger(countdownSec) || countdownSec < 0 || countdownSec > 600) {
    throw new ValidationError('countdownSec must be a whole number 0–600');
  }
  const species = r['species'] ?? [];
  if (!Array.isArray(species) || species.length > 40) throw new ValidationError('species must be a list');
  for (const s of species) if (typeof s !== 'string' || !AI_BY_KEY.has(s)) throw new ValidationError(`unknown AI "${String(s)}"`);
  return { countdownSec, species: [...new Set(species as string[])], wipeCorpses: r['wipeCorpses'] !== false };
}

function realSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('cancelled'));
    const t = setTimeout(resolve, Math.max(0, ms));
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('cancelled')); }, { once: true });
  });
}

const detailOf = (op: ResetOp): string =>
  `${op.species.length ? op.species.join(', ') : 'mọi AI'} · đếm ngược ${op.countdownSec} s${op.wipeCorpses ? ' · dọn xác' : ''}`;

export class AiReset {
  readonly #d: Required<AiResetDeps>;
  #current: ResetOp | null = null;
  #last: ResetOp | null = null;
  #abort: AbortController | null = null;
  #nextId = 1;

  constructor(deps: AiResetDeps) {
    this.#d = { now: () => Date.now(), sleep: realSleep, answerTimeoutMs: 90_000, pollMs: 2000, settleMs: 5000, ...deps };
  }

  status(): { current: ResetOp | null; last: ResetOp | null } {
    return { current: this.#current, last: this.#last };
  }

  /** Start a reset; the returned promise is the whole run (for tests). */
  request(req: ResetRequest): { op: ResetOp; done: Promise<void> } {
    if (this.#current) throw new ConflictError('an AI reset is already running');
    const now = this.#d.now();
    const op: ResetOp = {
      id: this.#nextId++, step: 'countdown', species: req.species, countdownSec: req.countdownSec,
      wipeCorpses: req.wipeCorpses, startedAt: now, runAt: now + req.countdownSec * 1000,
    };
    this.#current = op;
    this.#abort = new AbortController();
    return { op, done: this.#run(op, this.#abort.signal) };
  }

  /** Cancel during the countdown (after it, the mod is already killing). */
  cancel(): boolean {
    if (!this.#current || this.#current.step !== 'countdown') return false;
    this.#abort?.abort();
    return true;
  }

  async #announce(text: string | null): Promise<void> {
    if (text === null || !this.#d.rcon.enabled) return;
    try {
      await this.#d.rcon.run('announce', text);
    } catch (error) {
      console.warn('[ai-reset] announce failed:', (error as Error).message);
    }
  }

  async #run(op: ResetOp, signal: AbortSignal): Promise<void> {
    const { sleep, now } = this.#d;
    try {
      if (op.countdownSec > 0) {
        await this.#announce(renderMessage('ai.reset.warning', leftVars(op.countdownSec)));
        // Once more 10 s before, when there is time for it.
        if (op.countdownSec > 15) {
          await sleep(op.runAt - 10_000 - now(), signal);
          await this.#announce(renderMessage('ai.reset.warning', leftVars(10)));
        }
        await sleep(op.runAt - now(), signal);
      }

      op.step = 'killing';
      const classes = op.species.map((k) => AI_BY_KEY.get(k)?.cls).filter((c): c is string => typeof c === 'string');
      const { id } = await this.#d.enqueue(classes);
      const deadline = now() + this.#d.answerTimeoutMs;
      let result: DropResult | null = null;
      while (result === null && now() < deadline) {
        await sleep(this.#d.pollMs, new AbortController().signal);
        result = await this.#d.result(id);
      }
      if (result === null) throw new Error('the AIZones mod did not answer — is it running (it needs a server restart after an update)?');
      if (!result.ok) throw new Error(`the mod refused: ${result.error ?? '?'}`);
      op.killed = result.made ?? 0;
      if (result.error) op.message = result.error;

      if (op.wipeCorpses && this.#d.rcon.enabled) {
        op.step = 'wiping';
        // Let the deaths finish (ragdoll, corpse) before clearing them.
        await sleep(this.#d.settleMs, new AbortController().signal);
        await this.#d.rcon.run('wipeCorpses');
      }
      await this.#announce(renderMessage('ai.reset.done', { count: op.killed }));
      op.step = 'done';
      await audit({ action: 'AI reset', detail: `${detailOf(op)} · ${op.killed} con`, ok: true, ...(op.message ? { error: op.message } : {}) });
    } catch (error) {
      if (signal.aborted) {
        op.step = 'cancelled';
        await this.#announce(renderMessage('ai.reset.cancelled'));
        await audit({ action: 'AI reset cancelled', detail: detailOf(op), ok: true });
      } else {
        op.step = 'failed';
        op.message = (error as Error).message;
        await audit({ action: 'AI reset', detail: detailOf(op), ok: false, error: op.message });
      }
    } finally {
      op.finishedAt = now();
      this.#last = op;
      this.#current = null;
      this.#abort = null;
    }
  }
}
