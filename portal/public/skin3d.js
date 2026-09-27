// The dino in 3D, in its colours: the skin editor (tab Skin), the dino played
// now (tab Game) and each dino in the garage (tab Gara). One viewer per place
// (window.Dino3D.create), all sharing the models and the per-species work.
//
// Assets: /dino3d/registry.json + per species a .glb (EXT_meshopt_compression,
// materials MI_<Species>_Body / _Eye), a region map (…Pattern…png), a normal
// map and a RAC map — from sv1.datviet.app's IsleHub (the game's own art).
//
// The region map paints each skin region in a code colour: cyan body, blue
// flank, green underbelly, magenta markings, red male display, yellow detail
// (black = unused UV space); edges blend between two of them. Every pixel is
// classified ONCE per species (its two nearest regions and the blend between
// them); a colour change only re-mixes those — fast enough to follow a picker.
// Teeth, mouth and claws have no region there (the game masks them with a
// texture these assets lack): they are found on the model instead, once per
// species (parts()) — the mouth: skin on the tongue bones, or glossy skin
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
// Glow ("brighter than white", sent as colour channels above 1) lights the
// model with its own colours.
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

// --- shared: the registry, the models, each species' pixel work -----------------
const registryReady = fetch('/dino3d/registry.json', { cache: 'no-cache' }).then((r) => r.json()).catch(() => null);
let registry = null;
registryReady.then((r) => { registry = r; });
const versioned = (path) => { const f = registry?.files?.[path]; return f?.sha256 ? `${path}?v=${f.sha256.slice(0, 12)}` : path; };

