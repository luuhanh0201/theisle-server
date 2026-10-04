// The dino in 3D, in its colours: the skin editor (tab Skin), the dino played
// now (tab Game) and each dino in the garage (tab Gara). One viewer per place
// (window.Dino3D.create), all sharing the models and the per-species work.
//
// Assets: /dino3d/registry.json + per species a .glb (EXT_meshopt_compression,
// materials MI_<Species>_Body / _Eye), a region map (…Pattern…png), a normal
// map and a RAC map: from sv1.datviet.app's IsleHub (the game's own art).
//
// The region map paints each skin region in a code colour: cyan body, blue
// flank, green underbelly, magenta markings, red male display, yellow detail
// (black = unused UV space); edges blend between two of them. Every pixel is
// classified ONCE per species (its two nearest regions and the blend between
// them); a colour change only re-mixes those, fast enough to follow a picker.
// Teeth, mouth and claws have no region there (the game masks them with a
// texture these assets lack): they are found on the model instead, once per
// species (parts()): the mouth: skin on the tongue bones, or glossy skin
// (the RAC map's red, roughness) on the head / jaw close to the tongue; the
// teeth: the small separate UV pieces on the head / jaw; the claws: glossy
// skin on the last segment of each toe / finger.
// A colour the game holds as exactly black (0, 0, 0) is a region that species
// does not use (Detail1, and Eyes on some): shown with a stand-in, not black.
// A female has no display colour: its display areas take the body colour.
// Shading: the RAC map's blue channel (crevices) and green (surface detail) are
// baked into the colour; the normal map gives the relief.
// Effects (mud, blood, dirt, dust, duckweed) are a hint, not the game's look: a
// tint over the whole body, stronger in the crevices; wet skin is glossier.
// Light per region (skin.light = { Body: 0.3, Eyes: 3 … } × skin.brightness,
// the panel's skins): below 1 the colour is darker (in linear, as the game
// multiplies it); above 1 that region also glows with its own colour (an
// emissive layer, up to × 4 = full). A skin with no light: the older single
// glow ("brighter than white" for the whole dino).
//
// The editor's species and sex: our own picker (#skin-species, #skin-gender).
// In game it follows the dino played now; a species the player picks stays
// until that dino changes (a new species or sex, a new life).

import * as THREE from '/vendor/three-0.170.0/three.module.min.js';
import { GLTFLoader } from '/vendor/three-0.170.0/GLTFLoader.js';
import { OrbitControls } from '/vendor/three-0.170.0/OrbitControls.js';
import { MeshoptDecoder } from '/vendor/three-0.170.0/meshopt_decoder.module.js';
import { clone as cloneSkinned } from '/vendor/three-0.170.0/SkeletonUtils.js';

const SIZE = 1024;                 // the painted texture, per side
const REGION_CODES = [             // [region, code colour in the region map]
  ['Body', [0, 255, 245]],
  ['Flank', [0, 0, 255]],
  ['Underbelly', [0, 255, 0]],
  ['Markings', [255, 0, 255]],
  ['MaleDisplay', [255, 0, 0]],
  ['Detail1', [255, 255, 0]],
];
const CODES = Int32Array.from(REGION_CODES.flatMap(([, c]) => c));
// [effect, tint (sRGB), strength]: a hint of how each looks, not the game's texture.
const FX_TINTS = [
  ['Mud', [74, 52, 34], 0.85], ['Dirt', [92, 82, 68], 0.6], ['Dust', [190, 172, 140], 0.55],
  ['Duckweed', [79, 122, 42], 0.6], ['Blood', [110, 8, 8], 0.8],
];

const srgb = (hex) => { const n = parseInt(String(hex).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toLinear = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const toSrgb = (l) => { const x = Math.min(1, Math.max(0, l)); return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055); };
/** The game's own limit on a colour channel (bridge commands.ts SKIN_CHANNEL_MAX). */
const CHANNEL_MAX = 4;
/** `f` as the game gets it: the colour × f, each channel at most CHANNEL_MAX (× 16 on white is × 4). */
const effective = (c, f) => {
  if (f <= 1) return f;
  const top = Math.max(...c.map(toLinear));
  return top > 0 ? Math.min(f, CHANNEL_MAX / top) : f;
};
/**
 * An sRGB colour made `f` times as bright in linear, as the game multiplies it: darker below 1;
 * above 1 each channel grows and saturates (a red × 4 goes towards a hot pink-white, as in game),
 * the rest is the glow layer.
 */
const dimmed = (c, f) => (f === 1 ? c : c.map((v) => toSrgb(toLinear(v) * effective(c, f))));
/** How much a region glows at light `f` (already effective): 0 at × 1 or below, 1 at × 4. */
const glowOf = (f) => Math.min(1, Math.max(0, (f - 1) / 3));

// --- shared: the registry, the models, each species' pixel work -----------------
THREE.Cache.enabled = true;

const registryReady = fetch('/dino3d/registry.json').then((r) => r.json()).catch(() => null);
let registry = null;
registryReady.then((r) => { registry = r; });
const versioned = (path) => { const f = registry?.files?.[path]; return f?.sha256 ? `${path}?v=${f.sha256.slice(0, 12)}` : path; };

// Every model and texture through one queue: at most FETCH_AT_ONCE at a time, a
// 503 / 429 / network error tried again a little later. Five garage slots
// asked for 20 files at once and the proxy in front of the site answered 503
// to most (2026-10-03): no slot showed its dino, the 503 page fed to the image
// decoder ("source image could not be decoded"). As the mutation icons (mut-icons.js).
// After a refusal, one at a time for a while (the proxy is busy), then two again.
const FETCH_AT_ONCE = 2;
const FETCH_TRIES = 8;
const CALM_MS = 10000;
let fetching = 0, refusedAt = 0;
const waiting = [];
const atOnce = () => (Date.now() - refusedAt < CALM_MS ? 1 : FETCH_AT_ONCE);
async function slot() {
  if (fetching < atOnce()) { fetching++; return; }
  await new Promise((go) => waiting.push(go));   // the slot is handed over by done()
}
function done() {
  fetching--;
  while (waiting.length && fetching < atOnce()) { fetching++; waiting.shift()(); }
}
async function fetchAsset(url) {
  for (let i = 1; ; i++) {
    await slot();
    let res = null, err = null;
    try { res = await fetch(url); } catch (e) { err = e; }
    if (res?.ok) {
      try { return await res.blob(); } finally { done(); }
    }
    done();
    const retry = res === null || res.status === 503 || res.status === 429 || res.status === 502;
    if (!retry || i >= FETCH_TRIES) throw err ?? new Error(`${url}: ${res.status}`);
    refusedAt = Date.now();
    await new Promise((r) => setTimeout(r, Math.min(8000, 300 * 2 ** i) + Math.random() * 400));
  }
}

async function imageData(url) {
  const bmp = await createImageBitmap(await fetchAsset(versioned(url)));
  const c = document.createElement('canvas');
  c.width = SIZE; c.height = SIZE;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0, SIZE, SIZE);
  bmp.close?.();
  return x.getImageData(0, 0, SIZE, SIZE).data;
}

