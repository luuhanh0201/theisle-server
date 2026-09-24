import { execFile } from 'node:child_process';
import { config } from './config.js';

/**
 * The game server as a systemd unit.
 *
 * Reading state needs no privileges. start/stop/restart go through
 * `sudo -n systemctl <verb> theisle.service`: install.sh grants the bridge
 * user exactly those commands, nothing else. `-n` makes a missing rule fail
 * immediately instead of hanging on a password prompt.
 *
 * Commands are run with execFile (no shell), with fixed arguments.
 */

export interface UnitState {
  /** active | inactive | activating | deactivating | failed | … */
  activeState: string;
  subState: string;
  /** Unix seconds the unit last became active, null if never / inactive. */
  since: number | null;
  pid: number | null;
}

export type Verb = 'start' | 'stop' | 'restart';

export interface ServiceControl {
  state(): Promise<UnitState>;
  run(verb: Verb): Promise<void>;
}

type Runner = (file: string, args: string[], timeoutMs: number) => Promise<string>;

const execRunner: Runner = (file, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        const detail = (stderr || error.message).trim().split('\n').slice(-2).join(' ');
        reject(new Error(`${file} ${args.join(' ')}: ${detail}`));
      } else {
        resolve(stdout);
      }
    });
  });

/** `systemctl show` output (Key=Value lines) -> UnitState. */
export function parseShow(out: string): UnitState {
  const kv = new Map<string, string>();
  for (const line of out.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) kv.set(line.slice(0, i), line.slice(i + 1).trim());
  }
  // --timestamp=unix gives "@1790000000"; older systemd gives a date string.
  const rawSince = kv.get('ActiveEnterTimestamp') ?? '';
  let since: number | null = null;
  if (rawSince.startsWith('@')) since = Number.parseInt(rawSince.slice(1), 10);
  else if (rawSince !== '' && rawSince !== 'n/a') {
    const parsed = Date.parse(rawSince);
    if (!Number.isNaN(parsed)) since = Math.floor(parsed / 1000);
  }
  const pid = Number.parseInt(kv.get('MainPID') ?? '', 10);
  return {
    activeState: kv.get('ActiveState') ?? 'unknown',
    subState: kv.get('SubState') ?? 'unknown',
    since: since !== null && Number.isFinite(since) && since > 0 ? since : null,
    pid: Number.isFinite(pid) && pid > 0 ? pid : null,
  };
}

export function systemdService(run: Runner = execRunner): ServiceControl {
  const { unit, systemctl, sudo } = config.game;
  return {
    async state() {
      const out = await run(systemctl, [
        'show', unit, '--timestamp=unix',
        '-p', 'ActiveState', '-p', 'SubState', '-p', 'ActiveEnterTimestamp', '-p', 'MainPID',
      ], 10_000);
      return parseShow(out);
    },
    async run(verb) {
      // Stopping waits for the game to exit (TimeoutStopSec=60 in the unit).
      if (sudo === 'none') await run(systemctl, [verb, unit], 120_000);
      else await run(sudo, ['-n', systemctl, verb, unit], 120_000);
    },
  };
}
