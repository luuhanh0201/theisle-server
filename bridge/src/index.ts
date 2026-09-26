import { mkdir } from 'node:fs/promises';
import { config } from './config.js';
import { NdjsonTail } from './tail.js';
import { Store } from './store.js';
import { startServer } from './server.js';
import { Rcon } from './rcon.js';
import { Power, scheduleTick } from './power.js';
import { systemdService } from './service.js';
import { Notifier } from './notify.js';
import { Metrics } from './metrics.js';
import { readLiveState } from './live.js';
import { VoiceRoom } from './voice.js';
import { groundPointsPath, readAiZones, refreshModFile } from './ai-zones.js';
import { AI_BY_KEY } from './ai-species.js';
import { pruneAudit } from './audit.js';
import { loadMessages, syncModTexts } from './messages.js';
import { syncZoneGuard } from './zone-guard.js';
import { Announcer } from './announcer.js';
import { AiReset } from './ai-reset.js';
import { dropResult, enqueueAiCommand } from './ai-drop.js';
import { DiscordLog, auditLine, banLine, lineOf, phaseLine, plain } from './discord.js';
import { BanWatcher, banVars } from './bans.js';
import { renderMessage } from './messages.js';
import { auditListeners } from './audit.js';

const store = new Store();
const rcon = new Rcon(config.rcon);
const power = new Power({
  service: systemdService(),
  rcon,
  modsLoadedAt: () => store.modsLoadedAt(),
});
// The admin log keeps 7 days: drop what is older now (then hourly, on write).
await pruneAudit().catch((error: unknown) => console.error('[audit] prune failed:', error));

// The AIZones mod writes its status next to zones.json; Lua cannot create
// the directory, so it has to exist before the first zones are saved.
await mkdir(config.aiZonesRoot, { recursive: true }).catch((error: unknown) => console.error('[ai-zones] cannot create', config.aiZonesRoot, error));
// Flora writes its export there, and Lua cannot create a directory either.
await mkdir(config.floraRoot, { recursive: true }).catch((error: unknown) => console.error('[flora] cannot create', config.floraRoot, error));
await mkdir(config.fishRoot, { recursive: true }).catch((error: unknown) => console.error('[fish] cannot create', config.fishRoot, error));

// The players' texts and announcement timings set on the panel; the mods'
// file is rewritten so it matches them (a fresh server has none).
await loadMessages();
await syncModTexts().catch((error: unknown) => console.error('[messages] cannot write', config.messagesModPath, error));
// The ZoneGuard mod's file, from what the panel saved (a redeploy does not touch it).
await syncZoneGuard().catch((error: unknown) => console.error('[zone-guard] cannot write', config.zoneGuardRoot, error));

// Ground points gathered before (AI positions are only ever seen live).
await store.groundPoints.load(groundPointsPath());

// Events first: on a replay at startup, sessions and deaths should be known
// before the snapshots that fill in the current state.
const notifier = new Notifier(rcon, Math.floor(Date.now() / 1000));
const tails = [config.eventsPath, config.snapshotsPath].map(
  (path) => new NdjsonTail(path, (event) => {
    store.apply(event);
    void notifier.handle(event);
  }),
);

// Performance history (panel → Server → Hiệu năng): ServerFPS and players
// from the live file, CPU / RAM from /proc, every 10 s.
const metrics = new Metrics(config.dataDir, async () => {
  const live = await readLiveState();
  const fresh = live !== null && !live.stale;
  // Where the AI stands now is ground the AI zones may spawn on (not a fish: it is under water).
  if (fresh && live.ai && !live.ai.stale) for (const a of live.ai.list) if (!a.f) store.groundPoints.add(a.x, a.y, a.z, a.c);
  return {
    online: store.online().length,
    fps: fresh ? live.fps : null,
    ai: fresh && live.ai && !live.ai.stale ? live.ai.count : null,
  };
});
metrics.start();

// Proximity voice: who is in the LiveKit room (voice.ts). Off without LIVEKIT_* keys.
const voice = config.voice === null ? null : new VoiceRoom(config.voice);

// "Làm mới AI": the AIZones mod kills, the game clears the corpses (ai-reset.ts).
const aiReset = new AiReset({
  rcon,
  enqueue: (classes, keep) => enqueueAiCommand((id) => {
    const now = Math.floor(Date.now() / 1000);
    return { id, kind: 'reset', classes, keep, createdAt: now, expiresAt: now + 30 };
  }),
  zoneClasses: async () => {
    const s = await readAiZones();
    const keys = new Set(s.zones.filter((z) => z.enabled).flatMap((z) => z.species));
    return [...keys].map((k) => AI_BY_KEY.get(k)?.cls).filter((c): c is string => typeof c === 'string');
  },
  result: dropResult,
});