/** Per pixel: nearest region, second nearest, and how much of the second (0–255). */
function classify(pattern) {
  const n = SIZE * SIZE;
  const a = new Uint8Array(n), b = new Uint8Array(n), t = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = pattern[i * 4], g = pattern[i * 4 + 1], bl = pattern[i * 4 + 2];
    if (r + g + bl < 60) continue;       // unused UV space: stays body, no blend
    // Squared distances to pick the two nearest (no square root per region).
    let d1 = Infinity, d2 = Infinity, i1 = 0, i2 = 0;
    for (let k = 0; k < CODES.length; k += 3) {
      const dr = r - CODES[k], dg = g - CODES[k + 1], db = bl - CODES[k + 2];
      const d = dr * dr + dg * dg + db * db;
      if (d < d1) { d2 = d1; i2 = i1; d1 = d; i1 = k / 3; } else if (d < d2) { d2 = d; i2 = k / 3; }
    }
    const s1 = Math.sqrt(d1), s2 = Math.sqrt(d2);
    a[i] = i1; b[i] = i2; t[i] = (s1 / (s1 + s2 || 1)) * 255;
  }
  return { a, b, t };
}

/** Per pixel shading 0–255 from the RAC map: crevices (blue) and surface detail (green). */
function shading(rac) {
  const n = SIZE * SIZE;
  const s = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const cav = rac[i * 4 + 2] / 255, det = (rac[i * 4 + 1] - 128) / 128;
    s[i] = Math.max(0, Math.min(255, Math.round(255 * (0.25 + 0.75 * cav) * (1 + 0.35 * det))));
  }
  return s;
}

// --- teeth, mouth, claws: from the model's bones and UV pieces ------------------
const PART_TEETH = 1, PART_MOUTH = 2, PART_CLAWS = 3;
const GLOSSY = 110;               // RAC red (roughness) below this: glossy (wet mouth, claws)
const TEETH_MAX_AREA = 0.006;     // a UV piece this small (of the whole square) on the head / jaw: a tooth…
const TOOTH_MAX_SIZE = 0.12;      // …small in the model too (of the head's size)…
const TOOTH_ROW_GAP = 0.1;        // …with other such pieces this close (of the head's size)…
const TOOTH_ROW_MIN = 2;          // …at least this many: a row of teeth, not a lone crest…
const TOOTH_BEHIND = -1.2;        // …and not farther behind the jaw's middle than this (in jaw half-lengths)

