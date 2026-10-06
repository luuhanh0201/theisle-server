import { alertsOf } from './Overview';
import { fpsState, gb, n1 } from './Perf';

test('alerts: not running, an operation, a restart soon, the mod silent', () => {
  const now = 1_791_000_000;
  expect(alertsOf({ phase: 'stopped' }, { lastEventAt: now, online: 0 }, now)[0]).toMatchObject({ tone: 'critical', text: 'Server: Đã tắt.' });
  expect(alertsOf({ phase: 'starting' }, { lastEventAt: now, online: 0 }, now)[0]!.tone).toBe('warning');
  expect(alertsOf({ phase: 'running', operation: { kind: 'restart', step: 'saving' } }, { lastEventAt: now, online: 0 }, now)[0]!.text).toBe('Đang khởi động lại server (saving).');
  expect(alertsOf({ phase: 'running', schedule: { next: now + 600 } }, { lastEventAt: now, online: 0 }, now)[0]!.href).toBe('#server/schedule');
  expect(alertsOf({ phase: 'running', schedule: { next: now + 3600 } }, { lastEventAt: now, online: 0 }, now)).toHaveLength(0);
  expect(alertsOf({ phase: 'running' }, { lastEventAt: now - 900, online: 3 }, now)[0]!.text).toMatch(/Mod chưa ghi sự kiện nào/);
  expect(alertsOf({ phase: 'running' }, { lastEventAt: now - 900, online: 0 }, now)).toHaveLength(0);
});

test('the FPS state and the numbers as the tiles show them', () => {
  expect(fpsState(30).label).toBe('Mượt');
  expect(fpsState(18).label).toBe('Hơi giật');
  expect(fpsState(10).label).toBe('Giật');
  expect(fpsState(null).label).toBe('Chưa có số liệu');
  expect(gb(1536)).toBe('1.5');
  expect(gb(20480)).toBe('20');
  expect(gb(null)).toBe('–');
  expect(n1(27.85)).toBe('27,9');
});
