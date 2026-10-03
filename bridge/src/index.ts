import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SkinRelog } from './skin-relog.js';
import { queueAdminAction, queueSkinRepaint } from './commands.js';
import { keptSkinsOf } from './kept-skins.js';
import { config } from './config.js';
import { readGrowthApplied, startNotice } from './growth-events.js';
import { RelogShare } from './relog-share.js';
import { hiddenChat } from './deletions.js';
import { NdjsonTail } from './tail.js';
import { Store } from './store.js';
import { startServer } from './server.js';
import { Rcon } from './rcon.js';
import { Power, scheduleTick, readSchedule, occurrences } from './power.js';
import { StatusBoard, boardEmbed, boardPath, firedAt, SCHEDULED_START_WINDOW } from './discord-board.js';
import { writeFile as writeFileAsync } from 'node:fs/promises';
import { createDataBackup, defaultRoots, prune, readBackupSettings } from './backup.js';
import { systemdService } from './service.js';
import { Notifier } from './notify.js';
import { Metrics } from './metrics.js';
import { readLiveState } from './live.js';
import { readFlora } from './flora.js';
import { addPrimeFix } from './prime-fixes.js';
import { ZoneCredit, taskZones } from './zone-credit.js';
import { readMapZones } from './zone-guard.js';
import { PrimeNotifier } from './prime-notify.js';
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
import { alertWebhookOf, sendHeartbeat } from './relay.js';
import { readLive } from './gameini.js';
import { DdosWatch, SAMPLE_S, defaultIface, endText, parseNetDev, readDdos, startText } from './ddos.js';
import { readFile } from 'node:fs/promises';
import { renderMessage } from './messages.js';
import { auditListeners } from './audit.js';
import { Prison } from './prison.js';
import { KillScenes } from './kill-scene.js';
import { GameAdminLog } from './game-admin-log.js';
import { settleUse } from './items.js';
import { syncAdminGuard } from './permissions.js';
import { bagUnlimited, publicServerInfo, shortSpecies } from './player-api.js';
import { adminIds } from './panel-auth.js';

const store = new Store();
// Admins count for nothing on the players' side (kills, deaths, boards: store.ts):
// known before the event files are read back, kept up to date after.
store.setAdmins(await adminIds());
setInterval(() => { adminIds().then((ids) => store.setAdmins(ids)).catch(() => undefined); }, 60_000);
const rcon = new Rcon(config.rcon);
const power = new Power({
  service: systemdService(),
  rcon,
  modsLoadedAt: () => store.modsLoadedAt(),
  // The daily restart: a data backup while the game is down (backup.ts).
  pause: {
    wanted: async (op) => op.source === 'schedule' && (await readBackupSettings()).atScheduledRestart,
    run: async () => {
      const roots = defaultRoots();
      const b = await createDataBackup(roots, 'scheduled');
      await prune(roots, (await readBackupSettings()).keep);
      console.info(`[backup] ${b.name} (${b.size} bytes)`);
    },
  },
});
// The admin log keeps 7 days: drop what is older now (then hourly, on write).
await pruneAudit().catch((error: unknown) => console.error('[audit] prune failed:', error));

