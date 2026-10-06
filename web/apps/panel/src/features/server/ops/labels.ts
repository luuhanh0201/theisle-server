import type { PowerOperation } from '@isle/api';

/** The game service's phase, step and kind of operation, as the panel before React named them. */
export const PHASE_VN: Record<string, string> = {
  running: 'Đang chạy', starting: 'Đang khởi động', stopping: 'Đang tắt',
  stopped: 'Đã tắt', failed: 'Lỗi, unit failed', unknown: 'Không rõ trạng thái',
};
export const STEP_VN: Record<PowerOperation['step'], string> = {
  countdown: 'Đếm ngược', saving: 'Lưu game', stopping: 'Đang tắt', restarting: 'Khởi động lại', backup: 'Backup dữ liệu',
  starting: 'Đang bật', waiting: 'Chờ mod nạp', done: 'Xong', failed: 'Thất bại', cancelled: 'Đã huỷ',
};
export const KIND_VN: Record<PowerOperation['kind'], string> = { start: 'Bật server', stop: 'Tắt server', restart: 'Khởi động lại' };

/** The steps an operation goes through, in order. */
export function flowOf(kind: PowerOperation['kind']): PowerOperation['step'][] {
  if (kind === 'start') return ['starting', 'waiting', 'done'];
  if (kind === 'stop') return ['countdown', 'saving', 'stopping', 'done'];
  return ['countdown', 'saving', 'restarting', 'waiting', 'done'];
}

/** 125 000 ms → "2:05". */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** What the players are told before a stop / restart (seconds). */
export const COUNTDOWNS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '0', label: 'Ngay lập tức' }, { value: '60', label: '1 phút' }, { value: '300', label: '5 phút' },
  { value: '600', label: '10 phút' }, { value: '900', label: '15 phút' }, { value: '1800', label: '30 phút' },
];