/** Per texel: 0, or PART_TEETH / PART_MOUTH / PART_CLAWS. */
function parts(gltf, rac) {
  const out = new Uint8Array(SIZE * SIZE);
  gltf.scene.traverse((o) => {
    if (!o.isSkinnedMesh || /eye/i.test(o.material?.name ?? '')) return;
    const g = o.geometry, uv = g.attributes.uv, j = g.attributes.skinIndex, w = g.attributes.skinWeight;
    if (!uv || !j || !w) return;
    const bones = o.skeleton.bones.map((b) => b.name);
    // The last segment of each toe / finger ("DinoLeftToe2-03" when -01…-03): where the claw is.
    const lastSeg = new Map();
    for (const n of bones) {
      const m = /^(.*(?:Toe|Finger)\d*)-(\d+)$/.exec(n);
      if (m) lastSeg.set(m[1], Math.max(lastSeg.get(m[1]) ?? 0, Number(m[2])));
    }
    // …or one bone for all the digits ("DinoLeftToes", Deinosuchus): the glossy part of it is the claws.
    const isTip = (n) => {
      if (/Claw|Toes$|Fingers$/.test(n)) return true;
      const m = /^(.*(?:Toe|Finger)\d*)-(\d+)$/.exec(n);
      return m !== null && Number(m[2]) === lastSeg.get(m[1]);
    };
    // Each vertex: the group of its main bone.
    const HEAD = 1, JAW = 2, TONGUE = 3, CLAW = 4, HYOID = 5;
    const vcat = new Uint8Array(uv.count);
    for (let v = 0; v < uv.count; v++) {
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) { const ww = w.getComponent(v, k); if (ww > bw) { bw = ww; best = j.getComponent(v, k); } }
      const n = bones[best] ?? '';
      // The hyoid also moves the throat's outer skin: it counts as mouth only where glossy.
      vcat[v] = /Tongue/.test(n) ? TONGUE : /Hyoid/.test(n) ? HYOID : /Jaw/.test(n) ? JAW : /Head/.test(n) ? HEAD : isTip(n) ? CLAW : 0;
    }
    // The mouth is around the tongue: its middle and reach (in the model), for the glossy skin nearby.
    const pos = g.attributes.position;
    let cx = 0, cy = 0, cz = 0, nt = 0;
    // (No tongue bone, Deinosuchus: the hyoid's skin stands in for it.)
    const core = uv.count > 0 && vcat.some((c) => c === TONGUE) ? TONGUE : HYOID;
    for (let v = 0; v < uv.count; v++) if (vcat[v] === core) { cx += pos.getX(v); cy += pos.getY(v); cz += pos.getZ(v); nt++; }
    let reach = 0;
    if (nt > 0) {
      cx /= nt; cy /= nt; cz /= nt;
      for (let v = 0; v < uv.count; v++) if (vcat[v] === core) reach = Math.max(reach, Math.hypot(pos.getX(v) - cx, pos.getY(v) - cy, pos.getZ(v) - cz));
    }
    /** A triangle within `k` × the tongue's reach of its middle. */
    const nearTongue = (vs, k) => {
      if (nt === 0) return false;
      const x = (pos.getX(vs[0]) + pos.getX(vs[1]) + pos.getX(vs[2])) / 3, y = (pos.getY(vs[0]) + pos.getY(vs[1]) + pos.getY(vs[2])) / 3,
        z = (pos.getZ(vs[0]) + pos.getZ(vs[1]) + pos.getZ(vs[2])) / 3;
      return Math.hypot(x - cx, y - cy, z - cz) <= reach * k;
    };
    const idx = g.index ? g.index.array : Uint32Array.from({ length: uv.count }, (_, i) => i);
    // UV pieces: vertices joined by triangles (a UV seam splits vertices, so a piece is an island).
    const parent = Int32Array.from({ length: uv.count }, (_, i) => i);
    const root = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let t = 0; t < idx.length; t += 3) {
      const a = root(idx[t]), b = root(idx[t + 1]), c = root(idx[t + 2]);
      parent[b] = a; parent[root(c)] = a;
    }
    const areaOf = new Map();
    const triArea = (t) => {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      return Math.abs((uv.getX(b) - uv.getX(a)) * (uv.getY(c) - uv.getY(a)) - (uv.getY(b) - uv.getY(a)) * (uv.getX(c) - uv.getX(a))) / 2;
    };
    for (let t = 0; t < idx.length; t += 3) { const r = root(idx[t]); areaOf.set(r, (areaOf.get(r) ?? 0) + triArea(t)); }
    // Teeth come in rows: a small piece on the head / jaw (on the UV map AND in the model)
    // with other such pieces right beside it. A crest, a cheek boss, a horn stands alone.
    const pieceInfo = new Map();   // root -> { n, x, y, z, min[3], max[3], head }
    const hb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let v = 0; v < uv.count; v++) {
      const r = root(v), c = vcat[v];
      const q = [pos.getX(v), pos.getY(v), pos.getZ(v)];
      if (c === HEAD || c === JAW) for (let k = 0; k < 3; k++) { hb[k] = Math.min(hb[k], q[k]); hb[k + 3] = Math.max(hb[k + 3], q[k]); }
      let pi = pieceInfo.get(r);
      if (!pi) { pi = { n: 0, head: 0, s: [0, 0, 0], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; pieceInfo.set(r, pi); }
      pi.n++; if (c === HEAD || c === JAW) pi.head++;
      for (let k = 0; k < 3; k++) { pi.s[k] += q[k]; pi.min[k] = Math.min(pi.min[k], q[k]); pi.max[k] = Math.max(pi.max[k], q[k]); }
    }
    const headDiag = Number.isFinite(hb[0]) ? Math.hypot(hb[3] - hb[0], hb[4] - hb[1], hb[5] - hb[2]) : 0;
    // "Up" in the head: from the lower jaw's middle to the skull's. A tooth is below the
    // skull's middle; a brow spike or a crest above it.
    const mid = (cat0) => {
      const m = [0, 0, 0]; let n = 0;
      for (let v = 0; v < uv.count; v++) if (vcat[v] === cat0) { m[0] += pos.getX(v); m[1] += pos.getY(v); m[2] += pos.getZ(v); n++; }
      return n ? m.map((x) => x / n) : null;
    };
    const skull = mid(HEAD), jaw = mid(JAW);
    const up = skull && jaw ? [skull[0] - jaw[0], skull[1] - jaw[1], skull[2] - jaw[2]] : null;
    const below = (x, y, z) => !up || ((x - skull[0]) * up[0] + (y - skull[1]) * up[1] + (z - skull[2]) * up[2]) < 0;
    // "Forward" along the jaw: from its middle to its tip (its point farthest from the skull's
    // middle). A tooth is not far behind the jaw's middle; a quill down the neck is.
    let jawTip = null, far = -1;
    if (skull && jaw) for (let v = 0; v < uv.count; v++) {
      if (vcat[v] !== JAW) continue;
      const d = (pos.getX(v) - skull[0]) ** 2 + (pos.getY(v) - skull[1]) ** 2 + (pos.getZ(v) - skull[2]) ** 2;
      if (d > far) { far = d; jawTip = [pos.getX(v), pos.getY(v), pos.getZ(v)]; }
    }
    const fwd = jawTip ? [jawTip[0] - jaw[0], jawTip[1] - jaw[1], jawTip[2] - jaw[2]] : null;
    const fwdLen2 = fwd ? fwd[0] ** 2 + fwd[1] ** 2 + fwd[2] ** 2 : 0;
    // projection / |fwd|² : 0 at the jaw's middle, 1 at its tip, -1 one jaw-half behind.
    const alongJaw = (x, y, z) => !fwd || fwdLen2 === 0 ? 0 : ((x - jaw[0]) * fwd[0] + (y - jaw[1]) * fwd[1] + (z - jaw[2]) * fwd[2]) / fwdLen2;
    const cands = [];
    for (const [r, pi] of pieceInfo) {
      const extent = Math.hypot(pi.max[0] - pi.min[0], pi.max[1] - pi.min[1], pi.max[2] - pi.min[2]);
      if (pi.head / pi.n < 0.5 || (areaOf.get(r) ?? 1) >= TEETH_MAX_AREA || extent > headDiag * TOOTH_MAX_SIZE) continue;
      const cx0 = pi.s[0] / pi.n, cy0 = pi.s[1] / pi.n, cz0 = pi.s[2] / pi.n;
      if (!below(cx0, cy0, cz0) || alongJaw(cx0, cy0, cz0) < TOOTH_BEHIND) continue;
      cands.push([r, cx0, cy0, cz0]);
    }
    const teethPieces = new Set();
    const near2 = (headDiag * TOOTH_ROW_GAP) ** 2;
    for (const [r, x, y, z] of cands) {
      let neighbours = 0;
      for (const [r2, x2, y2, z2] of cands) {
        if (r2 !== r && (x - x2) ** 2 + (y - y2) ** 2 + (z - z2) ** 2 <= near2) neighbours++;
        if (neighbours >= TOOTH_ROW_MIN) break;
      }
      if (neighbours >= TOOTH_ROW_MIN) teethPieces.add(r);
    }

    const toothTris = [];
    // Paint each triangle's texels with its part.
    for (let t = 0; t < idx.length; t += 3) {
      const vs = [idx[t], idx[t + 1], idx[t + 2]];
      const cats = vs.map((v) => vcat[v]).sort();
      const cat = cats[1];                               // the triangle's main group
      if (cat === 0) continue;
      const small = (areaOf.get(root(vs[0])) ?? 1) < TEETH_MAX_AREA;
      const mouthy = (cat === HEAD || cat === JAW || cat === HYOID) && nearTongue(vs, 1.6);
      // A tooth gets its own material (below), not texels: some models reuse the teeth's
      // texture area elsewhere (Dilophosaurus' neck quills) and would turn tooth-coloured.
      if (teethPieces.has(root(vs[0]))) { toothTris.push(t); continue; }
      const p = vs.map((v) => [uv.getX(v) * SIZE, uv.getY(v) * SIZE]);
      const minX = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0]))), maxX = Math.min(SIZE - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])));
      const minY = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1]))), maxY = Math.min(SIZE - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])));
      const A = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
      if (A === 0) continue;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const qx = x + 0.5, qy = y + 0.5;
          const w0 = ((p[2][0] - p[1][0]) * (qy - p[1][1]) - (p[2][1] - p[1][1]) * (qx - p[1][0])) / A;
          const w1 = ((p[0][0] - p[2][0]) * (qy - p[2][1]) - (p[0][1] - p[2][1]) * (qx - p[2][0])) / A;
          if (w0 < -0.02 || w1 < -0.02 || w0 + w1 > 1.02) continue;
          const i = y * SIZE + x;
          const glossy = rac ? rac[i * 4] < GLOSSY : false;
          let part = 0;
          if (cat === TONGUE) part = PART_MOUTH;
          else if (cat === HEAD || cat === JAW || cat === HYOID) part = (glossy && mouthy && !small) ? PART_MOUTH : 0;
          else if (cat === CLAW) part = glossy ? PART_CLAWS : 0;
          if (part) out[i] = part;
        }
      }
    }
    // The teeth as the geometry's second group (material 1); the rest stays group 0.
    if (toothTris.length > 0 && g.index) {
      const isTooth = new Uint8Array(idx.length / 3);
      for (const t of toothTris) isTooth[t / 3] = 1;
      const order = new Uint32Array(idx.length);
      let k = 0;
      for (const pass of [0, 1]) for (let t = 0; t < idx.length; t += 3) if (isTooth[t / 3] === pass) { order[k++] = idx[t]; order[k++] = idx[t + 1]; order[k++] = idx[t + 2]; }
      g.setIndex(new THREE.BufferAttribute(order, 1));
      g.clearGroups();
      g.addGroup(0, idx.length - toothTris.length * 3, 0);
      g.addGroup(idx.length - toothTris.length * 3, toothTris.length * 3, 1);
    }
  });
  return out;
}