// The AIZones mod writes its status next to zones.json; Lua cannot create
// the directory, so it has to exist before the first zones are saved.
await mkdir(config.aiZonesRoot, { recursive: true }).catch((error: unknown) => console.error('[ai-zones] cannot create', config.aiZonesRoot, error));
// Flora writes its export there, and Lua cannot create a directory either.
await mkdir(config.floraRoot, { recursive: true }).catch((error: unknown) => console.error('[flora] cannot create', config.floraRoot, error));
await mkdir(config.fishRoot, { recursive: true }).catch((error: unknown) => console.error('[fish] cannot create', config.fishRoot, error));
// The Prison mod writes its state next to prison.json (Lua cannot create the directory).
await mkdir(config.prisonRoot, { recursive: true }).catch((error: unknown) => console.error('[prison] cannot create', config.prisonRoot, error));

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
// "Completed: <task>" to the player, for each prime task that turns on (prime-notify.ts).
const primeNotifier = new PrimeNotifier(rcon, Math.floor(Date.now() / 1000), (key, vars) => renderMessage(key, vars));
// A dino's colours painted again when the player comes back on it (skin-relog.ts).
const relogShare = new RelogShare(Math.floor(Date.now() / 1000));
// Chat lines the super admin deleted: left out of every view (deletions.ts).
await hiddenChat();
const skinRelog = new SkinRelog(Math.floor(Date.now() / 1000),
  (steamId, skin) => queueSkinRepaint(steamId, skin),
  async (steamId, species) => (await keptSkinsOf(steamId))[species] !== undefined);
