/** The bridge's read-only /player-api, with the portal's own token. */
export class BridgeClient {
  constructor(
    readonly baseUrl: string,
    readonly token: string,
    readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async get(path: string): Promise<{ status: number; body: unknown }> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { 'x-portal-token': this.token },
      signal: AbortSignal.timeout(5_000),
    });
    return { status: res.status, body: await res.json() };
  }

  me(steamId: string) { return this.get(`/player-api/me/${steamId}`); }
  leaderboard() { return this.get('/player-api/leaderboard'); }
  server() { return this.get('/player-api/server'); }
}