const speciesCache = new Map();   // name -> Promise<{ gltf, classes, shade, normal, parts }>
function loadSpecies(name) {
  if (!speciesCache.has(name)) {
    const sp = registry.species[name];
    const p = (async () => {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const patternUrl = sp.patterns?.['1'] ?? Object.values(sp.patterns ?? {})[0];
      const glbPath = sp.glbModel.slice(0, sp.glbModel.lastIndexOf('/') + 1);
      const [gltf, pattern, rac, normal] = await Promise.all([
        fetchAsset(versioned(sp.glbModel)).then((b) => b.arrayBuffer()).then((buf) => loader.parseAsync(buf, glbPath)),
        imageData(patternUrl),
        sp.racMap ? imageData(sp.racMap) : null,
        sp.normalMap ? fetchAsset(versioned(sp.normalMap)).then((b) => createImageBitmap(b, { imageOrientation: 'none' })).then((bmp) => {
          const t = new THREE.Texture(bmp);
          t.needsUpdate = true;
          return t;
        }) : null,
      ]);
      if (normal) { normal.flipY = false; normal.colorSpace = THREE.NoColorSpace; }
      return { gltf, classes: classify(pattern), shade: rac ? shading(rac) : new Uint8Array(SIZE * SIZE).fill(230), normal,
        parts: parts(gltf, rac) };
    })();
    p.catch(() => speciesCache.delete(name));
    speciesCache.set(name, p);
  }
  return speciesCache.get(name);
}

/** "BP_Deinosuchus_C" / "Deinosuchus" → the registry's name, or null. */
function speciesOf(raw) {
  if (!registry || !raw) return null;
  const short = String(raw).split('.').pop().replace(/^BP_/, '').replace(/_C$/, '').toLowerCase();
  return Object.keys(registry.species).find((k) => k.toLowerCase() === short) ?? null;
}

// --- when to draw ------------------------------------------------------------------
// In the launcher the page counts as visible even in the tray or behind the game (its window keeps
// backgroundThrottling off, for the voice and the overlay): document.hidden stays false there. The 3D
// went on drawing every frame while the owner played — in software WebGL (GPU off: SwiftShader),
// 8 threads at 60 % each, the game's FPS from 40-60 down to 20-30 (2026-10-04). Not focused in the
// launcher = nobody looks at it: nothing drawn (the same test as app.js's background redraw).
// Shown from the tray, GNOME may leave the focus where it was: the mouse over the page (moved, clicked,
// scrolled, a key) in the last POINTER_MS counts as looked at too. In the game the mouse is the game's.
const POINTER_MS = 10000;
let lastPointer = 0;
for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown']) {
  window.addEventListener(ev, () => { lastPointer = Date.now(); }, { passive: true, capture: true });
}
const offScreen = () => document.hidden
  || (Boolean(window.isleLauncher) && !document.hasFocus() && Date.now() - lastPointer > POINTER_MS);
// Software WebGL (no GPU: SwiftShader, llvmpipe) draws on the CPU: at most this many frames a second.
const SOFTWARE_FPS = 24;
function softwareGL(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    return /swiftshader|llvmpipe|softpipe|software/i.test(name);
  } catch {
    return false;
  }
}
/** A frame gate: true when this frame should be drawn (all frames on a GPU, SOFTWARE_FPS without one). */
function frameGate(renderer) {
  const gap = softwareGL(renderer) ? 1000 / SOFTWARE_FPS : 0;
  let last = 0;
  return (now) => {
    if (now - last < gap) return false;
    last = now;
    return true;
  };
}

// --- one viewer ------------------------------------------------------------------
/**
 * A 3D view in `host`. opts: { note (element for a status line), interactive
 * (orbit, default true), autoRotate, fit (camera distance / model size, 1.5),
 * alwaysRender (test pages: draw in a background tab too) }. Returns { show(species, skin), setSkin,
 * setFemale, name() }. skin: { colors: { Body: "#rrggbb"… }, female?, glow?, effects? }.
 */
