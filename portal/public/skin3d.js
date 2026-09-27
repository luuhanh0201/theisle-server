// The skin editor's 3D preview (tab Skin): the dino model, re-coloured as the
// player picks colours. app.js calls window.skin3d.setSkin(skin) on every
// change; this module owns the canvas in #skin-3d and the species list.
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
// Teeth, mouth and claws have no region there: the preview cannot show them.
// A female has no display colour: its display areas take the body colour.
//
// Species and sex: our own picker (#skin-species, #skin-gender). In game, the
// preview follows the dino played now; a species the player picks stays until
// that dino changes (a new species or sex, a new life).
// Shading: the RAC map's blue channel (crevices) and green (surface detail) are
// baked into the colour; the normal map gives the relief.

import * as THREE from '/vendor/three-0.170.0/three.module.min.js';
import { GLTFLoader } from '/vendor/three-0.170.0/GLTFLoader.js';
import { OrbitControls } from '/vendor/three-0.170.0/OrbitControls.js';
import { MeshoptDecoder } from '/vendor/three-0.170.0/meshopt_decoder.module.js';

const SIZE = 1024;                 // the painted texture, per side
const REGION_CODES = [             // [region, code colour in the region map]
  ['Body', [0, 255, 245]],
  ['Flank', [0, 0, 255]],
  ['Underbelly', [0, 255, 0]],
  ['Markings', [255, 0, 255]],
  ['MaleDisplay', [255, 0, 0]],
  ['Detail1', [255, 255, 0]],
];

const $ = (id) => document.getElementById(id);
const host = $('skin-3d');
const note = $('skin-preview-note');
const picker = $('skin-species');
const pickerBtn = picker.querySelector('.xsel-btn');
const pickerVal = picker.querySelector('.xsel-val');
const menu = picker.querySelector('.xsel-menu');
const genderBox = $('skin-gender');

let registry = null;
let renderer = null, scene = null, camera = null, controls = null, mixer = null, clock = null;
let current = null;                // { name, root, bodyMats, eyeMats, texture, canvas, ctx, classes, shade }
let lastSkin = null;
let chosen = null;                 // the species shown
let female = false;
let liveKey = null;                // "species|sex" of the dino played now, as last seen
let liveName = null;
let loading = 0;

