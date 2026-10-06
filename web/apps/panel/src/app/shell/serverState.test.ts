import { serverState } from './serverState';

const h = (lastEventAt: number | null, online = 0) => ({ lastEventAt, online, players: 0, feed: 0, writesEnabled: true });

test('the sidebar line, as the panel before React says it', () => {
  expect(serverState(null, null)).toEqual(['stale', 'Mất kết nối', 'không gọi được bridge']);
  expect(serverState(h(990, 3), 'running', 1000)).toEqual(['live', 'Server đang chạy', '3 online · event 10s trước']);
  expect(serverState(h(100), 'running', 1000)).toEqual(['live', 'Server đang chạy', 'chưa có người chơi']);
  expect(serverState(h(100), 'starting', 1000)[1]).toBe('Server đang khởi động');
  expect(serverState(h(null), null, 1000)).toEqual(['', 'Chưa có dữ liệu', 'chưa nhận được event nào']);
  expect(serverState(h(100), null, 1000)).toEqual(['stale', 'Server im lặng', 'không có event 15p 0s, có thể đã dừng']);
});