function create(host, opts = {}) {
  let renderer = null, scene = null, camera = null, controls = null, mixer = null, clock = null;
  let current = null, lastSkin = null, female = false, loading = 0, sizeW = 0, sizeH = 0;
  // Frames owed to a change (a model, a skin): drawn even off screen, so a garage slot or the skin
  // editor shows the dino still while the launcher is not focused (only the turning waits).
  let owed = 0;
  const note = (t) => { if (opts.note) opts.note.textContent = t ?? ''; };

  function ensureRenderer() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334422, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(4, 8, 6);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.7);
    fill.position.set(-6, 3, -4);
    scene.add(fill);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.enabled = opts.interactive !== false;
    controls.enableZoom = opts.interactive !== false;
    controls.autoRotate = opts.autoRotate === true;
    controls.autoRotateSpeed = 1.2;
    clock = new THREE.Clock();
    const due = frameGate(renderer);
    const loop = (now = 0) => {
      requestAnimationFrame(loop);
      if (!host.isConnected || host.hidden || !host.offsetParent) return;   // not shown: nothing to draw
      const idle = offScreen() && !opts.alwaysRender;
      if (idle ? owed <= 0 : !due(now)) return;
      if (owed > 0) owed--;
      // Follow the box's size here: the tab can be hidden when the model loads (0 × 0).
      const w = host.clientWidth, h = host.clientHeight;
      if (w > 0 && h > 0 && (w !== sizeW || h !== sizeH)) {
        sizeW = w; sizeH = h;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      mixer?.update(clock.getDelta());
      controls.update();
      renderer.render(scene, camera);
    };
    loop();
  }

  function paint() {
    owed = 2;
    if (!current || !lastSkin) return;
    const lightOf = (id) => (lastSkin.light?.[id] ?? 1) * (lastSkin.brightness ?? 1);
    const regionOf = (id) => (female && id === 'MaleDisplay' ? 'Body' : id);
    const raw = REGION_CODES.map(([id]) => srgb(lastSkin.colors?.[regionOf(id)] ?? '#808080'));
    const cols = REGION_CODES.map(([id], k) => dimmed(raw[k], lightOf(regionOf(id))));
    const glows = REGION_CODES.map(([id], k) => glowOf(effective(raw[k], lightOf(regionOf(id)))));
    const { a, b, t } = current.shared.classes;
    const sh = current.shared.shade, pt = current.shared.parts;
    // Teeth, mouth, claws: their own colours (index = PART_*).
    const PART_IDS = [null, 'Teeth', 'Mouth', 'Claws'];
    const partRaw = [null, srgb(lastSkin.colors?.Teeth ?? '#e6dcc4'), srgb(lastSkin.colors?.Mouth ?? '#7a3b3b'), srgb(lastSkin.colors?.Claws ?? '#3a3a3a')];
    const partCols = partRaw.map((c, k) => (c ? dimmed(c, lightOf(PART_IDS[k])) : null));
    const partGlows = PART_IDS.map((id, k) => (id ? glowOf(effective(partRaw[k], lightOf(id))) : 0));
    const glowing = glows.some((g) => g > 0) || partGlows.some((g) => g > 0);
    const img = current.ctx.createImageData(SIZE, SIZE);
    const d = img.data;
    // The glow layer: each region's colour × how much it glows (black where it does not).
    if (glowing && !current.emCtx) {
      const em = document.createElement('canvas');
      em.width = SIZE; em.height = SIZE;
      current.emCtx = em.getContext('2d');
      current.emTexture = new THREE.CanvasTexture(em);
      current.emTexture.colorSpace = THREE.SRGBColorSpace;
      current.emTexture.flipY = false;
    }
    const emImg = glowing ? current.emCtx.createImageData(SIZE, SIZE) : null;
    const e = emImg?.data;
    for (let i = 0, n = SIZE * SIZE; i < n; i++) {
      const s = sh[i] / 255;
      const pc = pt[i] ? partCols[pt[i]] : null;
      if (pc) {
        d[i * 4] = pc[0] * s; d[i * 4 + 1] = pc[1] * s; d[i * 4 + 2] = pc[2] * s; d[i * 4 + 3] = 255;
        if (e) { const g = partGlows[pt[i]]; e[i * 4] = pc[0] * g; e[i * 4 + 1] = pc[1] * g; e[i * 4 + 2] = pc[2] * g; e[i * 4 + 3] = 255; }
        continue;
      }
      const c1 = cols[a[i]], c2 = cols[b[i]], w = t[i] / 255;
      d[i * 4] = (c1[0] + (c2[0] - c1[0]) * w) * s;
      d[i * 4 + 1] = (c1[1] + (c2[1] - c1[1]) * w) * s;
      d[i * 4 + 2] = (c1[2] + (c2[2] - c1[2]) * w) * s;
      d[i * 4 + 3] = 255;
      if (e) {
        const g1 = glows[a[i]] * (1 - w), g2 = glows[b[i]] * w;
        e[i * 4] = c1[0] * g1 + c2[0] * g2; e[i * 4 + 1] = c1[1] * g1 + c2[1] * g2; e[i * 4 + 2] = c1[2] * g1 + c2[2] * g2; e[i * 4 + 3] = 255;
      }
    }
    if (emImg) { current.emCtx.putImageData(emImg, 0, 0); current.emTexture.needsUpdate = true; }
    const fx = lastSkin.effects;
    const tints = fx ? FX_TINTS.filter(([id]) => (fx[id] ?? 0) > 0).map(([id, c, k]) => [c, fx[id] * k]) : [];
    if (tints.length > 0) {
      for (let i = 0, n = SIZE * SIZE; i < n; i++) {
        const crease = 1.25 - sh[i] / 255;          // 0.25 on flat skin … 1.25 in a crevice
        for (const [c, amt] of tints) {
          const w = Math.min(1, amt * crease);
          d[i * 4] += (c[0] - d[i * 4]) * w;
          d[i * 4 + 1] += (c[1] - d[i * 4 + 1]) * w;
          d[i * 4 + 2] += (c[2] - d[i * 4 + 2]) * w;
        }
      }
    }
    current.ctx.putImageData(img, 0, 0);
    current.texture.needsUpdate = true;
    const wet = fx?.Wet ?? 0, glow = Math.max(1, lastSkin.glow ?? 1);
    for (const m of current.bodyMats) {
      m.roughness = 0.82 - 0.62 * wet;
      if (glowing) {
        m.emissiveMap = current.emTexture;
        m.emissive.setRGB(1, 1, 1);
        m.emissiveIntensity = 2.2;
      } else {
        m.emissiveMap = glow > 1 ? current.texture : null;
        m.emissive.setRGB(glow > 1 ? 1 : 0, glow > 1 ? 1 : 0, glow > 1 ? 1 : 0);
        m.emissiveIntensity = (glow - 1) * 0.55;
      }
      m.needsUpdate = true;
    }
    // Eyes and teeth have their own materials: their colour, darker or glowing as their light says.
    const solid = (mats, id, fallback) => {
      const c0 = srgb(lastSkin.colors?.[id] ?? fallback);
      const c = dimmed(c0, lightOf(id));
      const g = glowOf(effective(c0, lightOf(id)));
      for (const m of mats) {
        m.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
        m.emissive.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
        m.emissiveIntensity = g * 2.2;
      }
    };
    solid(current.eyeMats, 'Eyes', '#806020');
    solid(current.teethMats, 'Teeth', '#e6dcc4');
  }

  let paintQueued = false;
  function schedulePaint() {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => { paintQueued = false; paint(); });
  }

  async function showSpecies(name) {
    await registryReady;
    if (!registry?.species?.[name]) { note('Chưa có mô hình 3D cho loài này.'); return false; }
    if (current?.name === name) return true;
    const my = ++loading;
    note(`Đang tải mô hình ${name}…`);
    try {
      const shared = await loadSpecies(name);
      if (my !== loading) return false;          // another species was asked for meanwhile
      ensureRenderer();
      if (current) { scene.remove(current.root); current.texture.dispose(); current.emTexture?.dispose(); }
      mixer?.stopAllAction();
      const canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;               // glTF UVs
      const root = cloneSkinned(shared.gltf.scene);
      const bodyMats = [], eyeMats = [], teethMats = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.frustumCulled = false;
        const eye = /eye/i.test(o.material?.name ?? '');
        const m = new THREE.MeshStandardMaterial({ roughness: eye ? 0.15 : 0.82, metalness: 0 });
        if (eye) { eyeMats.push(m); o.material = m; return; }
        m.map = texture; if (shared.normal) m.normalMap = shared.normal; bodyMats.push(m);
        if (o.geometry.groups.length === 2) {
          const tm = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0 });
          if (shared.normal) tm.normalMap = shared.normal;
          teethMats.push(tm);
          o.material = [m, tm];
        } else o.material = m;
      });
      const sp = registry.species[name];
      root.scale.setScalar(sp.glbScale ?? 0.03);
      root.position.set(...(sp.glbPosition ?? [0, -2.4, 0]));
      scene.add(root);
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
      // Framed from the side; a small view (a garage slot) comes closer.
      const dist = Math.max(size.x, size.y, size.z) * (opts.fit ?? 1.5) + 1;
      controls.target.copy(mid);
      camera.position.set(mid.x + dist * 0.85, mid.y + dist * 0.25, mid.z + dist * 0.75);
      camera.near = dist / 100; camera.far = dist * 10; camera.updateProjectionMatrix();
      controls.minDistance = dist * 0.35; controls.maxDistance = dist * 3;
      mixer = new THREE.AnimationMixer(root);
      if (shared.gltf.animations?.[0]) mixer.clipAction(shared.gltf.animations[0]).play();
      current = { name, root, bodyMats, eyeMats, teethMats, texture, ctx: canvas.getContext('2d'), shared };
      paint();
      note(opts.interactive === false ? '' : 'Kéo để xoay · cuộn để phóng to.');
      return true;
    } catch (err) {
      if (my === loading) { console.error('[skin3d]', err); note('Không tải được mô hình 3D.'); }
      return false;
    }
  }

  return {
    /** Species (a class or a registry name) and a skin: true when shown. */
    async show(rawSpecies, skin) {
      await registryReady;
      if (skin) { lastSkin = skin; if (typeof skin.female === 'boolean') female = skin.female; }
      const name = speciesOf(rawSpecies) ?? rawSpecies;
      const ok = await showSpecies(name);
      if (ok) schedulePaint();
      return ok;
    },
    setSkin(skin) { lastSkin = skin; schedulePaint(); },
    setFemale(f) { female = f; schedulePaint(); },
    name() { return current?.name ?? null; },
    /** Test pages only: look at the head from `side` (x, y, z offsets in head sizes). */
    lookAtHead(side = [1, 0.3, 0.6], zoom = 1) {
      const head = current?.root.getObjectByName('DinoHead');
      if (!head) return false;
      current.root.updateMatrixWorld(true);
      const p = head.getWorldPosition(new THREE.Vector3());
      const box = new THREE.Box3().setFromObject(current.root);
      const r = box.getSize(new THREE.Vector3()).length() * 0.12 / zoom;
      controls.target.copy(p);
      camera.position.set(p.x + side[0] * r, p.y + side[1] * r, p.z + side[2] * r);
      camera.near = r / 50; camera.updateProjectionMatrix();
      controls.minDistance = 0; controls.maxDistance = Infinity; mixer?.stopAllAction();
      return { head: p.toArray().map((x) => +x.toFixed(2)), r: +r.toFixed(2), camera: camera.position.toArray().map((x) => +x.toFixed(2)) };
    },
  };
}

