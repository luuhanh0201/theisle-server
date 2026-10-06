import { fishName, nutriColor, nutriMark, plantName } from './data';
import { centreOf, dragHandle, reachM, setZoneShape, zoneHandles, zoneHas, zoneSize, ZONE_DEFAULT, type AiZone } from './zones';

const zone = (p: Partial<AiZone> = {}): AiZone => ({ id: 'z', name: 'Z', x: 0, y: 0, ...structuredClone(ZONE_DEFAULT), ...p });

test('inside a circle, an ellipse (turned), a polygon, as the mod decides', () => {
  const c = zone({ radiusM: 300 });
  expect(zoneHas(c, 29_000, 0)).toBe(true);
  expect(zoneHas(c, 31_000, 0)).toBe(false);
  const e = zone({ shape: 'ellipse', radiusM: 400, radius2M: 100, angleDeg: 90 });
  expect(zoneHas(e, 0, 39_000)).toBe(true);
  expect(zoneHas(e, 39_000, 0)).toBe(false);
  const p = zone({ shape: 'polygon', poly: [[0, 0], [10_000, 0], [10_000, 10_000], [0, 10_000]] });
  expect(zoneHas(p, 5_000, 5_000)).toBe(true);
  expect(zoneHas(p, 15_000, 5_000)).toBe(false);
  expect(centreOf(p.poly!)).toEqual([5_000, 5_000]);
});

test('handles: radius by 10 m steps (50..5000), an ellipse turned by its first handle, a corner moved', () => {
  const c = zone({ radiusM: 300 });
  expect(zoneHandles(c)).toEqual([{ key: 'r', at: [0, 30_000] }]);
  dragHandle(c, 'r', 0, 45_440);
  expect(c.radiusM).toBe(450);
  dragHandle(c, 'r', 0, 100);
  expect(c.radiusM).toBe(50);
  const e = zone({ shape: 'ellipse', radiusM: 400, radius2M: 100, angleDeg: 0 });
  dragHandle(e, 'a', 0, 50_000);
  expect([e.radiusM, e.angleDeg]).toEqual([500, 90]);
  const p = zone({ shape: 'polygon', poly: [[0, 0], [10_000, 0], [10_000, 10_000]] });
  dragHandle(p, 'v1', 20_000.4, 1);
  expect(p.poly![1]).toEqual([20_000, 1]);
});

test('a shape switched keeps about the same place and size; the size line', () => {
  const z = zone({ radiusM: 300 });
  setZoneShape(z, 'ellipse');
  expect([z.shape, z.radiusM, z.radius2M, z.angleDeg]).toEqual(['ellipse', 300, 150, 0]);
  expect(zoneSize(z)).toBe('bầu dục 300 × 150 m');
  setZoneShape(z, 'polygon');
  expect(z.shape).toBe('polygon');
  expect(z.poly!.length).toBeGreaterThanOrEqual(8);
  expect(z.radius2M).toBeUndefined();
  expect(Math.abs(reachM(z) - 300)).toBeLessThanOrEqual(10);
  setZoneShape(z, 'circle');
  expect([z.shape, z.poly]).toEqual(['circle', undefined]);
  expect(zoneSize(z)).toMatch(/^bán kính \d+ m$/);
});

test('plants, fish and nutrient marks as the map writes them', () => {
  expect(plantName('BP_FruitMangoStatic_C')).toBe('Mango (quả)');
  expect(plantName('BP_MangoTreeStaticSpawner_C')).toBe('Mango (cây)');
  expect(fishName('BP_Catfish_C')).toBe('Cá trê');
  expect(nutriMark({ x: 0, y: 0, c: '', cp: 0.2, lp: 0.1 })).toBe('(αγ)');
  expect(nutriMark({ x: 0, y: 0, c: '', n: false, cp: 1 })).toBe('');
  expect(nutriColor({ x: 0, y: 0, c: '', pp: 0.3 })).toBe('#f472b6');
});
