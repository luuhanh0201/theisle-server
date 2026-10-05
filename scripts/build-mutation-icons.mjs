#!/usr/bin/env node
// Bundle the mutation icons (portal/public/img/mutations/<slug>.svg) into one
// file, img/mutations/icons.json { "<slug>": "<svg …>" }: a page loads it ONCE
// (portal public/mut-icons.js) instead of one request an icon, 40 icons at
// once tripped the proxy in front of the site (503 on about half, 2026-10-02).
// Run after adding or changing an icon:  node scripts/build-mutation-icons.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'portal', 'public', 'img', 'mutations');
const out = {};
for (const f of readdirSync(dir).filter((n) => n.endsWith('.svg')).sort()) {
  // Comments and runs of white space go: smaller, same picture.
  out[f.slice(0, -4)] = readFileSync(join(dir, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();
}
// The portal's copy, and the panel's (the panel serves /img/ from bridge/public/img).
const panelDir = join(dir, '..', '..', '..', '..', 'bridge', 'public', 'img', 'mutations');
for (const d of [dir, panelDir]) writeFileSync(join(d, 'icons.json'), JSON.stringify(out));
console.log(`icons.json: ${Object.keys(out).length} icons (portal + panel)`);
