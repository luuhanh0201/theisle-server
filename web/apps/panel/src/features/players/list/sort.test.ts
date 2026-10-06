import type { PlayerRow } from '@isle/api';
import { firstDir, viewOf } from './sort';

const p = (o: Partial<PlayerRow> & { steamId: string }): PlayerRow => ({ name: null, species: null, online: false, growth: null, ...o });
const rows = [
  p({ steamId: '76561198000000001', name: 'Bình', species: 'BP_Carnotaurus_C', online: true, ping: 120, kills: 3, deaths: 1, lastSeen: 100 }),
  p({ steamId: '76561198000000002', name: 'An', species: 'BP_Troodon_C', online: false, kills: 6, deaths: 3, lastSeen: 300 }),
  p({ steamId: '76561198000000003', name: 'Chi', species: 'BP_Carnotaurus_C', online: true, ping: 40, kills: 0, deaths: 0, lastSeen: 200 }),
];

test('search by name, SteamID end or species; the status filter', () => {
  expect(viewOf(rows, 'carno', 'all', null, 'desc').map((r) => r.name)).toEqual(['Bình', 'Chi']);
  expect(viewOf(rows, '0002', 'all', null, 'desc').map((r) => r.name)).toEqual(['An']);
  expect(viewOf(rows, '', 'offline', null, 'desc').map((r) => r.name)).toEqual(['An']);
});

test('sorts as the panel before React: names up first, K/D then kills, ping with offline last, online after offline by last seen', () => {
  expect(firstDir('player')).toBe('asc');
  expect(firstDir('kd')).toBe('desc');
  expect(viewOf(rows, '', 'all', 'player', 'asc').map((r) => r.name)).toEqual(['An', 'Bình', 'Chi']);
  expect(viewOf(rows, '', 'all', 'kd', 'desc').map((r) => r.name)).toEqual(['Bình', 'An', 'Chi']);
  expect(viewOf(rows, '', 'all', 'ping', 'asc').map((r) => r.name)).toEqual(['Chi', 'Bình', 'An']);
  // Online counts as the most recent; between two online, the later seen first.
  expect(viewOf(rows, '', 'all', 'lastSeen', 'desc').map((r) => r.name)).toEqual(['Chi', 'Bình', 'An']);
});