// The prison (prison.ts): sentences, escapes, hunters; the Prison mod carries them out.
// The Discord log is created further down: posts wait for it (lines before a start are not sent anyway).
const prisonDiscord: { post: ((text: string) => void) | null } = { post: null };
const prison = new Prison({
  announce: (text) => (rcon.enabled ? rcon.run('announce', text) : Promise.resolve()),
  directMessage: (steamId, text) => (rcon.enabled ? rcon.directMessage(steamId, text) : Promise.resolve()),
  discord: (text) => prisonDiscord.post?.(text),
  render: (key, vars) => renderMessage(key, vars),
  nameOf: (steamId) => store.player(steamId)?.player.name ?? null,
  // "BP_Triceratops_C" → "Triceratops": what players read in the announcements and on the map.
  speciesOf: (steamId) => shortSpecies(store.player(steamId)?.player.species ?? null),
  isOnline: (steamId) => store.online().some((p) => p.steamId === steamId),
  adminIds: () => adminIds(),
  groundPoints: store.groundPoints,
  startedAt: Math.floor(Date.now() / 1000),
});
await prison.load();
// Where a death happened, who stood near, the fight it ended (panel → log → 📍; kill-scene.ts).
const killScenes = new KillScenes(join(config.dataDir, 'kill-scenes.ndjson'), Math.floor(Date.now() / 1000));
await killScenes.load();
await prison.syncModFiles().catch((error: unknown) => console.error('[prison] cannot write the mod files:', error));
const tails = [config.eventsPath, config.snapshotsPath].map(
  (path) => new NdjsonTail(path, (event) => {
    store.apply(event);
    void notifier.handle(event);
    void primeNotifier.handle(event);
    void skinRelog.handle(event);
    prison.handle(event).catch((error: unknown) => console.error('[prison] event failed:', error));
    killScenes.handle(event).catch((error: unknown) => console.error('[kill-scene] event failed:', error));
    // A mutation item the mod put on a dino: used up (items.ts).
    settleUse(event, bagUnlimited).catch((error: unknown) => console.error('[items] settle failed:', error));
    // Max health jumped at a relog (a prime the mod set): the same share of health and blood as when they left.
    const keep = relogShare.onEvent(event);
    if (keep !== null) {
      queueAdminAction(keep.steamId, { action: 'vitals', values: { health: keep.health, blood: keep.blood } })
        .then(() => console.info(`[relog-share] ${keep.steamId}: max health ${keep.maxBefore} -> ${keep.maxNow}, kept health ${keep.health}, blood ${keep.blood}`))
        .catch((error: unknown) => console.error('[relog-share] failed:', error));
    }
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
    fish: fresh && live.ai && !live.ai.stale ? live.ai.fish : null,
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
prisonDiscord.post = (text) => discord.post({ kind: 'prison', t: Math.floor(Date.now() / 1000), text });
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

// The status board on Discord (discord-board.ts): one message, edited every minute.
const statusBoard = new StatusBoard({ save: (v) => writeFileAsync(boardPath(), JSON.stringify(v), 'utf8') });
async function updateBoard(): Promise<void> {
  const s = discord.settings;
  const channel = s.enabled && s.board !== null ? s.channels.find((c) => c.id === s.board) : undefined;
  if (channel === undefined) return;
  const nowMs = Date.now();
  const [st, info, schedule] = await Promise.all([power.status(), readLive().then((l) => publicServerInfo(l.effective)), readSchedule()]);
  const next = occurrences(schedule, nowMs).find((d) => d.getTime() > nowMs);
  const started = store.modsLoadedAt();
  const fired = firedAt(schedule.lastFired);
  await statusBoard.update(channel.url, boardEmbed({
    name: info.name, phase: st.phase, online: store.online().length, maxPlayers: info.maxPlayers,
    next: next ? Math.floor(next.getTime() / 1000) : null,
    last: started === null ? null : { t: started, scheduled: fired !== null && started >= fired && started - fired <= SCHEDULED_START_WINDOW },
    now: Math.floor(nowMs / 1000),
  }), nowMs);
  if (statusBoard.lastError !== null) console.error('[discord-board]', statusBoard.lastError);
}
setInterval(() => { updateBoard().catch((error: unknown) => console.error('[discord-board] update failed:', error)); }, 60_000);

// DDoS watch (ddos.ts): the traffic into the VPS every SAMPLE_S; an attack and
// its end told on Discord (log kind "ddos"). The settings are re-read on save.
const ddos = { watch: new DdosWatch(), settings: await readDdos(), iface: process.env['NET_IFACE'] ?? null as string | null };
if (ddos.iface === null) ddos.iface = defaultIface(await readFile('/proc/net/route', 'utf8').catch(() => ''));
console.info(`[ddos] watching ${ddos.iface ?? '(no interface found)'}`);
setInterval(() => {
  if (ddos.iface === null) return;
  readFile('/proc/net/dev', 'utf8').then(async (text) => {
    const c = parseNetDev(text, ddos.iface as string);
    if (c === null) return;
    const online = store.online().length;
    for (const e of ddos.watch.feed(Math.floor(Date.now() / 1000), c, ddos.settings, online)) {
      if (e.kind === 'start') {
        const live = await readLiveState().catch(() => null);
        discord.post({ kind: 'ddos', t: e.now.t, text: startText(e, online, live && !live.stale ? live.fps : null) });
        console.warn(`[ddos] attack: ${e.now.pps} pkt/s, ${e.now.mbps} Mbit/s`);
        void heartbeat().catch(() => undefined);      // the relay learns it now, not in 2 minutes
      } else {
        discord.post({ kind: 'ddos', t: e.at, text: endText(e) });
        console.warn(`[ddos] ended, peak ${e.attack.peakPps} pkt/s`);
        void heartbeat().catch(() => undefined);
      }
    }
  }).catch((error: unknown) => console.error('[ddos] read failed:', error));
}, SAMPLE_S * 1000);

// The relay off the VPS (relay/): a heartbeat every 2 minutes (relay.ts).
async function heartbeat(): Promise<void> {
  const relay = discord.settings.relay;
  if (!relay) return;
  const [st, live, cfg] = await Promise.all([power.status(), readLiveState(), readLive().catch(() => null)]);
  const fresh = live !== null && !live.stale;
  const setting = (k: string): unknown => cfg?.settings[k] ?? cfg?.effective[k];
  const online = store.online();
  await sendHeartbeat(relay, {
    serverName: typeof setting('ServerName') === 'string' ? setting('ServerName') as string : 'Server',
    phase: st.phase,
    online: online.length,
    maxPlayers: typeof setting('MaxPlayerCount') === 'number' ? setting('MaxPlayerCount') as number : null,
    players: online.map((p) => p.name ?? p.steamId),
    fps: fresh ? live.fps : null,
    ai: fresh && live.ai && !live.ai.stale ? live.ai.count : null,
    alertWebhook: alertWebhookOf(discord.settings),
    attack: ddos.watch.attack ? { since: ddos.watch.attack.since, peakPps: ddos.watch.attack.peakPps, peakMbps: ddos.watch.attack.peakMbps } : null,
  }, discord.relayState);
}
setInterval(() => { heartbeat().catch((error: unknown) => console.error('[relay] heartbeat failed:', error)); }, 120_000);
setTimeout(() => { heartbeat().catch(() => undefined); }, 15_000);



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

// Admins switched off in game (panel → Phân quyền): the AdminGuard mod's list (permissions.ts).
const writeAdminGuard = async (): Promise<void> => {
  await syncAdminGuard(await adminIds()).catch((error: unknown) => console.error('[admin-guard] cannot write', config.adminGuardPath, error));
};
await writeAdminGuard();
// What admins do in the game (TheIsle.log) → the panel's admin log (game-admin-log.ts).
const gameAdminLog = new GameAdminLog();
await gameAdminLog.load();
setInterval(() => { gameAdminLog.poll().catch((error: unknown) => console.error('[game-admin-log] poll failed:', error)); }, 2000);

// Sự kiện tốc độ lớn (growth-events.ts): once the game is up after a start,
// the players hear the event that start applied (or the one that ended).
// A bridge restart does not say it again: the start it knew of is the current one.
let growthToldFor = store.modsLoadedAt();
setInterval(() => {
  const loaded = store.modsLoadedAt();
  if (loaded === null || loaded === growthToldFor) return;
  growthToldFor = loaded;
  const n = startNotice(readGrowthApplied(config.dataDir), loaded);
  const text = n === null ? null : renderMessage(n.key, n.vars);
  if (text !== null && rcon.enabled) {
    // A minute in: players joining right after the start hear it too.
    setTimeout(() => { rcon.run('announce', text).catch((error: unknown) => console.error('[growth] announce failed:', error)); }, 60_000);
  }
}, 10_000);

startServer({ store, power, rcon, metrics, aiReset, discord, bans, ddos, prison, killScenes, onAdminsChanged: writeAdminGuard, ...(voice ? { voice } : {}) });

// The prison: the mod's state, finished sentences, escape reminders, the mod's files (prison.ts).
setInterval(() => {
  prison.tick().catch((error: unknown) => console.error('[prison] tick failed:', error));
}, 5_000);

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

// The zone prime tasks (sanctuary, migration, patrol) for every species alike
// (zone-credit.ts): a dino a minute in the right zone that the game did not
// credit gets the task through a prime fix, applied by the DinoGarage mod.
const zoneCredit = new ZoneCredit();
const mapZones = { sanctuary: await readMapZones('sanctuary'), migration: await readMapZones('migration'), patrol: await readMapZones('patrol') };
console.info(`[zone-credit] map zones: ${mapZones.sanctuary.length} sanctuaries, ${mapZones.migration.length} migration, ${mapZones.patrol.length} patrol`);
async function zoneCreditTick(): Promise<void> {
  const [live, flora] = await Promise.all([readLiveState(), readFlora()]);
  if (live === null || live.stale || flora === null || flora.stale) return;
  const stats = new Map(store.online().map((p) => [p.steamId, p]));
  const players = live.players.flatMap((lp) => {
    const p = stats.get(lp.steamId);
    if (p === undefined) return [];
    return [{ steamId: lp.steamId, species: p.species ?? null, growth: lp.growth ?? p.growth ?? null,
      x: lp.loc.x, y: lp.loc.y, conditions: p.prime?.conditions ?? null }];
  });
  for (const fix of zoneCredit.tick(Math.floor(Date.now() / 1000), players, taskZones(flora.spawners, mapZones))) {
    const made = await addPrimeFix(fix);
    console.info(`[zone-credit] ${fix.steamId} (${fix.species}): ${fix.conditions} given — ${made.id}`);
  }
}
setInterval(() => {
  zoneCreditTick().catch((error: unknown) => console.error('[zone-credit] tick failed:', error));
}, 10_000);

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