/**
 * A skin as the game holds it (linear colours, maybe above 1; female; from
 * /api/me or a garage slot) → the viewer's form (sRGB "#rrggbb" + glow).
 */
function fromGame(skin) {
  if (!skin?.colors) return null;
  const colors = {}, light = {};
  for (const [k, c] of Object.entries(skin.colors)) {
    // Exactly black: a region this species does not use (the game leaves it 0, 0, 0), not painted black.
    if (!c || (c.r === 0 && c.g === 0 && c.b === 0)) continue;
    // A channel above 1 (a skin made brighter than a player can pick): that region glows.
    const top = Math.max(1, c.r ?? 0, c.g ?? 0, c.b ?? 0);
    if (top > 1) light[k] = top;
    const ch = (v) => Math.round(toSrgb((Number(v) || 0) / top)).toString(16).padStart(2, '0');
    colors[k] = `#${ch(c.r)}${ch(c.g)}${ch(c.b)}`;
  }
  for (const [k, stand] of Object.entries(STAND_IN)) if (!colors[k]) colors[k] = typeof stand === 'function' ? stand(colors) : stand;
  return { colors, female: skin.female === true, light };
}

/** What an unused (black) region is shown as. Detail1 follows the markings. */
const STAND_IN = {
  Detail1: (c) => c.Markings ?? '#3a3530', Eyes: '#b08a2a', Teeth: '#e6dcc4', Mouth: '#8a4a45', Claws: '#3a3632',
};

window.Dino3D = { create, fromGame, standIn: STAND_IN, speciesOf: (raw) => speciesOf(raw), ready: registryReady,
  /** The species that have a 3D model (registry names). */
  species: () => Object.keys(registry?.species ?? {}).sort() };

