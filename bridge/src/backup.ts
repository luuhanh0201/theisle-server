import { execFile } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { hostname } from 'node:os';
import { promisify } from 'node:util';
import { config } from './config.js';
import { ValidationError } from './garage.js';

/**
 * Backups, a fresh start, and moving to another VPS (panel → Server → Dữ liệu).
 *
 *   data backup      the players' data: their dinos (the game's save,
 *                    TheIslePersistence.db and its -wal/-shm/.counter), the
 *                    garage (DinoGarage/Saved), the stats (StatsLogger/Saved:
 *                    killfeed, leaderboards, history) and the bans
 *                    (PlayerBans.json). Kept on the VPS (the newest `keep`),
 *                    downloadable; made by hand, before a wipe or a restore,
 *                    and at each scheduled restart WHILE THE GAME IS STOPPED
 *                    (the save is a live SQLite database: a copy taken while it
 *                    runs is retried until nothing changed during it)
 *   settings export  what a new VPS needs besides the data: the panel's and
 *                    the mods' settings, Game.ini / Engine.ini and the .env
 *                    files — secrets, so the file is for the owner only
 *   wipe             deletes the chosen parts (a data backup first, always),
 *                    game stopped; the garage's own settings are kept
 *   restore          a data backup and / or a settings export back in place
 *                    (a data backup of what is there first), game stopped
 *
 * Archives are .tar.gz (the system's tar) with a manifest.json; every file is
 * stored under files/<part>/<its path relative to the part's root>.
 */

const run = promisify(execFile);

export type DataPart = 'dinos' | 'garage' | 'stats' | 'bans';
export const DATA_PARTS: ReadonlyArray<{ key: DataPart; label: string }> = [
  { key: 'dinos', label: 'Dino người chơi (save game)' },
  { key: 'garage', label: 'Gara (dino đã cất)' },
  { key: 'stats', label: 'Thống kê (killfeed, xếp hạng, lịch sử)' },
  { key: 'bans', label: 'Danh sách ban' },
];

export interface Roots {
  playerData: string;
  garage: string;
  stats: string;
  bridgeData: string;
  backups: string;
  /** Settings files by a stable name → where they live on this VPS. */
  settings: Record<string, string>;
}

export function defaultRoots(): Roots {
  const mods = join(config.garageRoot, '..', '..');
  const saved = join(config.game.configDir, '..', '..');
  return {
    playerData: join(saved, 'PlayerData'),
    garage: config.garageRoot,
    stats: dirname(config.eventsPath),
    bridgeData: config.dataDir,
    backups: process.env['BACKUP_DIR'] ?? join(config.dataDir, '..', '..', 'backups', 'panel'),
    settings: {
      'game/Game.ini': join(config.game.configDir, 'Game.ini'),
      'game/Engine.ini': join(config.game.configDir, 'Engine.ini'),
      'env/bridge.env': join(config.dataDir, '..', '.env'),
      'env/livekit.env': join(config.dataDir, '..', 'livekit.env'),
      'env/portal.env': '/opt/isle-portal/.env',
      'mods/PteraCarry.json': join(mods, 'PteraCarry', 'Saved', 'settings.json'),
      'mods/Flora.json': join(mods, 'Flora', 'Saved', 'settings.json'),
      'mods/FishControl.json': join(mods, 'FishControl', 'Saved', 'settings.json'),
      'mods/PlayerCommands.json': join(mods, 'PlayerCommands', 'Saved', 'settings.json'),
      'mods/garage-settings.json': join(config.garageRoot, 'garage-settings.json'),
      ...Object.fromEntries(['ai-zones', 'messages', 'discord', 'game-settings', 'panel-access', 'power-schedule', 'voice-settings',
        'zone-guard', 'ban-reasons', 'ddos', 'backup-settings', 'ground-points']
        .map((n) => [`bridge/${n}.json`, join(config.dataDir, `${n}.json`)])),
    },
  };
}

