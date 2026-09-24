/**
 * Download the current Gateway map from VulnonaMAP into public/map/, where the
 * panel's live map reads it.
 *
 *   node dist/cli-fetch-map.js [--size 3]
 *
 * Writes public/map/gateway.json (bounds, points, zones, source) and
 * public/map/gateway.webp (the base image). Run it again after a game update
 * moves things; deploy ships whatever is in public/map/.
 *
 * Size = VulnonaMAP's base image index: 2 ≈ 1950 px (0.7 MB), 3 ≈ 3900 px
 * (2.5 MB, default), 4 ≈ 7800 px (6.5 MB).
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentGateway, parseGateway } from './vulnona.js';

const BASE = 'https://vulnona.com/game/map';
const args = process.argv.slice(2);
const sizeArg = args.indexOf('--size');
const size = sizeArg >= 0 ? Number(args[sizeArg + 1]) : 3;
if (!Number.isInteger(size) || size < 0 || size > 4) {
  console.error('usage: cli-fetch-map [--size 0..4]');
  process.exit(2);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'map');

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { 'user-agent': 'theisle-bridge map fetch (panel live map)' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

/** Write next to the target, then rename: a half-written file never gets served. */
function writeAtomic(path: string, data: string | Uint8Array): void {
  writeFileSync(`${path}.tmp`, data);
  renameSync(`${path}.tmp`, path);
}

const map = currentGateway(await (await get(`${BASE}/dat.txt`)).text());
if (map === null) throw new Error('no current Gateway map in VulnonaMAP dat.txt');
console.log(`VulnonaMAP: ${map.name} (${map.id}), updated ${map.updated}`);

const [d1, d2] = await Promise.all([1, 2].map(async (n) => (await get(`${BASE}/map/${map.id}/data_${n}.txt`)).text()));
const parsed = parseGateway(d1 as string, d2 as string);
const image = new Uint8Array(await (await get(`${BASE}/map/${map.id}/base/${size}.webp`)).arrayBuffer());
// WebP = "RIFF....WEBP". Anything else (an error page) must not replace a good image.
const magic = new TextDecoder().decode(image.subarray(0, 4)) + new TextDecoder().decode(image.subarray(8, 12));
if (magic !== 'RIFFWEBP') throw new Error('base image is not a WebP file');

mkdirSync(outDir, { recursive: true });
writeAtomic(join(outDir, 'gateway.webp'), image);
writeAtomic(join(outDir, 'gateway.json'), JSON.stringify({
  map: map.id,
  name: map.name,
  updated: map.updated,
  fetchedAt: new Date().toISOString(),
  source: {
    name: 'VulnonaMAP', author: 'Coco.N', url: 'https://vulnona.com/game/map/',
    note: 'Base image: in-game screenshots, © the game developer.',
  },
  image: 'gateway.webp',
  bounds: parsed.bounds,
  features: parsed.features,
}));

const count: Record<string, number> = {};
for (const f of parsed.features) count[f.layer] = (count[f.layer] ?? 0) + 1;
console.log(`wrote ${outDir}/gateway.json (${parsed.features.length} features) and gateway.webp (${(image.length / 1e6).toFixed(1)} MB)`);
console.log(Object.entries(count).map(([k, v]) => `  ${k}: ${v}`).join('\n'));
