/** "vừa xong", "12s trước", "3 phút trước", "2 giờ trước" (unix seconds). */
export function ago(t: number, nowS = Math.floor(Date.now() / 1000)): string {
  const s = Math.max(0, nowS - t);
  if (s < 5) return 'vừa xong';
  if (s < 60) return `${s}s trước`;
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  return `${Math.floor(s / 3600)} giờ trước`;
}

/** A length of time: "1g 5p", "3p 20s", "45s". */
export function dur(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '-';
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  if (h > 0) return `${h}g ${m}p`;
  if (m > 0) return `${m}p ${s}s`;
  return `${s}s`;
}

/** A moment as the panel shows it: "6/10/2026, 14:05:09" (unix seconds, Vietnamese, 24 h). */
export const dateTime = (t: number): string => new Date(t * 1000).toLocaleString('vi-VN', { hour12: false });
