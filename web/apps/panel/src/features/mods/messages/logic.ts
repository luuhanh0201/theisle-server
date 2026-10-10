import type { MessageDef } from '@isle/api';

/** The message groups, in the order the page lists them (bridge/src/messages.ts MessageGroup). */
export const MSG_GROUPS: ReadonlyArray<readonly [string, string]> = [
  ['server', 'Khởi động lại / tắt server'], ['corpses', 'Dọn xác'], ['ai', 'Làm mới AI'], ['ban', 'Ban người chơi'], ['prison', 'Nhà tù'],
  ['ptera', 'Ptera gắp'], ['guard', 'Vùng chỉ dino nhỏ / ong đốt khu tù'], ['garage', 'Gara, cất dino'],
  ['redeem', 'Gara, lấy dino ra'], ['commands', 'Lệnh chat (!slay, !unstuck, !prime, !status)'],
  ['admin', 'Admin'], ['hello', 'Chào mừng'], ['prime', 'Nhiệm vụ prime'], ['skin', 'Đổi màu dino (web)'], ['tele', 'Tele con non (web)'],
  ['cap', 'Giới hạn loài'],
];

/** 600 → "10p", 30 → "30s". */
export const fmtMark = (sec: number): string => (sec >= 60 && sec % 60 === 0 ? `${sec / 60}p` : `${sec}s`);

/** "15p, 30s, 90" → seconds (a bare number is seconds); null when unreadable. */
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
export const msgExample = (text: string): string => text.replace(/\{(\w+)\}/g, (all, k: string) => SAMPLE[k] ?? all);

/** How one text stands: sent or not, what it says, its tag. `own` = the admin's text (undefined: none). */
export function msgState(def: MessageDef, own: string | undefined): { off: boolean; text: string; tag: 'defaultOff' | 'off' | 'edited' | 'on' | null } {
  const off = own === '' || (def.offByDefault === true && own === undefined);
  const text = own === undefined || own === '' ? def.default : own;
  const tag = def.offByDefault && own === undefined ? 'defaultOff' : off ? 'off' : own !== undefined ? (def.offByDefault ? 'on' : 'edited') : null;
  return { off, text, tag };
}
export const TAG_LABEL = { defaultOff: 'mặc định tắt', off: 'đã tắt', edited: 'đã sửa', on: 'đã bật' } as const;

/** The admin typed `value`: kept as their text, or dropped when it is the default (one line). */
export function withText(texts: Record<string, string>, def: MessageDef, value: string): Record<string, string> {
  const v = value.replace(/\s*\n\s*/g, ' ');
  const next = { ...texts };
  // Off by default: the text itself, even the suggested one, is what turns it on.
  if (v === def.default && !def.offByDefault) delete next[def.key]; else next[def.key] = v;
  return next;
}

/** "Gửi" ticked or not; `shown` is the text in the box. */
export function withSend(texts: Record<string, string>, def: MessageDef, send: boolean, shown: string): Record<string, string> {
  const next = { ...texts };
  if (send) {
    delete next[def.key];
    if (shown !== def.default || def.offByDefault) next[def.key] = shown;
  } else if (def.offByDefault) {
    delete next[def.key];
  } else {
    next[def.key] = '';
  }
  return next;
}