/** The files of a part, relative to its root (and that root). */
async function partFiles(r: Roots, part: DataPart): Promise<{ root: string; files: string[] }> {
  const exists = async (p: string): Promise<boolean> => stat(p).then(() => true, () => false);
  const walk = async (root: string, rel = ''): Promise<string[]> => {
    const out: string[] = [];
    let entries;
    try { entries = await readdir(join(root, rel), { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...await walk(root, p));
      else if (e.isFile() && !e.name.endsWith('.tmp')) out.push(p);
    }
    return out;
  };
  switch (part) {
    case 'dinos': {
      const names = ['TheIslePersistence.db', 'TheIslePersistence.db-wal', 'TheIslePersistence.db-shm', 'TheIslePersistence.counter'];
      const files: string[] = [];
      for (const n of names) if (await exists(join(r.playerData, n))) files.push(n);
      return { root: r.playerData, files };
    }
    case 'bans':
      return { root: r.playerData, files: (await exists(join(r.playerData, 'PlayerBans.json'))) ? ['PlayerBans.json'] : [] };
    case 'garage':
      return { root: r.garage, files: await walk(r.garage) };
    case 'stats':
      return { root: r.stats, files: await walk(r.stats) };
  }
}

export interface BackupInfo { name: string; kind: 'data' | 'settings'; size: number; createdAt: number; reason: string; parts: string[] }
interface Manifest { version: 1; kind: 'data' | 'settings'; createdAt: number; host: string; reason: string; parts: string[]; files: Array<{ part: string; rel: string }> }

/** A scratch folder next to the backups (same disk: the archive is renamed into place). */
async function stageDir(r: Roots): Promise<string> {
  await mkdir(r.backups, { recursive: true, mode: 0o700 });
  return mkdtemp(join(r.backups, '..', '.stage-'));
}

const NAME_RE = /^(data|settings)-\d{8}-\d{6}(?:-[a-z0-9-]{1,40})?\.tar\.gz$/;
const stamp = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/** Copy the game's save so that no file changed while it was copied (retried). */
async function copyStable(src: string, dst: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const a = await stat(src);
    await copyFile(src, dst);
    const b = await stat(src);
    if (a.mtimeMs === b.mtimeMs && a.size === b.size) return;
  }
  await copyFile(src, dst);
}

