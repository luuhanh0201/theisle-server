/** Shared bits of the player pages (as the panel before React). */

/** The time left of a sentence: "45 giây", "12 phút", "2 giờ", "2 giờ 5 phút". */
export function prDur(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} giây`;
  const m = Math.round(s / 60);
  const h = Math.floor(m / 60);
  return h === 0 ? `${m} phút` : m % 60 === 0 ? `${h} giờ` : `${h} giờ ${m % 60} phút`;
}

/** "online" / "3 phút trước" / "2 ngày trước" / a date after a week: when the player was last seen. */
export function lastSeenText(lastSeen: number | null | undefined, nowS = Math.floor(Date.now() / 1000)): string | null {
  if (!lastSeen) return null;
  const s = Math.max(0, nowS - lastSeen);
  if (s < 10) return 'vừa xong';
  if (s < 60) return `${s}s trước`;
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} ngày trước`;
  return new Date(lastSeen * 1000).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** A ping's tone: green under 80 ms, amber under 150, red above. */
export const pingTone = (ms: number): 'grow' | 'dmg' | 'kill' => (ms < 80 ? 'grow' : ms < 150 ? 'dmg' : 'kill');

/** Copy a text to the clipboard (silently nothing where the browser refuses). */
export function copyText(text: string): void {
  if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text).catch(() => undefined); return; }
  const input = document.createElement('input');
  input.value = text;
  document.body.appendChild(input);
  input.select();
  try { document.execCommand('copy'); } catch { /* nothing */ }
  input.remove();
}
