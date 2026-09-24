// VulnonaMAP data files → the live map's features and bounds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVulnona, parseGateway, plainText, currentGateway } from '../dist/vulnona.js';

const D1 = [
  '#cfg\tname_X\tLat', '#cfg\tmin_X\t-607', '#cfg\tmax_X\t509', '#cfg\tname_Y\tLong',
  '#cfg\tmin_Y\t-505', '#cfg\tmax_Y\t607', '#cfg\taxis_X\tH', '#---',
  'layer\twater\twater_image', '#---',
  'dir\tArea', '#---',
  'text\tarea\tDelta\tlarge', '33,177,Delta,', '#---',
  'dirEnd\tArea',
  'dir\tLocations', 'dir\tLandmarks', '#---',
  'text\tland\tLog Bridge\tsmall', '-221,360,Log Bridge,-222,358', '#---',
  'text\tland\t:Central Dome:comment\tcR small dev', '120,-41,[Now can\'t enter here],', '#---',
  'text\tland\tSite C14', '-429,201,<l>Site C14</l>(Derelict Base),', '#---',
  'dirEnd\tLandmarks', 'dirEnd\tLocations',
  'dir\tMud', '#---',
  'circle\textra\tEast Lake:mud\tmud', '-142,434,3,2,45,', '#---',
  'dirEnd\tMud',
  'dir\tMigration', '#---',
  'line\textra\t[01] :mz\tmz', '228.1,-31,', '360.6,-31,', '360.6,140.9,', '228.1,-31,', '#---',
  'circle\textra\t[05] :mmz\tmz mmz', '-37.1,450.4,62.6,62.6,0', '#---',
  'dirEnd\tMigration',
  'dir\t_AirCurrent_', '#---',
  'path\tsky\tDelta River\tFL1 bold', '-171,217,M,up,7:30-20:00', '-79,222,M', '-97,240,Q', '-110,264.5,', '#---',
  'dirEnd\t_AirCurrent_',
  'dir\tCave', '#---',
  'path\tcave\t:Port Swere:B3\tB3', '-280.8,492.7,M,exit', '-285,493.9,', '-289.2,494.6,M', '-289.4,493.2,', '#---',
  'dirEnd\tCave',
].join('\r\n');

const D2 = [
  'dir\tFoods & Items', 'dir\t- Animal (terrestrial) -', 'dir\tBoar', '#---',
  'food\tBoar', '-390,188,up2026/09/12', '#---',
  'dirEnd\tBoar', 'dirEnd\t- Animal (terrestrial) -',
  'dir\t- Fruits -', 'dir\tMango', '#---',
  'food\tMango', '10,20,up2026/01/02,3/4/5', '#---',
  'dirEnd\tMango', 'dirEnd\t- Fruits -',
  'dir\t- Earthworks -', 'dir\tSaltRock', '#---',
  'food\tSaltRock', '5,6,up2025/12/30', '#---',
  'dirEnd\tSaltRock', 'dirEnd\t- Earthworks -', 'dirEnd\tFoods & Items',
  'dir\t_Road_', '#---',
  'path\troad\tWest Access - Trail I\ttrail', '-52,-191,M,', '-49,-191,', '-46,-192,', '#---',
  'dirEnd\t_Road_',
].join('\r\n');

test('bounds come from #cfg; CRLF is fine', () => {
  assert.deepEqual(parseVulnona(D1).bounds, { minX: -607, maxX: 509, minY: -505, maxY: 607 });
  assert.equal(parseVulnona(D2).bounds, null, 'the food file has no bounds');
});

test('labels: text reduced, trailing extra point dropped, author notes skipped', () => {
  const f = parseVulnona(D1).features.filter((x) => x.kind === 'label');
  assert.deepEqual(f.map((x) => [x.layer, x.text, x.at]), [
    ['area', 'Delta', [33, 177]],
    ['landmark', 'Log Bridge', [-221, 360]],
    ['landmark', 'Site C14 (Derelict Base)', [-429, 201]],
  ]);
  assert.equal(f[0].size, 'large');
});

test('zones: migration outline and a mass-migration circle', () => {
  const z = parseVulnona(D1).features.filter((x) => x.layer === 'migration');
  assert.equal(z[0].kind, 'poly');
  assert.equal(z[0].name, 'MZ 01');
  assert.equal(z[0].pts[0].length, 4);
  assert.equal(z[0].mass, undefined);
  assert.deepEqual([z[1].kind, z[1].name, z[1].at, z[1].r, z[1].mass], ['circle', 'MZ 05', [-37.1, 450.4], [62.6, 62.6], true]);
  const mud = parseVulnona(D1).features.find((x) => x.layer === 'mud');
  assert.deepEqual([mud.r, mud.rot], [[3, 2], 45]);
});

test('paths: M starts a sub-path; exits and updrafts become marks', () => {
  const fs = parseVulnona(D1).features;
  const air = fs.find((x) => x.layer === 'air');
  assert.equal(air.kind, 'path');
  assert.deepEqual(air.pts, [[[-79, 222], [-97, 240], [-110, 264.5]]], 'the lone updraft point is a mark, not a line');
  assert.deepEqual(air.marks, [{ at: [-171, 217], what: 'updraft', hours: '7:30-20:00' }]);
  const cave = fs.find((x) => x.layer === 'cave');
  assert.equal(cave.name, 'Port Swere');
  assert.equal(cave.pts.length, 2);
  assert.deepEqual(cave.marks, [{ at: [-280.8, 492.7], what: 'exit' }]);
});

test('food: layer by folder, species name, last check date', () => {
  const fs = parseVulnona(D2).features.filter((x) => x.kind === 'point');
  assert.deepEqual(fs.map((x) => [x.layer, x.name, x.group, x.at, x.checked]), [
    ['animal', 'Boar', 'Animal (terrestrial)', [-390, 188], '2026-09-12'],
    ['plant', 'Mango', 'Fruits', [10, 20], '2026-01-02'],
    ['mineral', 'SaltRock', 'Earthworks', [5, 6], '2025-12-30'],
  ]);
  assert.equal(parseVulnona(D2).features.find((x) => x.layer === 'road').pts[0].length, 3);
});

test('both files together; no bounds anywhere is an error', () => {
  const m = parseGateway(D1, D2);
  assert.equal(m.bounds.maxY, 607);
  assert.ok(m.features.some((x) => x.layer === 'road') && m.features.some((x) => x.layer === 'area'));
  assert.throws(() => parseGateway(D2), /bounds/);
});

test('plainText and the current map entry', () => {
  assert.equal(plainText('Port<s>(East port)</s>'), 'Port (East port)');
  assert.equal(plainText('Eastern<br>Jungle'), 'Eastern\nJungle');
  const dat = [
    'map\tE\tTI\tGateway_v0.21.7\t\tGateway v0.21.772\t\t✅Evrima 0.21.720 ~ 0.21.772\t2026.09.21\t\t_489px',
    'map\tE\tTI\tGateway_v0.21\t\tGateway v0.21.3 (Outdated)\t❌Evrima 0.21.321 ~ \t\t2026.06.01',
  ].join('\n');
  assert.deepEqual(currentGateway(dat), { id: 'Gateway_v0.21.7', name: 'Gateway v0.21.772', updated: '2026-09-21' });
  assert.equal(currentGateway(dat.split('\n')[1]), null, 'an outdated map is not picked');
});
