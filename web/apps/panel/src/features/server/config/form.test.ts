import type { GameConfig } from '@isle/api';
import { dirtyGroups, draftOf, keysOf, settingsOf } from './form';

const cfg: Pick<GameConfig, 'schema' | 'settings' | 'effective'> = {
  schema: {
    ServerName: { section: 'S', group: 'server', label: 'Tên', help: '', type: 'text', maxLen: 64, default: '' },
    Discord: { section: 'S', group: 'server', label: 'Discord', help: '', type: 'text', maxLen: 64, default: 'DiscordLinkHere' },
    MaxPlayerCount: { section: 'S', group: 'server', label: 'Tối đa', help: '', type: 'int', min: 1, max: 200, default: 100 },
    bUseRegionSpawning: { section: 'S', group: 'spawn', label: 'Vùng', help: '', type: 'bool', default: false, verified: false },
    AllowedClasses: { section: 'S', group: 'spawn', label: 'Loài', help: '', type: 'list', itemHelp: '', max: 60 },
    AdminsSteamIDs: { section: 'S', group: 'server', label: 'Admin', help: '', type: 'list', itemHelp: '', max: 50 },
  },
  settings: { MaxPlayerCount: 80 },
  effective: { ServerName: 'Xóm Gáy', Discord: 'DiscordLinkHere', AllowedClasses: ['Carnotaurus'], AdminsSteamIDs: ['76561198000000001'] },
};

test('the form starts from the panel\'s value, else the live one, else the default; never the member lists', () => {
  const d = draftOf(cfg);
  expect(d.values).toEqual({ ServerName: 'Xóm Gáy', Discord: '', MaxPlayerCount: 80, bUseRegionSpawning: null, AllowedClasses: ['Carnotaurus'] });
  expect(keysOf(cfg, 'server')).toEqual(['ServerName', 'Discord', 'MaxPlayerCount']);
});

test('saved as the old panel did: the full set, null for "theo game" and an empty text, typed names added', () => {
  const d = draftOf(cfg);
  const edited = { values: { ...d.values, ServerName: '  ', bUseRegionSpawning: true }, extra: { AllowedClasses: 'Troodon, Carnotaurus' } };
  expect(settingsOf(cfg, d)).toEqual({ ServerName: 'Xóm Gáy', Discord: null, MaxPlayerCount: 80, bUseRegionSpawning: null, AllowedClasses: ['Carnotaurus'] });
  expect(settingsOf(cfg, edited)).toEqual({ ServerName: null, Discord: null, MaxPlayerCount: 80, bUseRegionSpawning: true, AllowedClasses: ['Carnotaurus', 'Troodon'] });
  expect([...dirtyGroups(cfg, d, edited)].sort()).toEqual(['server', 'spawn']);
});
