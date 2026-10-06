import { niceCeil } from '../../components/chart/LineChart';
import { dayKey, spanOf, trDay } from './Traffic';

test('the days asked: today, 7 or 30 days back, a span typed in either order', () => {
  const now = new Date(2026, 9, 6, 15);
  expect(spanOf('day', null, null, now)).toEqual(['2026-10-06', '2026-10-06']);
  expect(spanOf('week', null, null, now)).toEqual(['2026-09-30', '2026-10-06']);
  expect(spanOf('month', null, null, now)).toEqual(['2026-09-07', '2026-10-06']);
  expect(spanOf('custom', '2026-10-05', '2026-10-01', now)).toEqual(['2026-10-01', '2026-10-05']);
  expect(dayKey(new Date(2026, 0, 2))).toBe('2026-01-02');
  expect(trDay('2026-10-06')).toBe('06/10');
});

test('a chart top is a round number at or above the highest value', () => {
  expect(niceCeil(1)).toBe(1);
  expect(niceCeil(7)).toBe(8);
  expect(niceCeil(31.5)).toBe(40);
  expect(niceCeil(1200)).toBe(1500);
});
