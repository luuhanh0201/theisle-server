import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';

/**
 * Append-only log of every admin action taken through the panel: who asked
 * (the panel has one shared token, so "who" is the reason text), what, and
 * whether it worked. One JSON object per line in DATA_DIR/admin-audit.ndjson.
 */

export interface AuditEntry {
  t: number;
  action: string;
  detail?: string;
  ok: boolean;
  error?: string;
}

const path = (): string => join(config.dataDir, 'admin-audit.ndjson');

export async function audit(entry: Omit<AuditEntry, 't'>): Promise<void> {
  const line: AuditEntry = { t: Math.floor(Date.now() / 1000), ...entry };
  try {
    await mkdir(config.dataDir, { recursive: true });
    await appendFile(path(), JSON.stringify(line) + '\n', 'utf8');
  } catch (error) {
    // Losing an audit line must not fail the action it describes.
    console.error('[audit] could not write:', error);
  }
  console.info(`[audit] ${line.action}${line.detail ? ` (${line.detail})` : ''}: ${line.ok ? 'ok' : `FAILED ${line.error ?? ''}`}`);
}

/** Newest first. */
export async function readAudit(limit = 100): Promise<AuditEntry[]> {
  let text: string;
  try {
    text = await readFile(path(), 'utf8');
  } catch {
    return [];
  }
  const out: AuditEntry[] = [];
  const lines = text.trim().split('\n');
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      out.push(JSON.parse(lines[i] as string) as AuditEntry);
    } catch {
      /* a torn line is skipped */
    }
  }
  return out;
}
