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
  /** A traffic event for the panel's "Truy cập" (bridge traffic.ts). */
  track(event: Record<string, unknown>) { return this.post('/player-api/track', event); }
  garage(steamId: string, body: { action: unknown; slot: unknown; where: unknown }) {
    return this.post(`/player-api/garage/${steamId}`, body);
  }
  skin(steamId: string, body: { colors: unknown; effects: unknown; pattern: unknown; theme: unknown; variation: unknown; keep: unknown; forget: unknown; item: unknown }) {
    return this.post(`/player-api/skin/${steamId}`, body);
  }
  useItem(steamId: string, body: { uid: unknown; slot: unknown; upgrade: unknown; mutation: unknown }) {
    return this.post(`/player-api/items/${steamId}/use`, body);
  }
  previewItem(steamId: string, uid: string) { return this.get(`/player-api/items/${steamId}/preview/${encodeURIComponent(uid)}`); }
  command(steamId: string, id: number) { return this.get(`/player-api/command/${steamId}/${id}`); }
  leaderboard() { return this.get('/player-api/leaderboard'); }
  /** Tin cập nhật (bridge news.ts): the newest notes the panel shows. */
  news() { return this.get('/player-api/news'); }
  server() { return this.get('/player-api/server'); }
  ai() { return this.get('/player-api/ai'); }
  aiZones() { return this.get('/player-api/ai-zones'); }
  heatmap() { return this.get('/player-api/heatmap'); }
  /** The daily check-in (bridge economy.ts). */
  checkin(steamId: string) { return this.post(`/player-api/checkin/${steamId}`, {}); }
  /** The Hổ phách shop (bridge shop.ts): what is on sale, and a buy. */
  shop(steamId: string) { return this.get(`/player-api/shop/${steamId}`); }
  shopBuy(steamId: string, body: { listing: unknown; qty: unknown }) { return this.post(`/player-api/shop/${steamId}/buy`, body); }
  /** The starter gift (bridge starter.ts): taken on the home page, the ticket into the bag. */
  claimStarter(steamId: string) { return this.post(`/player-api/starter/${steamId}/claim`, {}); }
  /** A quest's reward (bridge quests.ts). */
  claimQuest(steamId: string, quest: unknown) { return this.post(`/player-api/quests/${steamId}/claim`, { quest }); }
  /** The dino boxes (bridge dino-box.ts): what a box / a dino item offers; a box opened; a dino item used. */
  itemOptions(steamId: string, kind: 'box' | 'dino', uid: string) { return this.get(`/player-api/items/${steamId}/${kind}-options/${encodeURIComponent(uid)}`); }
  openBox(steamId: string, body: { uid: unknown; species: unknown }) { return this.post(`/player-api/items/${steamId}/open`, body); }
  /** A hòm (bridge loot.ts): its prizes and chances; opened. */
  lootOptions(steamId: string, uid: string) { return this.get(`/player-api/items/${steamId}/loot-options/${encodeURIComponent(uid)}`); }
  openLoot(steamId: string, body: { uid: unknown }) { return this.post(`/player-api/items/${steamId}/loot`, body); }
  useDino(steamId: string, body: { uid: unknown; female: unknown; mutations: unknown }) {
    return this.post(`/player-api/items/${steamId}/dino`, body);
  }
  voice(steamId: string) { return this.get(`/player-api/voice/${steamId}`); }
  voiceToken(steamId: string) { return this.post(`/player-api/voice/${steamId}/token`, {}); }
  voiceRange(steamId: string, range: unknown) { return this.post(`/player-api/voice/${steamId}/range`, { range }); }
  /** Tele con non (bridge tele.ts): { action: code | use | drop, code? }. */
  tele(steamId: string, body: { action: unknown; code: unknown }) { return this.post(`/player-api/tele/${steamId}`, body); }
  /** Kết bạn (bridge friends.ts): the list with where each friend is; a search or a change. */
  friends(steamId: string) { return this.get(`/player-api/friends/${steamId}`); }
  friendsAction(steamId: string, body: { action: unknown; q?: unknown; ref?: unknown }) { return this.post(`/player-api/friends/${steamId}`, body); }
}
