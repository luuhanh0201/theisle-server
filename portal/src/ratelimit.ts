/** Fixed-window request counter per key (client IP). Enough to blunt floods. */
export class RateLimit {
  readonly #hits = new Map<string, { windowStart: number; count: number }>();
  constructor(readonly limit: number, readonly windowMs: number) {}

  allow(key: string, now = Date.now()): boolean {
    const h = this.#hits.get(key);
    if (h === undefined || now - h.windowStart >= this.windowMs) {
      this.#hits.set(key, { windowStart: now, count: 1 });
      if (this.#hits.size > 50_000) this.#prune(now);
      return true;
    }
    h.count += 1;
    return h.count <= this.limit;
  }

  #prune(now: number): void {
    for (const [k, h] of this.#hits) if (now - h.windowStart >= this.windowMs) this.#hits.delete(k);
  }
}