// --- the skin editor (tab Skin) ---------------------------------------------------
(() => {
  const $ = (id) => document.getElementById(id);
  // The species: a <select> (the system's select box, ui-select.js).
  const picker = $('skin-species');
  if (!picker) return;
  const genderBox = $('skin-gender');
  const viewer = create($('skin-3d'), { note: $('skin-preview-note') });
  let chosen = null, liveKey = null, liveName = null, lastSkin = null, started = false;

  function renderMenu() {
    const names = Object.keys(registry?.species ?? {}).sort();
    picker.innerHTML = names.map((n) => `<option value="${n}">${n}${n === liveName ? ' · đang chơi' : ''}</option>`).join('');
    picker.value = chosen ?? '';
  }
  async function pick(name) {
    if (!registry?.species?.[name]) return;
    chosen = name;
    renderMenu();
    const shown = await viewer.show(name, lastSkin);
    $('skin-3d').hidden = !shown;
    $('skin-flat').hidden = shown;
  }
  picker.addEventListener('change', () => { void pick(picker.value); });

  function setFemale(f) {
    for (const b of genderBox.querySelectorAll('button')) {
      const on = (b.dataset.g === 'f') === f;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    // The display colour means nothing on a female: dim its picker.
    document.querySelector('#skin-regions-grid [data-region="MaleDisplay"]')?.classList.toggle('off', f);
    viewer.setFemale(f);
  }
  genderBox.addEventListener('click', (e) => { const b = e.target.closest('button[data-g]'); if (b) setFemale(b.dataset.g === 'f'); });

  window.skin3d = {
    setSkin(skin) { lastSkin = skin; viewer.setSkin(skin); },
    /** The dino played now: a new one (or the first seen) is shown at once, over what was picked. */
    follow(rawSpecies, isFemale) {
      window.skin3dLive = { species: rawSpecies, female: isFemale };
      if (!registry || !started) return;
      const name = speciesOf(rawSpecies);
      const key = `${name}|${isFemale === true}`;
      if (name !== liveName) { liveName = name; renderMenu(); }
      if (!name || key === liveKey) return;
      liveKey = key;
      if (typeof isFemale === 'boolean') setFemale(isFemale);
      void pick(name, false);
    },
  };

  // Nothing is loaded until the Skin tab is shown: a visit to the home page
  // should not pay for a model it does not show.
  const preview = $('skin-preview');
  const start = () => {
    if (!preview.offsetParent) { setTimeout(start, 400); return; }
    registryReady.then(() => {
      if (!registry) { picker.innerHTML = '<option value="">—</option>'; $('skin-preview-note').textContent = 'Chưa có mô hình 3D trên server, xem màu theo từng ô.'; return; }
      lastSkin = lastSkin ?? window.skin3dLastSkin ?? null;
      started = true;
      const live = window.skin3dLive;
      if (live && speciesOf(live.species)) { liveKey = null; window.skin3d.follow(live.species, live.female); }
      else void pick(Object.keys(registry.species).sort()[0], false);
    });
  };
  start();
})();

// --- 3D DINO HUNT STAGE: T-Rex Huyết Long hunting Gallimimus on Home ---
function initHuntStage() {
  const container = document.getElementById('dino-hunt-card');
  const host = document.getElementById('hunt-viewport');
  const btnAction = document.getElementById('btn-hunt-action');
  const loadingEl = document.getElementById('hunt-loading');
  const vignetteEl = document.getElementById('hunt-impact-vignette');
  const btnTitle = document.getElementById('hunt-btn-title');
  const btnSub = document.getElementById('hunt-btn-sub');
  const ctaText = document.getElementById('hunt-cta-text');

  if (!container || !host || !btnAction) return;

  let renderer = null, scene = null, camera = null, controls = null;
  let mixerTrex = null, mixerGalli = null, clock = null;
  let trexRoot = null, galliRoot = null;
  let trexJaw = null, trexHead = null;
  let particlesMesh = null;
  let sparkVels = [];
  let sparksExploded = false;
  let huntPhase = 'idle'; // 'idle' | 'hunting' | 'caught'
  let huntStartTime = 0;
  let sizeW = 0, sizeH = 0;

  // Safe fallback if click happens before 3D is ready
  let isSteamConnecting = false;
  const doConnectSteam = () => {
    if (isSteamConnecting) return;
    isSteamConnecting = true;
    window.location.href = 'steam://connect/play.xomgay.online:7777';
  };

  btnAction.addEventListener('click', (e) => {
    e.preventDefault();
    if (huntPhase === 'hunting' || huntPhase === 'caught') return;
    if (!trexRoot || !galliRoot) {
      doConnectSteam();
      return;
    }
    triggerCatch();
  });

  async function setup3D() {
    await registryReady;
    if (!registry?.species?.Tyrannosaurus || !registry?.species?.Gallimimus) {
      if (loadingEl) loadingEl.textContent = 'Chưa có mô hình 3D trên máy chủ.';
      return;
    }

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x060b16, 0.038);

    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 1.2, 13.5);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minPolarAngle = Math.PI / 3.2;
    controls.target.set(0, 0.45, 0);

    // Cinematic Lighting
    const hemiLight = new THREE.HemisphereLight(0xa5f3fc, 0x050912, 1.3);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 2.3);
    sunLight.position.set(5, 8, 4);
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0x10b981, 2.8);
    rimLight.position.set(-6, 3, -4);
    scene.add(rimLight);

    const fillLight = new THREE.DirectionalLight(0x06b6d4, 1.0);
    fillLight.position.set(0, -1, 5);
    scene.add(fillLight);

    // Ground Disc & Grid Accent
    const groundGeo = new THREE.CircleGeometry(16, 48);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x070c18,
      roughness: 0.9,
      metalness: 0.08
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.92;
    scene.add(ground);

    const grid = new THREE.GridHelper(26, 26, 0x10b981, 0x0c1e30);
    grid.position.y = -0.91;
    grid.material.opacity = 0.22;
    grid.material.transparent = true;
    scene.add(grid);

    // Floating Prehistoric Spores
    const pCount = 50;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 16;
      pPos[i * 3 + 1] = -0.9 + Math.random() * 3.5;
      pPos[i * 3 + 2] = (Math.random() - 0.5) * 10;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({
      color: 0x34d399,
      size: 0.06,
      transparent: true,
      opacity: 0.55
    });
    const spores = new THREE.Points(pGeo, pMat);
    scene.add(spores);

    // Load Tyrannosaurus and Gallimimus
    const [trexShared, galliShared] = await Promise.all([
      loadSpecies('Tyrannosaurus'),
      loadSpecies('Gallimimus')
    ]);

    // Build Tyrannosaurus với bộ Skin Huyết Long
    const trexSkinCols = {
      Body: '#6e1414',
      Flank: '#4d0e0e',
      Underbelly: '#b85c5c',
      Markings: '#1f0505',
      MaleDisplay: '#ff1a1a',
      Detail1: '#3a0a0a',
      Eyes: '#ffdd00',
      Teeth: '#e8d7c9',
      Mouth: '#9e2b2b',
      Claws: '#140606'
    };
    const trexInst = buildDinoMesh(trexShared, 'Tyrannosaurus', trexSkinCols);
    trexRoot = trexInst.root;
    mixerTrex = trexInst.mixer;
    trexRoot.position.set(-2.5, -0.80, -0.2);
    trexRoot.rotation.set(0, Math.PI * 0.44, 0);
    scene.add(trexRoot);

    trexJaw = trexRoot.getObjectByName('DinoJaw');
    trexHead = trexRoot.getObjectByName('DinoHead') || trexRoot.getObjectByName('PreviewHead');

    // Build Galli
    const galliSkinCols = {
      Body: '#3d5a80', Flank: '#98c1d9', Underbelly: '#e0fbfc',
      Markings: '#ee6c4d', MaleDisplay: '#ee6c4d', Detail1: '#293241',
      Eyes: '#22d3ee', Teeth: '#e6dcc4', Mouth: '#7a3b3b', Claws: '#293241'
    };
    const galliInst = buildDinoMesh(galliShared, 'Gallimimus', galliSkinCols);
    galliRoot = galliInst.root;
    mixerGalli = galliInst.mixer;
    galliRoot.position.set(1.8, -0.90, 0.3);
    galliRoot.rotation.set(0, Math.PI * 0.38, 0);
    scene.add(galliRoot);

    // Dynamic Impact Sparks
    const sparkCount = 40;
    const sparkGeo = new THREE.BufferGeometry();
    const sparkPos = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i++) {
      sparkPos[i * 3] = 0; sparkPos[i * 3 + 1] = -100; sparkPos[i * 3 + 2] = 0;
      sparkVels.push({ x: 0, y: 0, z: 0, life: 0 });
    }
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    const sparkMat = new THREE.PointsMaterial({
      color: 0xef4444,
      size: 0.14,
      transparent: true,
      opacity: 0.95
    });
    particlesMesh = new THREE.Points(sparkGeo, sparkMat);
    scene.add(particlesMesh);

    clock = new THREE.Clock();
    if (loadingEl) loadingEl.style.display = 'none';

    // Animation Loop
    const due = frameGate(renderer);
    const loop = (now = 0) => {
      requestAnimationFrame(loop);
      if (!host.isConnected || host.hidden || offScreen() || !host.offsetParent) return;
      if (!due(now)) return;

      const w = host.clientWidth, h = host.clientHeight;
      if (w > 0 && h > 0 && (w !== sizeW || h !== sizeH)) {
        sizeW = w; sizeH = h;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }

      const delta = clock.getDelta();
      mixerTrex?.update(delta);
      mixerGalli?.update(delta);

      const t = clock.getElapsedTime();

      // Idle Mode: Stalking & Tense Pacing
      if (huntPhase === 'idle') {
        trexRoot.position.x = -2.5 + Math.sin(t * 1.2) * 0.16;
        trexRoot.position.y = -0.80 + Math.abs(Math.sin(t * 2.4)) * 0.035;
        trexRoot.rotation.z = Math.sin(t * 1.2) * 0.018;

        galliRoot.position.x = 1.8 + Math.sin(t * 1.3 + 0.8) * 0.14;
        galliRoot.position.y = -0.90 + Math.abs(Math.sin(t * 3.0)) * 0.03;
        galliRoot.rotation.y = Math.PI * 0.38 + Math.sin(t * 0.9) * 0.10;

        if (trexJaw) trexJaw.rotation.x = Math.max(0, Math.sin(t * 1.6) * 0.12);
        camera.position.x = Math.sin(t * 0.35) * 0.25;
      }
      // Savage Catch Sequence!
      else if (huntPhase === 'hunting') {
        const elapsed = performance.now() - huntStartTime;

        // Phase 1: 0ms to 420ms (Lunge Strike)
        if (elapsed < 420) {
          const p = elapsed / 420;
          const ease = p * p;
          trexRoot.position.x = -2.5 + (1.1 - (-2.5)) * ease;
          trexRoot.position.z = -0.2 + (0.15 - (-0.2)) * p;
          trexRoot.position.y = -0.80 + Math.sin(p * Math.PI) * 0.28;
          trexRoot.rotation.z = -0.20 * p;
          if (trexJaw) trexJaw.rotation.x = 0.65 * p;

          galliRoot.position.x = 1.8 + 0.25 * p;
          galliRoot.rotation.z = 0.18 * p;
        }
        // Phase 2: 420ms to 780ms (Tackle & Catch)
        else if (elapsed < 780) {
          const p = (elapsed - 420) / 360;
          trexRoot.position.x = 1.1 + 0.08 * p;
          trexRoot.position.y = -0.80;
          trexRoot.rotation.z = -0.20 + 0.14 * p;
          if (trexJaw) trexJaw.rotation.x = Math.max(-0.05, 0.65 * (1 - p * 3));

          // Gallimimus gets tackled down!
          galliRoot.position.y = -0.90 - 0.2 * p;
          galliRoot.rotation.z = 0.18 - 1.35 * p;
          galliRoot.rotation.x = -0.32 * p;

          // Camera impact shake
          const shake = (1 - p) * 0.14;
          camera.position.x += (Math.random() - 0.5) * shake;
          camera.position.y = 1.2 + (Math.random() - 0.5) * shake;

          // Explode sparks on impact
          if (!sparksExploded) {
            sparksExploded = true;
            for (let i = 0; i < sparkCount; i++) {
              sparkPos[i * 3] = 1.1 + (Math.random() - 0.5) * 0.3;
              sparkPos[i * 3 + 1] = -0.7 + (Math.random() - 0.5) * 0.3;
              sparkPos[i * 3 + 2] = 0.2 + (Math.random() - 0.5) * 0.3;
              const spd = 2.5 + Math.random() * 4.5;
              const ang = Math.random() * Math.PI * 2;
              sparkVels[i] = {
                x: Math.cos(ang) * spd * 0.8,
                y: 1.5 + Math.random() * 3.5,
                z: Math.sin(ang) * spd * 0.8,
                life: 1.0
              };
            }
          }

          // Spark particles update
          for (let i = 0; i < sparkCount; i++) {
            if (sparkVels[i].life > 0) {
              sparkPos[i * 3] += sparkVels[i].x * delta;
              sparkPos[i * 3 + 1] += sparkVels[i].y * delta;
              sparkPos[i * 3 + 2] += sparkVels[i].z * delta;
              sparkVels[i].y -= 9.8 * delta;
              sparkVels[i].life -= delta * 1.5;
              if (sparkVels[i].life <= 0) sparkPos[i * 3 + 1] = -100;
            }
          }
          sparkGeo.attributes.position.needsUpdate = true;
        }
        // Phase 3: 780ms+ (Victory Stance & Connect)
        else {
          trexRoot.position.x = 1.18;
          trexRoot.position.y = -0.80;
          trexRoot.rotation.z = 0.08;
          if (trexHead) trexHead.rotation.x = -0.30;
          if (trexJaw) trexJaw.rotation.x = 0.24;

          galliRoot.position.y = -1.05;
          galliRoot.rotation.z = -1.15;

          if (elapsed >= 1100 && huntPhase === 'hunting') {
            huntPhase = 'caught';
            btnAction.classList.remove('hunting-charging');
            btnAction.classList.add('hunting-caught');
            doConnectSteam();
          }
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };
    loop();
  }

  function triggerCatch() {
    huntPhase = 'hunting';
    huntStartTime = performance.now();
    sparksExploded = false;

    btnAction.classList.add('hunting-charging');
    if (btnTitle) btnTitle.textContent = '🎯 ĐÃ TÓM ĐƯỢC CON MỒI!';
    if (btnSub) btnSub.textContent = 'T-Rex Huyết Long hạ gục Gallimimus! Đang kết nối vào máy chủ Xóm Gáy...';
    if (ctaText) ctaText.textContent = 'KẾT NỐI...';

    // Show impact flash
    if (vignetteEl) {
      setTimeout(() => {
        vignetteEl.classList.add('active');
        setTimeout(() => vignetteEl.classList.remove('active'), 380);
      }, 400);
    }

    // Auto-reset after 4.5s in case player returns to tab
    setTimeout(() => {
      if (huntPhase === 'caught') {
        huntPhase = 'idle';
        sparksExploded = false;
        btnAction.classList.remove('hunting-charging', 'hunting-caught');
        if (btnTitle) btnTitle.textContent = 'BẮT ĐẦU CHUYẾN SINH TỒN';
        if (btnSub) btnSub.textContent = 'Bấm để tóm gọn con mồi & vào thẳng máy chủ Xóm Gáy';
        if (ctaText) ctaText.textContent = 'CHƠI NGAY';
        if (galliRoot) {
          galliRoot.position.set(1.8, -0.90, 0.3);
          galliRoot.rotation.set(0, Math.PI * 0.38, 0);
        }
        if (trexRoot) {
          trexRoot.position.set(-2.5, -0.80, -0.2);
          trexRoot.rotation.set(0, Math.PI * 0.44, 0);
        }
        camera.position.set(0, 1.2, 13.5);
        if (trexJaw) trexJaw.rotation.x = 0;
        if (trexHead) trexHead.rotation.x = 0;
      }
    }, 4500);
  }

  function buildDinoMesh(shared, speciesName, skinColors) {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE; canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;

    const root = cloneSkinned(shared.gltf.scene);
    const bodyMats = [], eyeMats = [], teethMats = [];

    root.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const eye = /eye/i.test(o.material?.name ?? '');
      const m = new THREE.MeshStandardMaterial({ roughness: eye ? 0.15 : 0.82, metalness: 0.04 });
      if (eye) { eyeMats.push(m); o.material = m; return; }
      m.map = texture;
      if (shared.normal) m.normalMap = shared.normal;
      bodyMats.push(m);
      if (o.geometry.groups.length === 2) {
        const tm = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0 });
        if (shared.normal) tm.normalMap = shared.normal;
        teethMats.push(tm);
        o.material = [m, tm];
      } else {
        o.material = m;
      }
    });

    const sp = registry.species[speciesName];
    const baseScale = sp?.glbScale ?? 0.025;
    const scaleRatio = speciesName === 'Tyrannosaurus' ? 0.28 : (speciesName === 'Gallimimus' ? 0.225 : 0.30);
    root.scale.setScalar(baseScale * scaleRatio);

    // Paint texture
    const cols = REGION_CODES.map(([id]) => srgb(skinColors[id] ?? '#808080'));
    const { a, b, t } = shared.classes;
    const sh = shared.shade, pt = shared.parts;
    const partCols = [
      null,
      srgb(skinColors.Teeth ?? '#e6dcc4'),
      srgb(skinColors.Mouth ?? '#7a3b3b'),
      srgb(skinColors.Claws ?? '#3a3a3a')
    ];
    const img = ctx.createImageData(SIZE, SIZE);
    const d = img.data;
    for (let i = 0, n = SIZE * SIZE; i < n; i++) {
      const s = sh[i] / 255;
      const pc = pt[i] ? partCols[pt[i]] : null;
      if (pc) {
        d[i * 4] = pc[0] * s; d[i * 4 + 1] = pc[1] * s; d[i * 4 + 2] = pc[2] * s; d[i * 4 + 3] = 255;
        continue;
      }
      const c1 = cols[a[i]], c2 = cols[b[i]], w = t[i] / 255;
      d[i * 4] = (c1[0] + (c2[0] - c1[0]) * w) * s;
      d[i * 4 + 1] = (c1[1] + (c2[1] - c1[1]) * w) * s;
      d[i * 4 + 2] = (c1[2] + (c2[2] - c1[2]) * w) * s;
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    texture.needsUpdate = true;

    const eye = srgb(skinColors.Eyes ?? '#10b981');
    for (const m of eyeMats) m.color.setRGB(eye[0] / 255, eye[1] / 255, eye[2] / 255, THREE.SRGBColorSpace);

    let mixer = null;
    if (shared.gltf.animations?.[0]) {
      mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(shared.gltf.animations[0]).play();
    }

    return { root, mixer, texture };
  }

  setup3D().catch((err) => {
    console.error('[huntStage3d]', err);
    if (loadingEl) {
      loadingEl.style.display = 'none';
    }
  });
}

// Start the 3D Dino Hunt Stage on Home
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHuntStage);
} else {
  initHuntStage();
}