// The log on Discord (panel → Quản trị → Discord): feed entries, admin actions,
// announcements and the server's state, sent out by webhook (discord.ts).
const discord = new DiscordLog({ startedAt: Math.floor(Date.now() / 1000) });
await discord.load();
store.onFeed = (entry) => discord.post(lineOf(entry));
auditListeners.push((entry) => discord.post(auditLine(entry)));
rcon.onRun = (name, args) => {
  if (name === 'announce' && typeof args === 'string') discord.post({ kind: 'announce', t: Math.floor(Date.now() / 1000), text: `📢 ${args}` });
};
let lastPhase: string | null = null;
let plannedUntil = 0;
setInterval(() => {
  void power.status().then((st) => {
    const now = Date.now();
    // A stop or restart the panel / schedule is doing (and a minute after) is not a crash.
    if (power.current !== null) plannedUntil = now + 60_000;
    discord.post(phaseLine(lastPhase, st.phase, Math.floor(now / 1000), now < plannedUntil));
    if (st.phase !== 'unknown') lastPhase = st.phase;
  }).catch(() => undefined);
}, 10_000);
setInterval(() => {
  discord.tick().catch((error: unknown) => console.error('[discord] send failed:', error));
}, 2_000);



// Every new ban in the game's list (panel or the game's own admin panel): told
// to the server and logged on Discord (bans.ts).
const bans = new BanWatcher((b) => {
  const vars = banVars(b);
  const text = renderMessage('ban.announce', vars);
  if (text !== null && rcon.enabled) rcon.run('announce', text).catch((error: unknown) => console.error('[bans] announce failed:', error));
  discord.post(banLine(b, vars));
  console.info(`[bans] ${b.name} (${b.steamId}) banned by ${b.by}: ${b.reason}`);
});
// A banned player who is in the game anyway (the game let them back in — e.g.
// an account in AdminsSteamIDs, 2026-09-26) is told why and kicked, every
// time, at most once in 30 s each.
const kickedAt = new Map<string, number>();
async function enforceBans(): Promise<void> {
  if (!rcon.enabled) return;
  const active = bans.active();
  const now = Date.now();
  for (const p of store.online()) {
    const b = active.get(p.steamId);
    if (!b || now - (kickedAt.get(p.steamId) ?? 0) < 30_000) continue;
    kickedAt.set(p.steamId, now);
    const vars = banVars(b);
    const text = renderMessage('ban.player', vars);
    if (text !== null) await rcon.directMessage(p.steamId, text).catch(() => undefined);
    setTimeout(() => { rcon.exec(0x30, p.steamId).catch((error: unknown) => console.error('[bans] kick failed:', error)); }, 2500);
    discord.post({ kind: 'ban', t: Math.floor(now / 1000), text: `🚫 **${plain(b.name)}** \`${b.steamId}\` đang bị ban (${plain(vars['duration'] ?? '')}, hết ${plain(vars['until'] ?? '')}) mà vẫn vào server — đã kick.` });
    console.info(`[bans] ${b.name} (${b.steamId}) is banned but online: kicked`);
  }
}
setInterval(() => {
  bans.tick().then(enforceBans).catch((error: unknown) => console.error('[bans] read failed:', error));
}, 10_000);
void bans.tick();

startServer({ store, power, rcon, metrics, aiReset, discord, bans, ...(voice ? { voice } : {}) });

// AI zones: keep the ground points on disk and hand the mod the points found
// since (a zone drawn where nobody had been yet gets spots as people go there).
setInterval(() => {
  store.groundPoints.save(groundPointsPath())
    .then(() => refreshModFile(store.groundPoints))
    .catch((error: unknown) => console.error('[ai-zones] refresh failed:', error));
}, 10 * 60_000);

// Periodic announcements and the corpse wipe (tab Thông báo).
const announcer = new Announcer({ rcon, online: () => store.online().length });
setInterval(() => {
  announcer.tick().catch((error: unknown) => console.error('[announcer] tick failed:', error));
}, 5_000);

// Daily restart schedule: check often enough that the countdown starts on time.
setInterval(() => {
  scheduleTick(power).catch((error: unknown) => console.error('[power] schedule tick failed:', error));
}, 15_000);

console.info(
  `[bridge] tailing ${config.eventsPath} and ${config.snapshotsPath} every ${config.pollMs}ms`,
);

let stopping = false;

async function loop(): Promise<void> {
  while (!stopping) {
    for (const tail of tails) {
      try {
        await tail.poll();
      } catch (error) {
        // A read failure must never end the loop — the game may be mid-rotation.
        console.error('[bridge] poll failed:', error);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollMs));
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.info(`[bridge] ${signal} — shutting down`);
    stopping = true;
    process.exit(0);
  });
}

void loop();
