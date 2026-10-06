import { dinoName, hue, initials, mutName, num, pct, shortId } from './format';

test('names and numbers as the panel before React wrote them', () => {
  expect(dinoName('BlueprintGeneratedClass /Game/X/BP_Carnotaurus.BP_Carnotaurus_C')).toBe('Carnotaurus');
  expect(dinoName(null)).toBe('-');
  expect(pct(0.634)).toBe('63%');
  expect(num(1234.5)).toBe((1235).toLocaleString('vi-VN'));
  expect(shortId('76561198000000123')).toBe('…00000123');
  expect(mutName('MUT_Hemo_mania')).toBe('Hemo mania');
  expect(initials('đạt', '7656')).toBe('Đ');
  expect(initials(null, '76561198000000123')).toBe('23');
  // FNV-1a, as before: neighbouring SteamIDs far apart.
  expect(Math.abs(hue('76561198000000001') - hue('76561198000000002'))).toBeGreaterThan(5);
});