async function pack(r: Roots, manifest: Manifest, stage: string, name: string): Promise<BackupInfo> {
  await writeFile(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  await mkdir(r.backups, { recursive: true, mode: 0o700 });
  const out = join(r.backups, name);
  const tmp = `${out}.tmp`;
  await run('tar', ['-czf', tmp, '-C', stage, '.']);
  await rename(tmp, out);
  const s = await stat(out);
  return { name, kind: manifest.kind, size: s.size, createdAt: manifest.createdAt, reason: manifest.reason, parts: manifest.parts };
}

export async function createDataBackup(r: Roots, reason: string, parts: readonly DataPart[] = DATA_PARTS.map((p) => p.key)): Promise<BackupInfo> {
  const stage = await stageDir(r);
  try {
    const files: Manifest['files'] = [];
    for (const part of parts) {
      const { root, files: list } = await partFiles(r, part);
      for (const rel of list) {
        const dst = join(stage, 'files', part, rel);
        await mkdir(dirname(dst), { recursive: true });
        await copyStable(join(root, rel), dst);
        files.push({ part, rel });
      }
    }
    const now = new Date();
    const tag = reason.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    return await pack(r, { version: 1, kind: 'data', createdAt: Math.floor(now.getTime() / 1000), host: hostname(), reason, parts: [...parts], files },
      stage, `data-${stamp(now)}${tag ? `-${tag}` : ''}.tar.gz`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function exportSettings(r: Roots): Promise<BackupInfo & { skipped: string[] }> {
  const stage = await stageDir(r);
  try {
    const files: Manifest['files'] = [];
    const skipped: string[] = [];
    for (const [key, src] of Object.entries(r.settings)) {
      const dst = join(stage, 'files', 'settings', key);
      await mkdir(dirname(dst), { recursive: true });
      try { await copyFile(src, dst); files.push({ part: 'settings', rel: key }); } catch { skipped.push(key); }
    }
    const now = new Date();
    const info = await pack(r, { version: 1, kind: 'settings', createdAt: Math.floor(now.getTime() / 1000), host: hostname(), reason: 'export', parts: ['settings'], files },
      stage, `settings-${stamp(now)}.tar.gz`);
    return { ...info, skipped };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function listBackups(r: Roots): Promise<BackupInfo[]> {
  let names: string[] = [];
  try { names = (await readdir(r.backups)).filter((n) => NAME_RE.test(n)); } catch { return []; }
  const out: BackupInfo[] = [];
  for (const name of names) {
    const s = await stat(join(r.backups, name)).catch(() => null);
    if (!s) continue;
    const m = /^(data|settings)-(\d{8})-(\d{6})(?:-([a-z0-9-]+))?\.tar\.gz$/.exec(name) as RegExpExecArray;
    const d = m[2] as string; const t = m[3] as string;
    const createdAt = Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6)) / 1000);
    out.push({ name, kind: m[1] as 'data' | 'settings', size: s.size, createdAt, reason: m[4] ?? '', parts: [] });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name));
}

/** A backup file by name, only from the backups directory. */
export function backupPath(r: Roots, name: string): string {
  if (!NAME_RE.test(name)) throw new ValidationError('không có bản backup này');
  return join(r.backups, basename(name));
}

/** Keep the newest `keep` data backups (settings exports are kept until deleted). */
export async function prune(r: Roots, keep: number): Promise<number> {
  const data = (await listBackups(r)).filter((b) => b.kind === 'data');
  let n = 0;
  for (const b of data.slice(keep)) { await unlink(join(r.backups, b.name)).catch(() => undefined); n++; }
  return n;
}

export async function deleteBackup(r: Roots, name: string): Promise<void> {
  await unlink(backupPath(r, name));
}

/** Delete the chosen parts. The caller has made a data backup and stopped the game. */
export async function wipe(r: Roots, parts: readonly DataPart[]): Promise<string[]> {
  const done: string[] = [];
  const del = async (p: string): Promise<void> => { await rm(p, { force: true }); };
  for (const part of parts) {
    if (part === 'dinos') {
      for (const n of ['TheIslePersistence.db', 'TheIslePersistence.db-wal', 'TheIslePersistence.db-shm', 'TheIslePersistence.counter']) await del(join(r.playerData, n));
    } else if (part === 'bans') {
      await del(join(r.playerData, 'PlayerBans.json'));
      await del(join(r.bridgeData, 'ban-edits.json'));
    } else if (part === 'garage') {
      // The dinos stored and the web-garage queue; the garage's own settings stay,
      // and the folders the mod writes into stay (Lua cannot create one).
      for (const dir of ['stored', 'deleted']) {
        await rm(join(r.garage, dir), { recursive: true, force: true });
        await mkdir(join(r.garage, dir), { recursive: true });
      }
      for (const n of ['storage.json', 'inbox.json', 'inbox.ack.json']) await del(join(r.garage, n));
    } else if (part === 'stats') {
      for (const n of await readdir(r.stats).catch(() => [] as string[])) {
        if (/\.(ndjson|json)$/.test(n)) await del(join(r.stats, n));
      }
    }
    done.push(part);
  }
  return done;
}

/** Put an archive's files back in place. The caller has made a data backup and stopped the game. */
export async function restore(r: Roots, archive: string): Promise<{ kind: 'data' | 'settings'; parts: string[]; files: number }> {
  const stage = await stageDir(r);
  try {
    await run('tar', ['-xzf', archive, '-C', stage]);
    let m: Manifest;
    try { m = JSON.parse(await readFile(join(stage, 'manifest.json'), 'utf8')) as Manifest; } catch { throw new ValidationError('file không phải backup của panel (thiếu manifest.json)'); }
    if (m.version !== 1 || (m.kind !== 'data' && m.kind !== 'settings') || !Array.isArray(m.files)) throw new ValidationError('manifest không hợp lệ');
    let n = 0;
    if (m.kind === 'data') {
      const parts = m.parts.filter((p): p is DataPart => DATA_PARTS.some((d) => d.key === p));
      // Each part is replaced as a whole: first cleared as a wipe would, then filled.
      await wipe(r, parts);
      for (const f of m.files) {
        if (!parts.includes(f.part as DataPart) || f.rel.includes('..')) continue;
        const root = f.part === 'garage' ? r.garage : f.part === 'stats' ? r.stats : r.playerData;
        const dst = join(root, f.rel);
        await mkdir(dirname(dst), { recursive: true });
        await copyFile(join(stage, 'files', f.part, f.rel), dst);
        n++;
      }
      return { kind: 'data', parts, files: n };
    }
    for (const f of m.files) {
      const dst = r.settings[f.rel];
      if (f.part !== 'settings' || dst === undefined) continue;
      await mkdir(dirname(dst), { recursive: true });
      await cp(join(stage, 'files', 'settings', f.rel), dst);
      n++;
    }
    return { kind: 'settings', parts: ['settings'], files: n };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

// --- settings of this page -------------------------------------------------

export interface BackupSettings { atScheduledRestart: boolean; keep: number }
export const BACKUP_DEFAULTS: BackupSettings = { atScheduledRestart: true, keep: 7 };
const settingsPath = (): string => join(config.dataDir, 'backup-settings.json');

export function validateBackupSettings(raw: unknown): BackupSettings {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('body must be an object');
  const r = raw as Record<string, unknown>;
  if (typeof r['atScheduledRestart'] !== 'boolean') throw new ValidationError('atScheduledRestart must be true or false');
  const keep = r['keep'];
  if (typeof keep !== 'number' || !Number.isInteger(keep) || keep < 1 || keep > 60) throw new ValidationError('keep must be 1–60');
  return { atScheduledRestart: r['atScheduledRestart'], keep };
}
export async function readBackupSettings(): Promise<BackupSettings> {
  try { return validateBackupSettings(JSON.parse(await readFile(settingsPath(), 'utf8'))); } catch { return { ...BACKUP_DEFAULTS }; }
}
export async function saveBackupSettings(raw: unknown): Promise<BackupSettings> {
  const s = validateBackupSettings(raw);
  await mkdir(config.dataDir, { recursive: true });
  const tmp = `${settingsPath()}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), 'utf8');
  await rename(tmp, settingsPath());
  return s;
}
