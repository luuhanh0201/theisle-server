import type { DiscordView } from '@isle/api';

/** The Discord form: URLs and the relay's secret are typed new (never shown back), "" = keep. */
export interface DiscordDraft {
  enabled: boolean;
  routes: Record<string, string>;
  mentions: Record<string, string>;
  channels: Array<{ id: string; name: string; hint: string; url: string }>;
  relay: { url: string; secret: string; hasSecret: boolean };
  board: string | null;
}

export const draftOf = (d: DiscordView): DiscordDraft => ({
  enabled: d.enabled, routes: { ...d.routes }, mentions: { ...d.mentions },
  channels: d.channels.map((c) => ({ id: c.id, name: c.name, hint: c.hint, url: '' })),
  relay: { url: d.relay?.url ?? '', secret: '', hasSecret: d.relay?.hasSecret === true }, board: d.board ?? null,
});

/** The PUT's body: a URL / secret only when typed (the bridge keeps the saved one), no relay without a URL. */
export const bodyOf = (d: DiscordDraft): unknown => ({
  enabled: d.enabled, routes: d.routes, mentions: d.mentions,
  channels: d.channels.map((c) => ({ id: c.id, name: c.name, ...(c.url ? { url: c.url } : {}) })),
  relay: d.relay.url ? { url: d.relay.url, ...(d.relay.secret ? { secret: d.relay.secret } : {}) } : null,
  board: d.board,
});

export const newId = (): string => Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, '') || `c${Date.now().toString(36)}`;

/** A channel gone: so are the routes and the board that pointed at it. */
export function withoutChannel(d: DiscordDraft, id: string): DiscordDraft {
  return {
    ...d, channels: d.channels.filter((c) => c.id !== id),
    routes: Object.fromEntries(Object.entries(d.routes).filter(([, v]) => v !== id)),
    board: d.board === id ? null : d.board,
  };
}