async function imageData(url) {
  const bmp = await createImageBitmap(await (await fetch(versioned(url))).blob());
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
const JAW_MARGIN = 0.2;           // …inside the lower jaw's box grown by this much (not a crest up on the head)…
const JAW_NEAR = 0.06;            // …and this close (of the jaw's size) to the jaw itself

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
    // (No tongue bone — Deinosuchus: the hyoid's skin stands in for it.)
    const core = uv.count > 0 && vcat.some((c) => c === TONGUE) ? TONGUE : HYOID;
    for (let v = 0; v < uv.count; v++) if (vcat[v] === core) { cx += pos.getX(v); cy += pos.getY(v); cz += pos.getZ(v); nt++; }
    let reach = 0;
    if (nt > 0) {
      cx /= nt; cy /= nt; cz /= nt;
      for (let v = 0; v < uv.count; v++) if (vcat[v] === core) reach = Math.max(reach, Math.hypot(pos.getX(v) - cx, pos.getY(v) - cy, pos.getZ(v) - cz));
    }
    // The lower jaw's box (a little larger): the teeth, upper and lower, are in it; a crest up on the head is not.
    const jb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let v = 0; v < uv.count; v++) {
      if (vcat[v] !== JAW) continue;
      const q = [pos.getX(v), pos.getY(v), pos.getZ(v)];
      for (let k = 0; k < 3; k++) { jb[k] = Math.min(jb[k], q[k]); jb[k + 3] = Math.max(jb[k + 3], q[k]); }
    }
    const inJaw = (vs) => {
      if (!Number.isFinite(jb[0])) return false;
      const c = [0, 1, 2].map((k) => (k === 0 ? [pos.getX(vs[0]), pos.getX(vs[1]), pos.getX(vs[2])]
        : k === 1 ? [pos.getY(vs[0]), pos.getY(vs[1]), pos.getY(vs[2])] : [pos.getZ(vs[0]), pos.getZ(vs[1]), pos.getZ(vs[2])]).reduce((a, b) => a + b) / 3);
      return c.every((x, k) => { const m = (jb[k + 3] - jb[k]) * JAW_MARGIN; return x >= jb[k] - m && x <= jb[k + 3] + m; });
    };
    // …and right by the jaw: a tooth sits on its edge (a cheek boss, a neck quill does not).
    const jawPts = [];
    for (let v = 0; v < uv.count; v += 1) if (vcat[v] === JAW) jawPts.push(pos.getX(v), pos.getY(v), pos.getZ(v));
    const jawDiag = Number.isFinite(jb[0]) ? Math.hypot(jb[3] - jb[0], jb[4] - jb[1], jb[5] - jb[2]) : 0;
    const byJaw = (vs) => {
      const x = (pos.getX(vs[0]) + pos.getX(vs[1]) + pos.getX(vs[2])) / 3, y = (pos.getY(vs[0]) + pos.getY(vs[1]) + pos.getY(vs[2])) / 3,
        z = (pos.getZ(vs[0]) + pos.getZ(vs[1]) + pos.getZ(vs[2])) / 3;
      const lim = (jawDiag * JAW_NEAR) ** 2;
      for (let i = 0; i < jawPts.length; i += 3) {
        const dx = jawPts[i] - x, dy = jawPts[i + 1] - y, dz = jawPts[i + 2] - z;
        if (dx * dx + dy * dy + dz * dz <= lim) return true;
      }
      return false;
    };
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
    // Paint each triangle's texels with its part.
    for (let t = 0; t < idx.length; t += 3) {
      const vs = [idx[t], idx[t + 1], idx[t + 2]];
      const cats = vs.map((v) => vcat[v]).sort();
      const cat = cats[1];                               // the triangle's main group
      if (cat === 0) continue;
      const small = (areaOf.get(root(vs[0])) ?? 1) < TEETH_MAX_AREA;
      const mouthy = (cat === HEAD || cat === JAW || cat === HYOID) && !small && nearTongue(vs, 1.6);
      // A tooth: a small piece along the jaws — not a small crest / horn up on the head.
      const tooth = (cat === JAW || cat === HEAD) && small && inJaw(vs) && byJaw(vs);
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
          else if (cat === HEAD || cat === JAW || cat === HYOID) part = tooth ? PART_TEETH : (glossy && mouthy) ? PART_MOUTH : 0;
          else if (cat === CLAW) part = glossy ? PART_CLAWS : 0;
          if (part) out[i] = part;
        }
      }
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
      const [gltf, pattern, rac, normal] = await Promise.all([
        loader.loadAsync(versioned(sp.glbModel)),
        imageData(patternUrl),
        sp.racMap ? imageData(sp.racMap) : null,
        sp.normalMap ? new THREE.TextureLoader().loadAsync(versioned(sp.normalMap)) : null,
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

// --- one viewer ------------------------------------------------------------------
/**
 * A 3D view in `host`. opts: { note (element for a status line), interactive
 * (orbit, default true), autoRotate, fit (camera distance / model size, 1.5) }. Returns { show(species, skin), setSkin,
 * setFemale, name() }. skin: { colors: { Body: "#rrggbb"… }, female?, glow?, effects? }.
 */
function create(host, opts = {}) {
  let renderer = null, scene = null, camera = null, controls = null, mixer = null, clock = null;
  let current = null, lastSkin = null, female = false, loading = 0, sizeW = 0, sizeH = 0;
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
    const loop = () => {
      requestAnimationFrame(loop);
      if (!host.isConnected || host.hidden || document.hidden || !host.offsetParent) return;   // not shown: nothing to draw
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
    if (!current || !lastSkin) return;
    const cols = REGION_CODES.map(([id]) => srgb(lastSkin.colors?.[female && id === 'MaleDisplay' ? 'Body' : id] ?? '#808080'));
    const { a, b, t } = current.shared.classes;
    const sh = current.shared.shade, pt = current.shared.parts;
    // Teeth, mouth, claws: their own colours (index = PART_*).
    const partCols = [null, srgb(lastSkin.colors?.Teeth ?? '#e6dcc4'), srgb(lastSkin.colors?.Mouth ?? '#7a3b3b'), srgb(lastSkin.colors?.Claws ?? '#3a3a3a')];
    const img = current.ctx.createImageData(SIZE, SIZE);
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
      m.emissiveMap = glow > 1 ? current.texture : null;
      m.emissive.setRGB(glow > 1 ? 1 : 0, glow > 1 ? 1 : 0, glow > 1 ? 1 : 0);
      m.emissiveIntensity = (glow - 1) * 0.55;
      m.needsUpdate = true;
    }
    const eye = srgb(lastSkin.colors?.Eyes ?? '#806020');
    for (const m of current.eyeMats) m.color.setRGB(eye[0] / 255, eye[1] / 255, eye[2] / 255, THREE.SRGBColorSpace);
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
      if (current) { scene.remove(current.root); current.texture.dispose(); }
      mixer?.stopAllAction();
      const canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;               // glTF UVs
      const root = cloneSkinned(shared.gltf.scene);
      const bodyMats = [], eyeMats = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.frustumCulled = false;
        const eye = /eye/i.test(o.material?.name ?? '');
        const m = new THREE.MeshStandardMaterial({ roughness: eye ? 0.15 : 0.82, metalness: 0 });
        if (eye) eyeMats.push(m);
        else { m.map = texture; if (shared.normal) m.normalMap = shared.normal; bodyMats.push(m); }
        o.material = m;
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
      current = { name, root, bodyMats, eyeMats, texture, ctx: canvas.getContext('2d'), shared };
      paint();
      note(opts.interactive === false ? '' : 'Kéo để xoay · cuộn để phóng to. Răng, miệng, móng không hiện trong bản xem trước.');
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
  };
}

/**
 * A skin as the game holds it (linear colours, maybe above 1; female; from
 * /api/me or a garage slot) → the viewer's form (sRGB "#rrggbb" + glow).
 */
function fromGame(skin) {
  if (!skin?.colors) return null;
  let top = 1;
  for (const c of Object.values(skin.colors)) top = Math.max(top, c.r ?? 0, c.g ?? 0, c.b ?? 0);
  const ch = (v) => {
    const x = Math.min(1, Math.max(0, (Number(v) || 0) / top));
    const s = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(s * 255).toString(16).padStart(2, '0');
  };
  const colors = {};
  for (const [k, c] of Object.entries(skin.colors)) {
    // Exactly black: a region this species does not use (the game leaves it 0, 0, 0) — not painted black.
    if (!c || (c.r === 0 && c.g === 0 && c.b === 0)) continue;
    colors[k] = `#${ch(c.r)}${ch(c.g)}${ch(c.b)}`;
  }
  for (const [k, stand] of Object.entries(STAND_IN)) if (!colors[k]) colors[k] = typeof stand === 'function' ? stand(colors) : stand;
  return { colors, female: skin.female === true, glow: top };
}

/** What an unused (black) region is shown as. Detail1 follows the markings. */
const STAND_IN = {
  Detail1: (c) => c.Markings ?? '#3a3530', Eyes: '#b08a2a', Teeth: '#e6dcc4', Mouth: '#8a4a45', Claws: '#3a3632',
};

window.Dino3D = { create, fromGame, standIn: STAND_IN, speciesOf: (raw) => speciesOf(raw), ready: registryReady };

// --- the skin editor (tab Skin) ---------------------------------------------------
(() => {
  const $ = (id) => document.getElementById(id);
  const picker = $('skin-species');
  if (!picker) return;
  const pickerBtn = picker.querySelector('.xsel-btn');
  const pickerVal = picker.querySelector('.xsel-val');
  const menu = picker.querySelector('.xsel-menu');
  const genderBox = $('skin-gender');
  const viewer = create($('skin-3d'), { note: $('skin-preview-note') });
  let chosen = null, liveKey = null, liveName = null, activeIdx = -1, lastSkin = null, started = false;

  function renderMenu() {
    const names = Object.keys(registry?.species ?? {}).sort();
    menu.innerHTML = names.map((n, i) => `<li role="option" data-name="${n}" id="xsel-opt-${i}" aria-selected="${n === chosen}">
      <span>${n}</span>${n === liveName ? '<span class="xsel-live">đang chơi</span>' : ''}</li>`).join('');
    pickerVal.textContent = chosen ?? '—';
  }
  function openMenu(open) {
    picker.classList.toggle('open', open);
    menu.hidden = !open;
    pickerBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      activeIdx = Math.max(0, [...menu.children].findIndex((li) => li.dataset.name === chosen));
      markActive();
      menu.focus();
    }
  }
  function markActive() {
    [...menu.children].forEach((li, i) => li.classList.toggle('active', i === activeIdx));
    menu.children[activeIdx]?.scrollIntoView({ block: 'nearest' });
  }
  async function pick(name, byUser) {
    if (!registry?.species?.[name]) return;
    chosen = name;
    renderMenu();
    if (byUser) openMenu(false);
    const shown = await viewer.show(name, lastSkin);
    $('skin-3d').hidden = !shown;
    $('skin-flat').hidden = shown;
  }
  pickerBtn.addEventListener('click', () => openMenu(menu.hidden));
  menu.addEventListener('click', (e) => { const li = e.target.closest('li[data-name]'); if (li) { void pick(li.dataset.name, true); pickerBtn.focus(); } });
  menu.addEventListener('keydown', (e) => {
    const n = menu.children.length;
    if (e.key === 'ArrowDown') { activeIdx = (activeIdx + 1) % n; markActive(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { activeIdx = (activeIdx - 1 + n) % n; markActive(); e.preventDefault(); }
    else if (e.key === 'Enter' || e.key === ' ') { const li = menu.children[activeIdx]; if (li) void pick(li.dataset.name, true); pickerBtn.focus(); e.preventDefault(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { openMenu(false); if (e.key === 'Escape') pickerBtn.focus(); }
    else if (e.key.length === 1) {   // a letter: the next species starting with it
      const k = e.key.toLowerCase();
      const items = [...menu.children];
      const next = items.findIndex((li, i) => i > activeIdx && li.dataset.name.toLowerCase().startsWith(k));
      const idx = next >= 0 ? next : items.findIndex((li) => li.dataset.name.toLowerCase().startsWith(k));
      if (idx >= 0) { activeIdx = idx; markActive(); }
    }
  });
  document.addEventListener('click', (e) => { if (!picker.contains(e.target)) openMenu(false); });

  function setFemale(f) {
    for (const b of genderBox.querySelectorAll('button')) {
      const on = (b.dataset.g === 'f') === f;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    // The display colour means nothing on a female: dim its picker.
    document.querySelector('.region-card[data-region="MaleDisplay"]')?.classList.toggle('off', f);
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
      if (!registry) { pickerVal.textContent = '—'; $('skin-preview-note').textContent = 'Chưa có mô hình 3D trên server — xem màu theo từng ô.'; return; }
      lastSkin = lastSkin ?? window.skin3dLastSkin ?? null;
      started = true;
      const live = window.skin3dLive;
      if (live && speciesOf(live.species)) { liveKey = null; window.skin3d.follow(live.species, live.female); }
      else void pick(Object.keys(registry.species).sort()[0], false);
    });
  };
  start();
})();
