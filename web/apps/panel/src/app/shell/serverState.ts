import type { Health } from '@isle/api';
import { ago, dur } from '../../lib/time';

export type Dot = 'live' | 'stale' | '';

const PHASE_BADGE: Record<string, [Dot, string, string]> = {
  starting: ['stale', 'Server đang khởi động', 'đợi mod nạp xong'],
  stopping: ['stale', 'Server đang tắt', 'systemd đang dừng tiến trình'],
  stopped: ['stale', 'Server đã tắt', 'bật lại ở tab Server'],
  failed: ['stale', 'Server lỗi', 'systemd báo failed, xem tab Server'],
};

/** The sidebar's server line: from the service's phase and how recent the last game event is. */
export function serverState(health: Health | null, phase: string | null, nowS = Math.floor(Date.now() / 1000)): [Dot, string, string] {
  if (health === null) return ['stale', 'Mất kết nối', 'không gọi được bridge'];
  const badge = phase !== null ? PHASE_BADGE[phase] : undefined;
  if (badge) return badge;
  const last = health.lastEventAt;
  const age = last === null ? null : nowS - last;
  if (last !== null && age !== null && age < 30) return ['live', 'Server đang chạy', `${health.online} online · event ${ago(last, nowS)}`];
  if (phase === 'running') {
    return ['live', 'Server đang chạy', health.online > 0 ? `${health.online} online · event ${last === null ? 'chưa có' : ago(last, nowS)}` : 'chưa có người chơi'];
  }
  if (last === null) return ['', 'Chưa có dữ liệu', 'chưa nhận được event nào'];
  return ['stale', 'Server im lặng', `không có event ${dur(age)}, có thể đã dừng`];
}
