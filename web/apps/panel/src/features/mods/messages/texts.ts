import type { MessageDef } from '@isle/api';

/** The groups of texts, in the panel's order (bridge/src/messages.ts MessageGroup). */
export const MSG_GROUPS: ReadonlyArray<readonly [string, string]> = [
  ['server', 'Khởi động lại / tắt server'], ['corpses', 'Dọn xác'], ['ai', 'Làm mới AI'], ['ban', 'Ban người chơi'], ['prison', 'Nhà tù'],
  ['ptera', 'Ptera gắp'], ['guard', 'Vùng chỉ dino nhỏ / ong đốt khu tù'], ['garage', 'Gara, cất dino'], ['redeem', 'Gara, lấy dino ra'],
  ['commands', 'Lệnh chat (!slay, !unstuck, !prime, !status)'], ['admin', 'Admin'], ['hello', 'Chào mừng'], ['prime', 'Nhiệm vụ prime'],
  ['skin', 'Đổi màu dino (web)'], ['tele', 'Tele con non (web)'],
];

/** "15p" for whole minutes, else "30s". */
export const fmtMark = (sec: number): string => (sec >= 60 && sec % 60 === 0 ? `${sec / 60}p` : `${sec}s`);

/** "15p, 30s, 90" -> seconds (a bare number is seconds); null when unreadable. */
export function parseMarks(text: string): number[] | null {
  const out: number[] = [];
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)\s*(p|ph|phút|m|min|s|g|giây)?$/i.exec(part);
    if (!m) return null;
    const n = Number(m[1]);
    out.push(/^(p|ph|phút|m|min)$/i.test(m[2] ?? '') ? n * 60 : n);
  }
  return out;
}

/** Sample values for the "Ví dụ" line under each text. */
const SAMPLE: Record<string, string> = {
  name: 'Rex', reason: 'Hack / cheat', duration: '3 ngày', until: '29/9/2026 11:00', by: 'Dã Tượng',
  left: '5 phút', leftEn: '5 min', time: '04:00', count: '42', seconds: '30', wait: '2 phút', meters: '25',
  species: 'Carnotaurus', kg: '850', max: '150', slot: 'default', maxSlots: '5', growth: '80', pct: '5', every: '5',
  zone: 'Sanctuary 67', command: 'slay', error: 'slot trống', prime: 'có', eligible: 'chưa',
  offense: 'Giết baby', times: '2', minutes: '10', hunter: 'Dã Tượng', escapes: '1', served: '45 phút',
};
export const example = (text: string): string => text.replace(/\{(\w+)\}/g, (all, k: string) => SAMPLE[k] ?? all);

/**
 * One text as the admin sees it. `own` is the admin's text (undefined = none: the default is sent,
 * or nothing for a text off by default; "" = turned off).
 */
export function view(def: MessageDef, own: string | undefined) {
  const off = own === '' || (def.offByDefault === true && own === undefined);
  const text = own === undefined || own === '' ? def.default : own;
  const tag: null | { kind: 'off' | 'edited'; label: string } = def.offByDefault && own === undefined ? { kind: 'off', label: 'mặc định tắt' }
    : off ? { kind: 'off', label: 'đã tắt' }
      : own !== undefined ? { kind: 'edited', label: def.offByDefault ? 'đã bật' : 'đã sửa' } : null;
  return { off, text, tag };
}

/** What the admin's text becomes after typing `typed` (one line; the default itself is no edit). */
export function typed(def: MessageDef, typedText: string): string | undefined {
  const v = typedText.replace(/\s*\n\s*/g, ' ');
  // Off by default: the text itself, even the suggested one, is what turns it on.
  return v === def.default && !def.offByDefault ? undefined : v;
}

/** What the admin's text becomes after ticking "Gửi" on or off. */
export function sent(def: MessageDef, own: string | undefined, on: boolean): string | undefined {
  if (!on) return def.offByDefault ? undefined : '';
  const shown = view(def, own).text;
  return shown !== def.default || def.offByDefault ? shown : undefined;
}

/** The texts with `key` set to `own` (undefined = removed). */
export function withText(texts: Record<string, string>, key: string, own: string | undefined): Record<string, string> {
  const next = { ...texts };
  if (own === undefined) delete next[key]; else next[key] = own;
  return next;
}
