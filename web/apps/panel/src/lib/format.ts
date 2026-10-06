/** Numbers, names and ids as the panel writes them (the same as the panel before React). */
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** 1234.5 → "1.235" (vi-VN), null → "-". */
export const num = (v: number | null | undefined): string => (isNum(v) ? Math.round(v).toLocaleString('vi-VN') : '-');
/** 0.634 → "63%". */
export const pct = (v: number | null | undefined): string => (isNum(v) ? `${Math.round(v * 100)}%` : '-');
/** BP_Carnotaurus_C, or a full classPath → Carnotaurus. */
export function dinoName(s: string | null | undefined): string {
  if (!s) return '-';
  const tail = String(s).split('.').pop() ?? '';
  return tail.replace(/^BP_/, '').replace(/_C$/, '');
}
/** The last 8 digits of a SteamID ("…12345678"). */
export const shortId = (id: string): string => (id === 'ai' ? 'AI' : id.length > 8 ? `…${id.slice(-8)}` : id);
/** MUT_Hemomania → Hemomania. */
export const mutName = (m: string): string => String(m).replace(/^MUT_/, '').replace(/_/g, ' ');
/** A date and time, vi-VN, 24 h. */
export const dateTime = (t: number): string => new Date(t * 1000).toLocaleString('vi-VN', { hour12: false });

/** A stable colour per SteamID or name (FNV-1a: neighbouring SteamIDs get far apart colours). */
export function hue(id: string): number {
  let h = 0x811c9dc5;
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return (h >>> 0) % 360;
}
export function initials(name: string | null | undefined, id: string): string {
  const s = (name ?? '').trim();
  if (s) return ([...s][0] ?? '?').toUpperCase();
  return String(id).slice(-2);
}
