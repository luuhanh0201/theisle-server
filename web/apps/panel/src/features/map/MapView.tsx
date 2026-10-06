import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { parseCoords, toGame } from '../../lib/map';
import { dateTime, dinoName, shortId } from '../../lib/format';
import { FOOD_VN, LAYER, ZONE_VN, foodName, type Feature, type Pt } from './data';
import { drawMap } from './draw';
import { Tip, hitTest, sameHit, zoneGrab } from './hit';
import { addPolyCorner, az, cancelDraw, centerOf, changed, finishPolyDraw, fitView, flyTo, fromScr, lm, markAz, placeAiZone, requestDraw, selectAiZone, selectedZone, setDrawer, turnOn, useMapState, zoomAt } from './store';
import { centreOf, dragHandle } from './zones';
import s from './Map.module.css';

type SearchHit = { coord: Pt } | { food: string; layer: string; n: number } | { f: Feature };

/** The island map: the canvas, its tools, the search box, the hover box, what a click does now. */
export function MapView({ pathInfo, onClosePath }: { pathInfo: { text: React.ReactNode } | null; onClosePath: () => void }) {
  useMapState();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; h: NonNullable<ReturnType<typeof hitTest>> } | null>(null);
  const tipBox = useRef<HTMLDivElement>(null);
  const [coord, setCoord] = useState<string | null>(null);
  const [cursor, setCursor] = useState('');
  const [dragging, setDragging] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);

  useEffect(() => {
    lm.canvas = canvas.current;
    lm.size = '';
    setDrawer(drawMap);
    requestDraw();
    const onResize = (): void => requestDraw();
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onResize);
    // Drawing a polygon: Enter closes, Esc cancels, Backspace drops the last corner.
    const onKey = (e: KeyboardEvent): void => {
      if (!az.drawing) return;
      if (e.key === 'Enter') { e.preventDefault(); finishPolyDraw(); }
      else if (e.key === 'Escape') cancelDraw();
      else if (e.key === 'Backspace' && az.drawing.pts.length) { e.preventDefault(); az.drawing.pts.pop(); changed(); }
    };
    document.addEventListener('keydown', onKey);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    if (ro && canvas.current) ro.observe(canvas.current);
    return () => {
      setDrawer(null); lm.canvas = null;
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onResize);
      document.removeEventListener('keydown', onKey);
      ro?.disconnect();
    };
  }, []);
  // The wheel zooms (a passive listener could not stop the page scrolling).
  useEffect(() => {
    const c = canvas.current;
    if (!c) return undefined;
    const wheel = (e: WheelEvent): void => {
      if (!lm.view) return;
      e.preventDefault();
      const r = c.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018)));
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  }, []);

  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = (canvas.current as HTMLCanvasElement).getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const showHover = (sx: number, sy: number): void => {
    const h = hitTest(sx, sy);
    const redraw = !sameHit(h, lm.hover);
    lm.hover = h;
    setTip(h ? { x: sx, y: sy, h } : null);
    const [x, y] = fromScr(sx, sy);
    // Same order and format as the game's own location, so the two compare directly.
    const g = (v: number): string => Math.round(v * 1000).toLocaleString('en-US');
    setCoord(`${g(x)}, ${g(y)}`);
    const grab = zoneGrab(sx, sy);
    setCursor(az.placing || az.drawing ? 'crosshair' : grab?.mode === 'handle' ? 'grab' : grab ? 'move' : h?.player || h?.azone ? 'pointer' : '');
    if (redraw) requestDraw();
  };
  const down = (e: RPointerEvent<HTMLCanvasElement>): void => {
    if (!lm.view) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a pointer the browser no longer tracks */ }
    const [x, y] = local(e);
    lm.pointers.set(e.pointerId, [x, y]);
    if (lm.pointers.size === 1) {
      const grab = zoneGrab(x, y);
      if (grab) { az.drag = { ...grab, moved: false }; lm.drag = null; setTip(null); return; }
      lm.drag = { x, y, ox: lm.view.ox, oy: lm.view.oy, moved: false };
    } else if (lm.pointers.size === 2) {
      const [a, b] = [...lm.pointers.values()] as [Pt, Pt];
      lm.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: lm.view.s };
      lm.drag = null;
    }
  };
  const move = (e: RPointerEvent<HTMLCanvasElement>): void => {
    if (!lm.view) return;
    const [x, y] = local(e);
    if (lm.pointers.has(e.pointerId)) lm.pointers.set(e.pointerId, [x, y]);
    if (az.drag) {
      // Move the zone (keeping where it was grabbed under the pointer), or pull a handle.
      const [gx, gy] = toGame(fromScr(x, y));
      const zn = az.drag.zn;
      if (az.drag.mode === 'move' && az.drag.off) {
        const nx = Math.round(gx - az.drag.off[0]), ny = Math.round(gy - az.drag.off[1]);
        if (zn.poly) zn.poly = zn.poly.map(([px, py]): Pt => [px + nx - zn.x, py + ny - zn.y]);
        zn.x = nx; zn.y = ny;
      } else if (az.drag.key) dragHandle(zn, az.drag.key, gx, gy);
      az.drag.moved = true;
      changed();
      return;
    }
    if (az.drawing) { az.drawing.hover = toGame(fromScr(x, y)); requestDraw(); }
    if (lm.pinch && lm.pointers.size === 2) {
      const [a, b] = [...lm.pointers.values()] as [Pt, Pt];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (lm.pinch.s * d) / lm.pinch.d / lm.view.s);
      return;
    }
    if (lm.drag) {
      const dx = x - lm.drag.x, dy = y - lm.drag.y;
      if (!lm.drag.moved && Math.hypot(dx, dy) > 4) { lm.drag.moved = true; setDragging(true); setTip(null); }
      if (lm.drag.moved) {
        lm.view.ox = lm.drag.ox + dx; lm.view.oy = lm.drag.oy + dy;
        lm.touched = true;
        requestDraw();
        return;
      }
    }
    showHover(x, y);
  };
  const end = (e: RPointerEvent<HTMLCanvasElement>): void => {
    if (az.drag) {
      const { moved, zn } = az.drag;
      az.drag = null;
      lm.pointers.delete(e.pointerId);
      if (moved) {
        if (zn.poly) [zn.x, zn.y] = centreOf(zn.poly);
        delete az.points[zn.id];
        markAz();
      }
      return;
    }
    const click = lm.drag && !lm.drag.moved && lm.pointers.size === 1;
    lm.pointers.delete(e.pointerId);
    if (lm.pointers.size < 2) lm.pinch = null;
    setDragging(false);
    if (click && e.type === 'pointerup') {
      const [x, y] = local(e);
      if (az.drawing) addPolyCorner(x, y);
      else if (az.placing) {
        const [p0, p1] = fromScr(x, y);
        placeAiZone(Math.round(p1 * 1000), Math.round(p0 * 1000));   // map units are [game Y, game X] / 1000
      } else {
        const h = hitTest(x, y);
        if (h?.player) location.hash = `player/${encodeURIComponent(h.player.steamId)}`;
        else if (h?.azone) selectAiZone(h.azone.id);
      }
    }
    lm.drag = null;
  };
  const leave = (): void => {
    if (lm.drag) return;
    setTip(null); setCoord(null);
    if (lm.hover) { lm.hover = null; requestDraw(); }
  };
  const zoomCenter = (k: number): void => { if (lm.view && canvas.current) zoomAt(canvas.current.clientWidth / 2, canvas.current.clientHeight / 2, k); };

  const search = (v: string): void => {
    setQ(v);
    const t = v.trim().toLowerCase();
    if (t === '' && lm.pin) { lm.pin = null; requestDraw(); }
    const at = lm.data ? parseCoords(t) : null;
    if (at) { setHits([{ coord: at }]); return; }
    if (!lm.data || t.length < 2) { setHits([]); return; }
    const foods = new Map<string, { food: string; layer: string; n: number }>();
    const places: Array<{ f: Feature }> = [];
    for (const f of lm.data.features) {
      if (f.kind === 'point') {
        if (`${f.name} ${FOOD_VN[f.name] ?? ''}`.toLowerCase().includes(t)) {
          const e = foods.get(f.name) ?? { food: f.name, layer: f.layer, n: 0 };
          e.n += 1; foods.set(f.name, e);
        }
      } else if (`${f.name} ${f.text ?? ''}`.toLowerCase().includes(t)) places.push({ f });
    }
    setHits([...foods.values(), ...places].slice(0, 12));
  };
  const go = (h: SearchHit): void => {
    const until = performance.now() + 6000;
    if ('coord' in h) { lm.pin = { at: h.coord }; flyTo(h.coord, 4); setHits([]); return; }
    if ('food' in h) { turnOn(h.layer); lm.flash = { food: h.food, until }; requestDraw(); }
    else { turnOn(h.f.layer); lm.flash = { feature: h.f, until }; flyTo(centerOf(h.f), h.f.kind === 'label' ? 4 : 2.5); }
  };
  const g = (v: number): string => Math.round(v * 1000).toLocaleString('en-US');
  const zn = selectedZone();
  const n = az.drawing?.pts.length ?? 0;
  const tipPos = (() => {
    if (!tip || !wrap.current) return null;
    const tw = tipBox.current?.offsetWidth ?? 200, th = tipBox.current?.offsetHeight ?? 60;
    const left = Math.min(tip.x + 14, wrap.current.clientWidth - tw - 8);
    const top = tip.y + 14 + th > wrap.current.clientHeight ? tip.y - th - 10 : tip.y + 14;
    return { left: Math.max(8, left), top: Math.max(8, top) };
  })();
  return (
    <div ref={wrap} className={`${s.wrap}${az.placing || az.drawing ? ` ${s.placing}` : ''}`}>
      <canvas ref={canvas} className={`${s.canvas}${dragging ? ` ${s.dragging}` : ''}`} style={cursor ? { cursor } : undefined} aria-label="Bản đồ"
        onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onPointerLeave={leave}
        onDoubleClick={(e) => { if (lm.view) { const [x, y] = local(e); zoomAt(x, y, 2); } }} />
      <div className={s.tools}>
        <button type="button" title="Phóng to" onClick={() => zoomCenter(1.6)}>+</button>
        <button type="button" title="Thu nhỏ" onClick={() => zoomCenter(1 / 1.6)}>−</button>
        <button type="button" title="Xem toàn đảo" onClick={() => { if (lm.view && canvas.current) { fitView(canvas.current.clientWidth, canvas.current.clientHeight); lm.touched = false; requestDraw(); } }}>⤢</button>
        <button type="button" title="Toàn màn hình" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void wrap.current?.requestFullscreen?.(); }}>⛶</button>
      </div>
      {coord && <div className={s.coord}>{coord}</div>}
      {tip && <div ref={tipBox} className={s.tip} style={tipPos ?? undefined}><Tip h={tip.h} m={s.m ?? ''} /></div>}
      {!lm.data && <div className={s.msg}>{lm.failed ? <span>Chưa có dữ liệu bản đồ ({lm.failed}).<br />Trên máy deploy: <span className={s.mono}>cd bridge &amp;&amp; npm run build &amp;&amp; node dist/cli-fetch-map.js</span>, rồi deploy lại bridge.</span> : 'Đang tải bản đồ…'}</div>}
      {pathInfo && <div className={s.path}>{pathInfo.text}<button type="button" onClick={onClosePath}>Đóng</button></div>}
      {az.drawing ? (
        <div className={s.hint}><span>Vẽ đa giác: bấm lên bản đồ để thêm điểm ({n}/40){n >= 3 && <> · bấm điểm đầu hoặc <b>Enter</b> để xong</>} · <b>Backspace</b> bỏ điểm cuối · <b>Esc</b> huỷ</span>
          <button type="button" disabled={n < 3} onClick={finishPolyDraw}>Xong</button><button type="button" onClick={cancelDraw}>Huỷ</button></div>
      ) : az.placing === 'new' ? (
        <div className={s.hint}><span>Bấm lên bản đồ để đặt tâm vùng mới</span> <button type="button" onClick={cancelDraw}>Huỷ</button></div>
      ) : az.placing ? (
        <div className={s.hint}><span>Bấm lên bản đồ để đặt lại tâm vùng</span> <button type="button" onClick={cancelDraw}>Huỷ</button></div>
      ) : zn && lm.on.has('aizone') ? (
        <div className={s.hint}><span><b>{zn.name}</b>: kéo bên trong để dời · {zn.shape === 'polygon' ? 'kéo các điểm để chỉnh hình' : zn.shape === 'ellipse' ? 'kéo 2 núm để đổi độ dài và xoay' : 'kéo núm trên mép để đổi bán kính'}
          {az.dirty && <> · <span style={{ color: '#fdba74' }}>chưa lưu</span></>}</span></div>
      ) : null}
      <div className={s.find}>
        <input type="search" placeholder="Tìm địa điểm, hoặc toạ độ: 349,211, 148,696" autoComplete="off" aria-label="Tìm địa điểm hoặc toạ độ" value={q} onChange={(e) => search(e.target.value)} />
        {(hits.length > 0 || (q.trim().length >= 2 && lm.data && !parseCoords(q.trim()))) && (
          <ul className={s.results}>
            {hits.length === 0 ? <li className={s.none}>Không thấy.</li> : hits.map((h, i) => (
              <li key={i}><button type="button" onClick={() => go(h)}>{'coord' in h ? <>📍 Tới toạ độ {g(h.coord[0])}, {g(h.coord[1])}<small>{insideMap(h.coord) ? 'Y, X' : 'ngoài bản đồ'}</small></>
                : 'food' in h ? <>{foodName(h.food)}<small>{h.n} điểm</small></>
                  : <>{(h.f.text ?? h.f.name).replace(/\n/g, ' ')}<small>{ZONE_VN[h.f.layer] ?? LAYER[h.f.layer]?.label}</small></>}</button></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
function insideMap(at: Pt): boolean {
  const b = lm.data?.bounds;
  return !!b && at[0] >= b.minX && at[0] <= b.maxX && at[1] >= b.minY && at[1] <= b.maxY;
}

/** The banner of a whole-life path (#map/path/<id>/<spawnedAt>). */
export function pathText(name: string | null, steamId: string, d: { species: string; spawnedAt: number; points: Array<{ t: number }> }, m: string): React.ReactNode {
  const last = d.points[d.points.length - 1];
  return <><b>Đường đi · {name ?? shortId(steamId)}</b><span>{dinoName(d.species)}</span>
    <span className={m}>spawn {dateTime(d.spawnedAt)}{last ? ` → ${dateTime(last.t)}` : ''} · {d.points.length} điểm</span></>;
}