const srgb = (hex) => { const n = parseInt(String(hex).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const versioned = (path) => { const f = registry?.files?.[path]; return f?.sha256 ? `${path}?v=${f.sha256.slice(0, 12)}` : path; };

function showNote(text) { if (note) note.textContent = text ?? ''; }

async function imageData(url) {
  const blob = await (await fetch(versioned(url))).blob();
  const bmp = await createImageBitmap(blob);
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
    if (r + g + bl < 60) { a[i] = 0; b[i] = 0; t[i] = 0; continue; }   // unused UV space
    let d1 = Infinity, d2 = Infinity, i1 = 0, i2 = 0;
    for (let k = 0; k < REGION_CODES.length; k++) {
      const c = REGION_CODES[k][1];
      const d = Math.hypot(r - c[0], g - c[1], bl - c[2]);
      if (d < d1) { d2 = d1; i2 = i1; d1 = d; i1 = k; } else if (d < d2) { d2 = d; i2 = k; }
    }
    a[i] = i1; b[i] = i2; t[i] = Math.round((d1 / (d1 + d2 || 1)) * 255);
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

function paint() {
  if (!current || !lastSkin) return;
  // A female has no display colour: those areas take the body's.
  const cols = REGION_CODES.map(([id]) => srgb(lastSkin.colors?.[female && id === 'MaleDisplay' ? 'Body' : id] ?? '#808080'));
  const { a, b, t } = current.classes;
  const img = current.ctx.createImageData(SIZE, SIZE);
  const d = img.data, sh = current.shade;
  for (let i = 0, n = SIZE * SIZE; i < n; i++) {
    const c1 = cols[a[i]], c2 = cols[b[i]], w = t[i] / 255, s = sh[i] / 255;
    d[i * 4] = (c1[0] + (c2[0] - c1[0]) * w) * s;
    d[i * 4 + 1] = (c1[1] + (c2[1] - c1[1]) * w) * s;
    d[i * 4 + 2] = (c1[2] + (c2[2] - c1[2]) * w) * s;
    d[i * 4 + 3] = 255;
  }
  current.ctx.putImageData(img, 0, 0);
  current.texture.needsUpdate = true;
  const eye = srgb(lastSkin.colors?.Eyes ?? '#806020');
  for (const m of current.eyeMats) m.color.setRGB(eye[0] / 255, eye[1] / 255, eye[2] / 255, THREE.SRGBColorSpace);
}

let paintQueued = false;
function schedulePaint() {
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => { paintQueued = false; paint(); });
}

function ensureRenderer() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
  camera.position.set(6, 1.5, 7);
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
  controls.minDistance = 2;
  controls.maxDistance = 30;
  controls.target.set(0, 0, 0);
  clock = new THREE.Clock();
  const loop = () => {
    requestAnimationFrame(loop);
    if (host.hidden || document.hidden || !host.offsetParent) return;   // tab not shown: nothing to draw
    // Follow the box's size here rather than with a ResizeObserver: the tab can be
    // hidden when the model loads (0 × 0), and an observer missed that change.
    const w = host.clientWidth, h = host.clientHeight;
    if (w > 0 && h > 0 && (w !== sizeW || h !== sizeH)) resize();
    mixer?.update(clock.getDelta());
    controls.update();
    renderer.render(scene, camera);
  };
  loop();
}

let sizeW = 0, sizeH = 0;
function resize() {
  const w = host.clientWidth || 1, h = host.clientHeight || 1;
  sizeW = w; sizeH = h;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

const gltfCache = new Map();
function loadGltf(url) {
  if (!gltfCache.has(url)) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    gltfCache.set(url, loader.loadAsync(versioned(url)).catch((e) => { gltfCache.delete(url); throw e; }));
  }
  return gltfCache.get(url);
}

async function showSpecies(name) {
  const sp = registry?.species?.[name];
  if (!sp) return;
  const my = ++loading;
  showNote(`Đang tải mô hình ${name}…`);
  try {
    const patternUrl = sp.patterns?.['1'] ?? Object.values(sp.patterns ?? {})[0];
    const [gltf, pattern, rac, normal] = await Promise.all([
      loadGltf(sp.glbModel),
      imageData(patternUrl),
      sp.racMap ? imageData(sp.racMap) : null,
      sp.normalMap ? new THREE.TextureLoader().loadAsync(versioned(sp.normalMap)) : null,
    ]);
    if (my !== loading) return;       // another species was picked meanwhile
    ensureRenderer();
    if (current) { scene.remove(current.root); current.texture.dispose(); }
    mixer?.stopAllAction();

    const canvas = document.createElement('canvas');
    canvas.width = SIZE; canvas.height = SIZE;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;               // glTF UVs
    if (normal) { normal.flipY = false; normal.colorSpace = THREE.NoColorSpace; }

    const root = gltf.scene;
    const bodyMats = [], eyeMats = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const eye = /eye/i.test(o.material?.name ?? '');
      const m = new THREE.MeshStandardMaterial({ roughness: eye ? 0.15 : 0.82, metalness: 0 });
      if (eye) { eyeMats.push(m); } else {
        m.map = texture;
        if (normal) { m.normalMap = normal; m.normalScale = new THREE.Vector2(1, 1); }
        bodyMats.push(m);
      }
      o.material = m;
    });
    const s = sp.glbScale ?? 0.03;
    root.scale.setScalar(s);
    root.position.set(...(sp.glbPosition ?? [0, -2.4, 0]));
    scene.add(root);
    // Frame it: the camera looks at the middle of the model from the side.
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
    const dist = Math.max(size.x, size.y, size.z) * 1.5 + 1;
    controls.target.copy(mid);
    camera.position.set(mid.x + dist * 0.85, mid.y + dist * 0.25, mid.z + dist * 0.75);
    camera.near = dist / 100; camera.far = dist * 10; camera.updateProjectionMatrix();

    mixer = new THREE.AnimationMixer(root);
    if (gltf.animations?.[0]) mixer.clipAction(gltf.animations[0]).play();

    current = { name, root, bodyMats, eyeMats, texture, canvas, ctx: canvas.getContext('2d'),
      classes: classify(pattern), shade: rac ? shading(rac) : new Uint8Array(SIZE * SIZE).fill(230) };
    host.hidden = false;
    $('skin-flat').hidden = true;
    paint();
    showNote('Kéo để xoay · cuộn để phóng to. Răng, miệng, móng không hiện trong bản xem trước.');
  } catch (err) {
    if (my !== loading) return;
    console.error('[skin3d]', err);
    host.hidden = true;
    $('skin-flat').hidden = false;
    showNote('Không tải được mô hình 3D — xem màu theo từng ô.');
  }
}

