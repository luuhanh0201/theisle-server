import { open, stat } from 'node:fs/promises';
import { parseEvent, type GameEvent } from './events.js';

/**
 * Follows an append-only NDJSON file.
 *
 * Handles the three things that actually happen in production:
 *   - the file does not exist yet (the server has not started, or no events)
 *   - StatsLogger rotated it at 50 MB, replacing it with a fresh file
 *   - the file was truncated in place
 *
 * Rotation is detected by INODE, not by size. A rotated file usually starts
 * smaller, but not always — if the replacement happens to be the same size as
 * our offset, a size check sees nothing and we silently skip every new event.
 * The inode changes on rename-and-recreate, so that is what we key on, with
 * the size check kept as the fallback for truncation in place.
 *
 * A torn final line (we read while the game was mid-write) is held back and
 * prepended to the next read rather than dropped.
 */
export class NdjsonTail {
  #offset = 0;
  #partial = '';
  #inode: number | null = null;
  #warnedMissing = false;

  constructor(
    private readonly path: string,
    private readonly onEvent: (event: GameEvent) => void,
  ) {}

  /** Read whatever has been appended since the last call. */
  async poll(): Promise<void> {
    let size: number;
    let inode: number;
    try {
      const st = await stat(this.path);
      size = st.size;
      inode = st.ino;
    } catch {
      if (!this.#warnedMissing) {
        this.#warnedMissing = true;
        console.warn(`[tail] ${this.path} does not exist yet — waiting for it`);
      }
      return;
    }
    this.#warnedMissing = false;

    if (this.#inode !== null && inode !== this.#inode) {
      console.info('[tail] inode changed — file was rotated, restarting from 0');
      this.#reset();
    } else if (size < this.#offset) {
      console.info('[tail] file shrank — truncated in place, restarting from 0');
      this.#reset();
    }
    this.#inode = inode;

    if (size === this.#offset) return;

    const handle = await open(this.path, 'r');
    try {
      const length = size - this.#offset;
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, this.#offset);
      this.#offset += bytesRead;
      this.#consume(buffer.subarray(0, bytesRead).toString('utf8'));
    } finally {
      await handle.close();
    }
  }

  #reset(): void {
    this.#offset = 0;
    this.#partial = '';
  }

  #consume(chunk: string): void {
    const text = this.#partial + chunk;
    const lines = text.split('\n');
    // The last element is either '' (chunk ended on a newline) or a torn line.
    this.#partial = lines.pop() ?? '';

    for (const line of lines) {
      if (line.trim() === '') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        console.warn(`[tail] dropping unparseable line: ${line.slice(0, 120)}`);
        continue;
      }
      const event = parseEvent(parsed);
      if (event === null) {
        console.warn(`[tail] dropping unrecognised event: ${line.slice(0, 120)}`);
        continue;
      }
      this.onEvent(event);
    }
  }
}
