import { drawText, unitsOf } from '../../lib/map';
import { dinoName, hue, pct, shortId } from '../../lib/format';
import { FOOD_VN, LAYER, fishName, hexA, nutriColor, nutriMark, type Feature, type Pt } from './data';
import { aiZoneShape, toMap, zoneHandles, zoneSize } from './zones';
import { aiZoneOf, az, centerOf, fitToPoints, fitView, gd, guardedSanctuary, lm, requestDraw, rX, rY, scr, shownPos, tweening, visibleTrail } from './store';

export const playerColor = (id: string): string => `hsl(${hue(id)} 70% 55%)`;
const FONT = 'Inter, system-ui, sans-serif';

export function traceShape(ctx: CanvasRenderingContext2D, f: Pick<Feature, 'kind' | 'at' | 'r' | 'rot' | 'pts'>): void {
  ctx.beginPath();
  if (f.kind === 'circle') {
    const [cx, cy] = scr(f.at as Pt);
    const r = f.r as [number, number];
    // The game's X is vertical on screen: r[0] (along X) is the vertical radius.
    ctx.ellipse(cx, cy, Math.max(1, rY(r[1])), Math.max(1, rX(r[0])), ((f.rot ?? 0) * Math.PI) / 180, 0, Math.PI * 2);
    return;
  }
  for (const ring of f.pts ?? []) {
    ring.forEach((p, i) => { const [x, y] = scr(p); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    if (f.kind === 'poly') ctx.closePath();
  }
}

/** Which features are drawn at this zoom (z = 1: whole island). */
export function visible(f: Feature, z: number): boolean {
  if (!lm.on.has(f.layer)) return false;
  if (f.kind === 'label') {
    if (f.size === 'small') return z >= 2.2;
    if (f.layer === 'landmark') return z >= 1.5;
    if (f.layer === 'water') return true;   // a water's name goes with its outline, at every zoom
  }
  return true;
}
function flashing(f: Feature): boolean {
  const fl = lm.flash;
  if (!fl || fl.until < performance.now()) return false;
  return fl.feature === f || (fl.food !== undefined && f.kind === 'point' && f.name === fl.food);
}

/** The whole map, in the old panel's order: water, zones, live plant areas, AI zones, lines, food, labels, a life's path, plants, AI, players, a pin. */
export function drawMap(): void {
  const canvas = lm.canvas;
  if (!canvas || !lm.data || !lm.img) return;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (!cw || !ch) return;
  const img = lm.img;
  const dpr = window.devicePixelRatio || 1;
  const size = `${cw}x${ch}x${dpr}`;
  if (size !== lm.size) {
    const old = lm.view && lm.size ? lm.size.split('x').map(Number) : null;
    lm.size = size;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    if (!lm.touched || !old || !lm.view) fitView(cw, ch);
    else {
      // Keep what was in the middle in the middle.
      lm.fit = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
      lm.view.ox += (cw - (old[0] as number)) / 2;
      lm.view.oy += (ch - (old[1] as number)) / 2;
    }
  }
  if (lm.pendingFit) {
    const pts = lm.pendingFit;
    lm.pendingFit = null;
    fitToPoints(pts);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx || !lm.view) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const { s, ox, oy } = lm.view;
  const z = s / lm.fit;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, ox, oy, img.naturalWidth * s, img.naturalHeight * s);

  const feats = lm.data.features.filter((f) => visible(f, z));
  const now = performance.now();
  const pulse = 0.5 + 0.5 * Math.sin(now / 180);

  // 0. the water (Nguồn nước on), filled; a pond the image does not show as a filled dot.
  if (lm.on.has('water')) {
    if (lm.waterTint) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(lm.waterTint, ox, oy, img.naturalWidth * s, img.naturalHeight * s);
      ctx.globalAlpha = 1;
    }
    for (const w of lm.water) {
      if (w.kind !== 'circle') continue;
      traceShape(ctx, { kind: 'circle', at: w.at, r: [w.r * 0.6, w.r * 0.6] });
      ctx.fillStyle = hexA(LAYER['water']!.color, 0.75); ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(2,6,23,.6)'; ctx.stroke();
    }
  }

  // 1. zones
  for (const f of feats) {
    if (!['migration', 'patrol', 'sanctuary', 'mud'].includes(f.layer) || (f.kind === 'path' && f.layer !== 'mud')) continue;
    const c = LAYER[f.layer]!.color;
    traceShape(ctx, f);
    if (f.kind !== 'path') { ctx.fillStyle = hexA(c, lm.hover?.f === f ? 0.3 : 0.14); ctx.fill(); }
    ctx.setLineDash(f.mass ? [7, 5] : []);
    ctx.lineWidth = flashing(f) ? 3 + 3 * pulse : lm.hover?.f === f ? 2.5 : 1.5;
    ctx.strokeStyle = hexA(c, 0.9);
    ctx.stroke();
    ctx.setLineDash([]);
    // Small dinos only (tab Dino nhỏ): a yellow dashed edge and a bee.
    const bee = f.layer === 'sanctuary' && guardedSanctuary(f.name);
    if (bee) {
      traceShape(ctx, f);
      ctx.setLineDash([6, 4]); ctx.lineWidth = 2.5; ctx.strokeStyle = '#facc15'; ctx.stroke(); ctx.setLineDash([]);
    }
    if (f.layer !== 'mud' && (f.layer === 'migration' || z >= 1.6 || bee)) {
      const [x, y] = scr(centerOf(f));
      drawText(ctx, bee ? `🐝 ${f.name}` : f.name, x, y, { font: `700 11px ${FONT}`, color: bee ? '#fde047' : c });
      if (bee && z >= 1.6) drawText(ctx, 'chỉ dino nhỏ', x, y + 13, { font: `600 10px ${FONT}`, color: '#fde047' });
    }
  }
  // 1a. the game's plant areas: its migration zones, as live as the Flora export (~2 min).
  if (lm.on.has('migrlive') && lm.floraZones.length) {
    for (const { sp, ring } of lm.floraZones) {
      const [label, c] = floraState(sp);
      traceShape(ctx, { kind: 'poly', pts: [ring] });
      ctx.fillStyle = hexA(c, sp.mass ? 0.26 : sp.active ? 0.16 : 0.06); ctx.fill();
      ctx.setLineDash(sp.active || sp.mass ? [] : [5, 5]);
      ctx.lineWidth = sp.mass ? 2.5 : 1.5; ctx.strokeStyle = hexA(c, 0.95); ctx.stroke();
      ctx.setLineDash([]);
      if (z >= 2.2 && (sp.active || sp.mass)) {
        const [x, y] = scr(toMap([sp.x, sp.y]));
        drawText(ctx, label, x, y, { font: `700 10.5px ${FONT}`, color: c });
      }
    }
  }
  // 1b. AI zones (drawn by admins, run by the AIZones mod): a dark outline under a bright ring; the
  // selected one has its centre marked and handles to reshape it.
  if (lm.on.has('aizone') && az.draft) {
    for (const zn of az.draft.zones) {
      const f = aiZoneShape(zn);
      const st = az.status?.zones?.[zn.id];
      const sel = az.sel === zn.id;
      // The prison does not depend on the AI zones being on: purple when it is enabled.
      const on = zn.prison ? zn.enabled : az.draft.enabled && zn.enabled;
      const hu = zn.prison ? '#a855f7' : '#fb923c';
      const c = on ? hu : '#cbd5e1';
      traceShape(ctx, f);
      ctx.fillStyle = on ? hexA(hu, sel ? 0.24 : 0.14) : 'rgba(148,163,184,.12)';
      ctx.fill();
      ctx.lineWidth = sel ? 7 : 5.5; ctx.strokeStyle = 'rgba(2,6,23,.85)'; ctx.stroke();
      ctx.setLineDash(on ? [] : [8, 6]);
      ctx.lineWidth = sel ? 3.5 : 2.5; ctx.strokeStyle = c; ctx.stroke();
      ctx.setLineDash([]);
      const [x, y] = scr(f.at);
      const count = st && typeof st.count === 'number' ? ` · ${st.count}/${st.limit ?? zn.max}` : '';
      drawText(ctx, `${zn.name}${count}`, x, y - 9, { font: `800 12px ${FONT}`, color: on ? '#ffedd5' : '#e2e8f0' });
      drawText(ctx, `${zoneSize(zn)}${on ? '' : ' · tắt'}${zn.water ? ' · 💧 nước' : ''}${zn.smallOnly && gd.draft?.enabled ? ' · 🐝 dino nhỏ' : ''}`, x, y + 7, { font: `600 10.5px ${FONT}`, color: on ? '#fed7aa' : '#cbd5e1' });
      if (sel && !az.drawing) {
        ctx.beginPath(); ctx.moveTo(x - 6, y + 20); ctx.lineTo(x + 6, y + 20); ctx.moveTo(x, y + 14); ctx.lineTo(x, y + 26);
        ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
        // Handles: the radius (circle), the two axes (ellipse), every corner (polygon).
        for (const h of zoneHandles(zn)) {
          const [hx, hy] = scr(toMap(h.at));
          ctx.beginPath(); ctx.arc(hx, hy, h.key.startsWith('v') ? 5.5 : 7, 0, Math.PI * 2);
          ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fb923c'; ctx.stroke();
        }
      }
    }
    // A polygon being drawn: its corners, the line to the pointer, the first corner to close on.
    if (az.drawing) {
      const pts = az.drawing.pts.map((p) => scr(toMap(p)));
      const hov = az.drawing.hover ? scr(toMap(az.drawing.hover)) : null;
      if (pts.length) {
        ctx.beginPath();
        pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        if (hov) ctx.lineTo(hov[0], hov[1]);
        ctx.setLineDash([6, 5]); ctx.lineWidth = 2.5; ctx.strokeStyle = '#fb923c'; ctx.stroke(); ctx.setLineDash([]);
        pts.forEach(([px, py], i) => {
          ctx.beginPath(); ctx.arc(px, py, i === 0 && pts.length >= 3 ? 8 : 5, 0, Math.PI * 2);
          ctx.fillStyle = i === 0 ? '#fb923c' : '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(2,6,23,.9)'; ctx.stroke();
        });
      }
    }
  }
  // 2. lines: roads, air currents, caves
  for (const f of feats) {
    if (f.kind !== 'path' || !['road', 'air', 'cave'].includes(f.layer)) continue;
    const c = LAYER[f.layer]!.color;
    traceShape(ctx, f);
    ctx.setLineDash(f.layer === 'road' ? [4, 4] : []);
    ctx.lineWidth = (f.layer === 'road' ? 1.3 : 2.2) * (flashing(f) ? 2 : 1);
    ctx.strokeStyle = hexA(c, f.layer === 'road' ? 0.6 : 0.9);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const m of f.marks ?? []) {
      const [x, y] = scr(m.at);
      if (m.what === 'exit') {
        ctx.fillStyle = c; ctx.strokeStyle = '#1e1b4b'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.rect(x - 4, y - 4, 8, 8); ctx.fill(); ctx.stroke();
      } else {
        ctx.fillStyle = hexA(c, 0.25); ctx.strokeStyle = c; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        drawText(ctx, '↑', x, y, { font: `800 11px ${FONT}`, color: '#fff' });
      }
    }
    if (z >= 2 && f.layer !== 'road') {
      const [x, y] = scr(centerOf(f));
      drawText(ctx, f.name, x, y - 12, { font: `600 10.5px ${FONT}`, color: c });
    }
  }
  // 3. food and minerals
  const pr = Math.max(2.2, Math.min(5, 1.6 * Math.sqrt(z)));
  for (const f of feats) {
    if (f.kind !== 'point') continue;
    const [x, y] = scr(f.at as Pt);
    if (x < -10 || y < -10 || x > cw + 10 || y > ch + 10) continue;
    const fl = flashing(f);
    ctx.beginPath(); ctx.arc(x, y, fl ? pr + 2 + 4 * pulse : pr, 0, Math.PI * 2);
    ctx.fillStyle = LAYER[f.layer]!.color; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(2,6,23,.85)'; ctx.stroke();
    if (z >= 5) drawText(ctx, FOOD_VN[f.name] ?? f.name, x, y - pr - 7, { font: `600 10px ${FONT}`, color: '#f1f5f9' });
  }
  // 4. labels
  for (const f of feats) {
    if (f.kind !== 'label') continue;
    const [x, y] = scr(f.at as Pt);
    const c = LAYER[f.layer]!.color;
    const big = f.size === 'large';
    const text = f.text ?? '';
    if (f.layer === 'landmark') {
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
      drawText(ctx, text, x + 7, y, { font: `600 ${big ? 12 : 11}px ${FONT}`, color: c, align: 'left' });
    } else if (f.layer === 'water') {
      drawText(ctx, text, x, y, { font: `italic 700 ${big ? 13 : 11.5}px ${FONT}`, color: '#e0f2fe' });
    } else {
      drawText(ctx, text.toUpperCase(), x, y, { font: `800 ${big ? 13 : 11}px ${FONT}`, color: hexA(c, 0.92) });
    }
    if (flashing(f)) {
      ctx.beginPath(); ctx.arc(x, y, 10 + 8 * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2.5; ctx.stroke();
    }
  }
  // 5. a whole-life path opened from the player page
  if (lm.path && lm.path.points.length > 0) {
    const c = playerColor(lm.path.steamId);
    const pts = lm.path.points.map((pt) => scr(unitsOf(pt)));
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(2,6,23,.75)'; ctx.lineWidth = 6; ctx.stroke();
    ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.stroke();
    const [sx, sy] = pts[0] as Pt, [ex, ey] = pts[pts.length - 1] as Pt;
    ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.fillStyle = '#22c55e'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    drawText(ctx, 'Spawn', sx, sy - 14, { font: `700 11px ${FONT}`, color: '#bbf7d0' });
    ctx.beginPath(); ctx.rect(ex - 6, ey - 6, 12, 12); ctx.fillStyle = lm.path.end === null ? c : '#ef4444'; ctx.fill(); ctx.stroke();
    drawText(ctx, lm.path.end === null ? 'Mới nhất' : 'Kết thúc', ex, ey - 15, { font: `700 11px ${FONT}`, color: '#fecaca' });
  }
  // 5b. every plant and fruit, marked with the nutrients it gives
  if (lm.on.has('flora') && lm.flora) {
    const r = Math.max(1.8, Math.min(4.5, 1.4 * Math.sqrt(z)));
    const labels = z >= 4;
    for (const p of [...lm.flora.plants, ...lm.flora.fruits]) {
      const [x, y] = scr(toMap([p.x, p.y]));
      if (x < -6 || y < -6 || x > cw + 6 || y > ch + 6) continue;
      ctx.beginPath(); ctx.arc(x, y, lm.hover?.plant === p ? r + 2 : r, 0, Math.PI * 2);
      ctx.fillStyle = nutriColor(p); ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(2,6,23,.8)'; ctx.stroke();
      const mark = labels ? nutriMark(p) : '';
      if (mark) drawText(ctx, mark, x, y - r - 7, { font: `700 10px ${FONT}`, color: nutriColor(p) });
    }
  }
  // 6. AI alive on the server now
  if (lm.on.has('fish') && lm.ai && !lm.ai.stale) {
    // A small fish-shaped mark (body + tail), pointing right.
    const r = Math.max(2.5, Math.min(5, 2 * Math.sqrt(z)));
    for (const a of lm.ai.list) {
      if (!a.f) continue;
      const [x, y] = scr(unitsOf(a));
      if (x < -10 || y < -10 || x > cw + 10 || y > ch + 10) continue;
      const k = lm.hover?.ai === a ? 1.5 : 1;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.5 * k, r * k, 0, 0, Math.PI * 2);
      ctx.moveTo(x - r * 1.3 * k, y);
      ctx.lineTo(x - r * 2.5 * k, y - r * 0.9 * k);
      ctx.lineTo(x - r * 2.5 * k, y + r * 0.9 * k);
      ctx.closePath();
      ctx.fillStyle = LAYER['fish']!.color; ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(2,6,23,.9)'; ctx.stroke();
      if (z >= 4) drawText(ctx, fishName(a.c), x, y - r - 8, { font: `600 10.5px ${FONT}`, color: '#a5f3fc' });
    }
  }
  if (lm.on.has('ai') && lm.ai && !lm.ai.stale) {
    const r = Math.max(3, Math.min(6, 2.4 * Math.sqrt(z)));
    for (const a of lm.ai.list) {
      if (a.f) continue;
      const [x, y] = scr(unitsOf(a));
      if (x < -10 || y < -10 || x > cw + 10 || y > ch + 10) continue;
      ctx.beginPath(); ctx.arc(x, y, lm.hover?.ai === a ? r + 2 : r, 0, Math.PI * 2);
      ctx.fillStyle = LAYER['ai']!.color; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(2,6,23,.9)'; ctx.stroke();
      // Counted by an AI zone: an orange ring, so admins see what each zone holds.
      if (lm.on.has('aizone') && aiZoneOf(a)) {
        ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.lineWidth = 2.5; ctx.strokeStyle = '#fb923c'; ctx.stroke();
      }
      if (z >= 3) drawText(ctx, dinoName(a.c), x, y - r - 8, { font: `600 10.5px ${FONT}`, color: '#fecaca' });
    }
  }
  // 7. players on top
  for (const p of lm.players) {
    const c = playerColor(p.steamId);
    const trail = lm.on.has('trails') ? visibleTrail(p) : [];
    if (trail.length > 1) {
      ctx.beginPath();
      trail.forEach((l, i) => { const [x, y] = scr(unitsOf(l)); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      // Last trail point -> the dot, so the line reaches the dino.
      const [dx, dy] = scr(shownPos(p)); ctx.lineTo(dx, dy);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(2,6,23,.6)'; ctx.lineWidth = 5; ctx.stroke();
      ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.setLineDash([6, 4]); ctx.stroke();
      ctx.setLineDash([]);
    }
    const [x, y] = scr(shownPos(p));
    if (typeof p.yaw === 'number') {
      // Heading arrow. World forward is (cos yaw, sin yaw) in (X, Y); world X is right and world Y
      // down on screen. Dark outline so it reads on any terrain.
      const a = (p.yaw * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
      const nx = -dy, ny = dx;
      const tip = 34, base = 20, half = 9;
      const arrow = (): void => {
        ctx.beginPath();
        ctx.moveTo(x + dx * 8, y + dy * 8);
        ctx.lineTo(x + dx * base, y + dy * base);
        ctx.moveTo(x + dx * tip, y + dy * tip);
        ctx.lineTo(x + dx * base + nx * half, y + dy * base + ny * half);
        ctx.lineTo(x + dx * (base + 4), y + dy * (base + 4));
        ctx.lineTo(x + dx * base - nx * half, y + dy * base - ny * half);
        ctx.closePath();
      };
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      arrow(); ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(2,6,23,.85)'; ctx.stroke();
      arrow(); ctx.lineWidth = 3.5; ctx.strokeStyle = c; ctx.stroke(); ctx.fillStyle = c; ctx.fill();
      ctx.lineCap = 'butt';
    }
    const hp = (p.maxHealth ?? 0) > 0 && typeof p.health === 'number' ? p.health / (p.maxHealth as number) : null;
    ctx.beginPath(); ctx.arc(x, y, 7.5, 0, Math.PI * 2);
    ctx.fillStyle = c; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = hp !== null && hp < 0.3 ? '#ef4444' : '#fff'; ctx.stroke();
    drawText(ctx, `${p.prison ? (p.prison.escaped ? 'Kẻ vượt ngục - ' : '🔒 ') : ''}${p.name ?? shortId(p.steamId)}`, x + 13, y - 6, { font: `700 12px ${FONT}`, color: p.prison?.escaped ? '#fca5a5' : '#fff', align: 'left' });
    drawText(ctx, `${dinoName(p.species)} · ${pct(p.growth)}`, x + 13, y + 8, { font: `600 10.5px ${FONT}`, color: '#cbd5e1', align: 'left' });
  }
  // 8. a searched coordinate
  if (lm.pin) {
    const [x, y] = scr(lm.pin.at);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 9, y - 22); ctx.arc(x, y - 26, 9.5, Math.PI * 0.8, Math.PI * 0.2); ctx.closePath();
    ctx.fillStyle = '#facc15'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(2,6,23,.9)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - 26, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#1a1400'; ctx.fill();
    const g = (v: number): string => Math.round(v * 1000).toLocaleString('en-US');
    drawText(ctx, `${g(lm.pin.at[0])}, ${g(lm.pin.at[1])}`, x, y + 12, { font: '700 11.5px "JetBrains Mono", ui-monospace, monospace', color: '#fde68a' });
  }
  if ((lm.flash && lm.flash.until > now) || tweening()) requestDraw();
}

function floraState(sp: { mass?: boolean; active?: boolean; migration?: boolean }): [string, string] {
  if (sp.mass) return ['Đại di cư', '#facc15'];
  if (sp.active) return ['Đang di cư', '#22c55e'];
  if (sp.migration) return ['Vùng di cư (đang nghỉ)', '#94a3b8'];
  return ['Vùng cây thường', '#38bdf8'];
}