/** "BP_Deinosuchus_C" / "Deinosuchus" → the registry's name, or null. */
function speciesOf(raw) {
  if (!registry || !raw) return null;
  const short = String(raw).split('.').pop().replace(/^BP_/, '').replace(/_C$/, '').toLowerCase();
  return Object.keys(registry.species).find((k) => k.toLowerCase() === short) ?? null;
}

// --- the species picker (our own dropdown) -------------------------------------
let activeIdx = -1;
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
    const items = [...menu.children];
    activeIdx = Math.max(0, items.findIndex((li) => li.dataset.name === chosen));
    markActive();
    menu.focus();
  }
}
function markActive() {
  [...menu.children].forEach((li, i) => li.classList.toggle('active', i === activeIdx));
  menu.children[activeIdx]?.scrollIntoView({ block: 'nearest' });
}
function pick(name, byUser) {
  if (!registry?.species?.[name]) return;
  chosen = name;
  renderMenu();
  if (byUser) openMenu(false);
  if (current?.name !== name) void showSpecies(name);
}
pickerBtn.addEventListener('click', () => openMenu(menu.hidden));
menu.addEventListener('click', (e) => { const li = e.target.closest('li[data-name]'); if (li) { pick(li.dataset.name, true); pickerBtn.focus(); } });
menu.addEventListener('keydown', (e) => {
  const n = menu.children.length;
  if (e.key === 'ArrowDown') { activeIdx = (activeIdx + 1) % n; markActive(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { activeIdx = (activeIdx - 1 + n) % n; markActive(); e.preventDefault(); }
  else if (e.key === 'Enter' || e.key === ' ') { const li = menu.children[activeIdx]; if (li) pick(li.dataset.name, true); pickerBtn.focus(); e.preventDefault(); }
  else if (e.key === 'Escape' || e.key === 'Tab') { openMenu(false); if (e.key === 'Escape') pickerBtn.focus(); }
  else if (e.key.length === 1) {   // type a letter: jump to the next species starting with it
    const k = e.key.toLowerCase();
    const items = [...menu.children];
    const next = items.findIndex((li, i) => i > activeIdx && li.dataset.name.toLowerCase().startsWith(k));
    const idx = next >= 0 ? next : items.findIndex((li) => li.dataset.name.toLowerCase().startsWith(k));
    if (idx >= 0) { activeIdx = idx; markActive(); }
  }
});
document.addEventListener('click', (e) => { if (!picker.contains(e.target)) openMenu(false); });

// --- male / female ----------------------------------------------------------------
function setFemale(f) {
  female = f;
  for (const b of genderBox.querySelectorAll('button')) {
    const on = (b.dataset.g === 'f') === f;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  // The display colour means nothing on a female: dim its picker.
  document.querySelector('.region-card[data-region="MaleDisplay"]')?.classList.toggle('off', f);
  schedulePaint();
}
genderBox.addEventListener('click', (e) => { const b = e.target.closest('button[data-g]'); if (b) setFemale(b.dataset.g === 'f'); });

window.skin3d = {
  setSkin(skin) { lastSkin = skin; schedulePaint(); },
  /**
   * The dino played now (from /api/me): its species and sex. A new one (or the
   * first seen) is shown at once, over whatever the player picked before.
   */
  follow(rawSpecies, isFemale) {
    window.skin3dLive = { species: rawSpecies, female: isFemale };
    if (!registry) return;
    const name = speciesOf(rawSpecies);
    const key = `${name}|${isFemale === true}`;
    if (name !== liveName) { liveName = name; renderMenu(); }
    if (!name || key === liveKey) return;
    liveKey = key;
    if (typeof isFemale === 'boolean') setFemale(isFemale);
    pick(name, false);
  },
};

(async () => {
  try {
    registry = await (await fetch('/dino3d/registry.json', { cache: 'no-cache' })).json();
  } catch {
    showNote('Chưa có mô hình 3D trên server — xem màu theo từng ô.');
    pickerVal.textContent = '—';
    return;
  }
  lastSkin = lastSkin ?? window.skin3dLastSkin ?? null;
  const live = window.skin3dLive;
  if (live && speciesOf(live.species)) {
    window.skin3d.follow(live.species, live.female);   // in game already: that dino
  } else {
    pick(Object.keys(registry.species).sort()[0], false);
  }
})();
