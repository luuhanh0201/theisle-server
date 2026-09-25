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

  async post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'x-portal-token': this.token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    return { status: res.status, body: await res.json() };
  }

  me(steamId: string) { return this.get(`/player-api/me/${steamId}`); }
  garage(steamId: string, body: { action: unknown; slot: unknown; where: unknown }) {
    return this.post(`/player-api/garage/${steamId}`, body);
  }
  command(steamId: string, id: number) { return this.get(`/player-api/command/${steamId}/${id}`); }
  leaderboard() { return this.get('/player-api/leaderboard'); }
  server() { return this.get('/player-api/server'); }
  ai() { return this.get('/player-api/ai'); }
  aiZones() { return this.get('/player-api/ai-zones'); }
  voice(steamId: string) { return this.get(`/player-api/voice/${steamId}`); }
  voiceToken(steamId: string) { return this.post(`/player-api/voice/${steamId}/token`, {}); }
  voiceRange(steamId: string, range: unknown) { return this.post(`/player-api/voice/${steamId}/range`, { range }); }
}
