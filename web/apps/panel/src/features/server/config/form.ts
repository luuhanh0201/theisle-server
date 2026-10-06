import type { GameConfig, GameKeySpec } from '@isle/api';

/** The admin / whitelist / VIP lists live on Thành viên (one page for who is who): not on this form. */
export const MEMBER_KEYS: ReadonlySet<string> = new Set(['AdminsSteamIDs', 'WhitelistIDs', 'VIPs', 'bServerWhitelist']);
export const NAME = /^[A-Za-z0-9_]{2,64}$/;

/**
 * The form, as the panel before React held it: a value per key shown (null = "theo mặc định của
 * game": no line in Game.ini), and the names typed beside a list's tick boxes.
 */
export interface CfgDraft { values: Record<string, unknown>; extra: Record<string, string> }

/** The keys of a group shown on the form (the member lists left out). */
export const keysOf = (c: Pick<GameConfig, 'schema'>, group: string): string[] =>
  Object.keys(c.schema).filter((k) => c.schema[k]!.group === group && !MEMBER_KEYS.has(k));

/**
 * What the form starts from: the panel's value, else the live Game.ini's, else the game's default
 * (nothing for a key whose default is unknown: "theo mặc định của game").
 */
export function draftOf(c: Pick<GameConfig, 'schema' | 'settings' | 'effective'>): CfgDraft {
  const eff = { ...c.effective, ...c.settings };
  const values: Record<string, unknown> = {};
  const extra: Record<string, string> = {};
  for (const [k, spec] of Object.entries(c.schema)) {
    if (MEMBER_KEYS.has(k)) continue;
    const v = k in eff && eff[k] !== null ? eff[k] : spec.verified === false ? null : 'default' in spec ? spec.default : [];
    if (spec.type === 'text') values[k] = v === spec.default ? '' : String(v ?? '');   // the game's default is a placeholder, not a value
    else if (spec.type === 'list') { values[k] = Array.isArray(v) ? v : []; extra[k] = ''; }
    else values[k] = v;
  }
  return { values, extra };
}

/** Every field as the form shows it: the panel always saves the full set (bridge saveSettings). */
export function settingsOf(c: Pick<GameConfig, 'schema'>, d: CfgDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, spec] of Object.entries(c.schema)) {
    if (!(k in d.values)) continue;
    const v = d.values[k];
    if (spec.type === 'list') {
      const typed = (d.extra[k] ?? '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
      out[k] = [...new Set([...(v as string[]), ...typed])];
    } else if (v === null && spec.verified === false) out[k] = null;   // no line: the game decides
    else if (spec.type === 'text') out[k] = String(v ?? '').trim() === '' ? null : v;
    else if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

/** The groups holding a change (their sub-tabs get the dot). */
export function dirtyGroups(c: Pick<GameConfig, 'schema'>, base: CfgDraft, d: CfgDraft): Set<string> {
  const out = new Set<string>();
  for (const k of Object.keys(d.values)) {
    if (JSON.stringify(d.values[k]) !== JSON.stringify(base.values[k]) || (d.extra[k] ?? '') !== (base.extra[k] ?? '')) out.add(c.schema[k]!.group);
  }
  return out;
}

/** The line under a field: its help and the game's default. */
export function defaultText(spec: GameKeySpec): string {
  if (spec.type === 'list' || spec.type === 'text') return '';
  if (spec.verified === false) return 'mặc định của game: không rõ (để "theo game" = không ghi dòng này)';
  return `mặc định ${spec.type === 'bool' ? (spec.default ? 'Bật' : 'Tắt') : String(spec.default)}`;
}
