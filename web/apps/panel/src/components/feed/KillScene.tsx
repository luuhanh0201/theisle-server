import { useCallback, useEffect, useRef, useState } from 'react';
import { getJson } from '@isle/api';
import { Button } from '@isle/ui';
import { clock, dateTime, dinoName, num, pct, shortId } from '../../lib/format';
import { dur } from '../../lib/time';
import { drawText, loadMap, pxPerMetre, toImg, unitsOf, type LoadedMap } from '../../lib/map';
import type { FeedEvent } from './describe';
import s from './KillScene.module.css';

/** GET /api/kill-scene (bridge/src/kill-scene.ts): who stood within `near` m of a death, and the fight before it. */
export interface Scene {
  t: number; steamId: string; loc: { x: number; y: number }; killer: string | null; near: number; missing?: boolean;
  players: Array<{ steamId: string; name: string | null; species: string; growth: number; x: number; y: number; dist: number; age: number; role: 'victim' | 'killer' | 'near' }>;
  fight: null | {
    from: number; to: number;
    rows: Array<{ steamId: string; name: string | null; species: string; growth: number; dealt: number; taken: number; hits: number; hitsTaken: number }>;
    hits: Array<{ t: number; attacker: string; victim: string; amount: number; ticks: number }>;
  };
}
const COLOR = { victim: '#ef4444', killer: '#f59e0b', near: '#38bdf8' } as const;
const ROLE = { victim: 'Người chết', killer: 'Kẻ giết', near: 'Ở gần' } as const;

/** A death from before scenes were kept: only its own spot. */
export function fallback(e: FeedEvent): Scene {
  return { t: e.t, steamId: e.steamId, loc: e.loc, killer: e.killer && e.killer !== 'ai' ? e.killer : null, near: 200, missing: true,
    players: [{ steamId: e.steamId, name: e.name ?? null, species: e.species, growth: e.growth, x: e.loc.x, y: e.loc.y, dist: 0, age: 0, role: 'victim' }], fight: null };
}

/** A death's scene (the 📍 on a death): the spot on the map, the players within 200 m then, the fight. */
export function KillScene({ entry: e, onClose }: { entry: FeedEvent; onClose: () => void }) {
  const [scene, setScene] = useState<Scene | null>(null);
  const [map, setMap] = useState<LoadedMap | null>(null);
  const [msg, setMsg] = useState<string | null>('Đang tải…');
  const [hover, setHover] = useState<{ i: number; mx: number; my: number } | null>(null);
  const [more, setMore] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<{ s: number; ox: number; oy: number } | null>(null);
  const fit = useRef(1);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      let sc: Scene;
      try { sc = await getJson<Scene>(`/api/kill-scene?steamId=${encodeURIComponent(e.steamId)}&t=${e.t}`); } catch { sc = fallback(e); }
      if (!live) return;
      setScene(sc);
      try { const m = await loadMap(); if (live) { setMap(m); setMsg(null); } } catch (err) { if (live) setMsg(`Không hiện được bản đồ: ${(err as Error).message ?? err}`); }
    })();
    const key = (ev: KeyboardEvent): void => { if (ev.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => { live = false; document.removeEventListener('keydown', key); };
  }, [e, onClose]);

  const scr = useCallback((x: number, y: number): [number, number] => {
    const [ix, iy] = toImg(map!, unitsOf({ x, y }));
    return [view.current!.ox + ix * view.current!.s, view.current!.oy + iy * view.current!.s];
  }, [map]);

  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c || !map || !scene) return;
    const cw = c.clientWidth, ch = c.clientHeight;
    if (!cw || !ch) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
    if (!view.current) {
      // The 200 m ring (and the killer, if further) fills most of the view, the death in the middle.
      const far = Math.max(scene.near, ...scene.players.map((p) => p.dist));
      const scale = (Math.min(cw, ch) * 0.42) / (far * 1.1 * pxPerMetre(map));
      const [ix, iy] = toImg(map, unitsOf(scene.loc));
      fit.current = scale;
      view.current = { s: scale, ox: cw / 2 - ix * scale, oy: ch / 2 - iy * scale };
    }
    const v = view.current;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(map.img, v.ox, v.oy, map.img.naturalWidth * v.s, map.img.naturalHeight * v.s);
    // The 200 m ring around the death.
    const [vx, vy] = scr(scene.loc.x, scene.loc.y);
    const r = scene.near * pxPerMetre(map) * v.s;
    ctx.beginPath(); ctx.arc(vx, vy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(239,68,68,.08)'; ctx.fill();
    ctx.setLineDash([7, 5]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(248,113,113,.9)'; ctx.stroke(); ctx.setLineDash([]);
    drawText(ctx, `${scene.near} m`, vx, vy - r - 9, { font: '700 11px Inter, system-ui, sans-serif', color: '#fecaca' });
    // Who hit whom in the fight: a line between them.
    if (scene.fight) {
      const at = new Map(scene.players.map((p) => [p.steamId, p]));
      for (const pair of new Set(scene.fight.hits.map((h) => [h.attacker, h.victim].sort().join('|')))) {
        const [a, b] = pair.split('|').map((id) => at.get(id));
        if (!a || !b) continue;
        const [ax, ay] = scr(a.x, a.y), [bx, by] = scr(b.x, b.y);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(251,191,36,.55)'; ctx.stroke();
      }
    }
    // The players, the victim on top.
    const order = [...scene.players.keys()].sort((a, b) => Number(scene.players[a]!.role === 'victim') - Number(scene.players[b]!.role === 'victim'));
    for (const i of order) {
      const p = scene.players[i]!;
      const [x, y] = scr(p.x, p.y);
      const hov = hover?.i === i;
      const rad = (p.role === 'victim' ? 8 : 6.5) + (hov ? 2 : 0);
      ctx.beginPath(); ctx.arc(x, y, rad + 2.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(2,6,23,.85)'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fillStyle = COLOR[p.role]; ctx.fill();
      if (p.role === 'victim') {
        ctx.beginPath(); ctx.moveTo(x - 3.5, y - 3.5); ctx.lineTo(x + 3.5, y + 3.5); ctx.moveTo(x + 3.5, y - 3.5); ctx.lineTo(x - 3.5, y + 3.5);
        ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
      }
      drawText(ctx, p.name ?? shortId(p.steamId), x, y - rad - 10, { font: `${hov ? 800 : 700} 11.5px Inter, system-ui, sans-serif`, color: hov ? '#fff' : '#e2e8f0' });
    }
  }, [map, scene, hover, scr]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const re = (): void => { view.current = null; draw(); };
    window.addEventListener('resize', re);
    return () => window.removeEventListener('resize', re);
  }, [draw]);
  // Zoom on the wheel, around the pointer (a passive listener cannot stop the page scrolling).
  useEffect(() => {
    const c = canvas.current;
    if (!c) return undefined;
    const wheel = (ev: WheelEvent): void => {
      const v = view.current;
      if (!v) return;
      ev.preventDefault();
      const rect = c.getBoundingClientRect();
      const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      const ns = Math.min(fit.current * 6, Math.max(fit.current * 0.25, v.s * (ev.deltaY < 0 ? 1.2 : 1 / 1.2)));
      v.ox = mx - (mx - v.ox) * (ns / v.s); v.oy = my - (my - v.oy) * (ns / v.s); v.s = ns;
      draw();
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  }, [draw]);

  const hit = (ev: React.PointerEvent): { i: number | null; mx: number; my: number } | null => {
    if (!scene || !view.current || !map) return null;
    const rect = canvas.current!.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    let best: number | null = null, bestD = 14;
    scene.players.forEach((p, i) => { const [x, y] = scr(p.x, p.y); const d = Math.hypot(x - mx, y - my); if (d < bestD) { best = i; bestD = d; } });
    return { i: best, mx, my };
  };
  const tip = hover && scene ? scene.players[hover.i] : null;
  const boxW = box.current?.clientWidth ?? 600, boxH = box.current?.clientHeight ?? 400;

  return (
    <div className={s.back} onMouseDown={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div className={s.modal} role="dialog" aria-modal="true" aria-label="Hiện trường lần chết">
        <div className={s.head}>
          <div>
            <h3>{e.attributed && e.killer ? `${e.killerName ?? shortId(e.killer)} giết ${e.name ?? shortId(e.steamId)}` : `${e.name ?? shortId(e.steamId)} đã chết`}</h3>
            <div className={s.sub}>{dateTime(e.t)} · {dinoName(e.species)} {pct(e.growth)} · toạ độ {num(e.loc.x)}, {num(e.loc.y)}</div>
          </div>
          <button type="button" className={s.close} aria-label="Đóng" onClick={onClose}>✕</button>
        </div>
        <div className={s.map} ref={box}>
          <canvas ref={canvas} className={drag.current ? s.drag : undefined}
            onPointerMove={(ev) => {
              if (drag.current && view.current) {
                view.current.ox = drag.current.ox + ev.clientX - drag.current.x;
                view.current.oy = drag.current.oy + ev.clientY - drag.current.y;
                setHover(null); draw(); return;
              }
              const h = hit(ev);
              if (h) setHover(h.i === null ? null : { i: h.i, mx: h.mx, my: h.my });
            }}
            onPointerLeave={() => setHover(null)}
            onPointerDown={(ev) => { if (!view.current) return; drag.current = { x: ev.clientX, y: ev.clientY, ox: view.current.ox, oy: view.current.oy }; ev.currentTarget.setPointerCapture(ev.pointerId); }}
            onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} />
          {tip && hover && (
            <div className={s.tip} style={{ left: Math.min(boxW - 170, Math.max(6, hover.mx + 14)), top: hover.my + 90 > boxH ? Math.max(6, hover.my - 80) : hover.my + 14 }}>
              <b>{tip.name ?? shortId(tip.steamId)}</b><div>{dinoName(tip.species)} · tăng trưởng {pct(tip.growth)}</div>
              <div className={s.r}>{ROLE[tip.role]} · {tip.role === 'victim' ? 'nơi chết' : `cách ${num(tip.dist)} m${tip.age > 0 ? ` · vị trí ${tip.age} s trước lúc chết` : ''}`}</div>
            </div>
          )}
          {msg && <div className={s.msg}>{msg}</div>}
        </div>
        {scene && (
          <div className={s.people}>
            {scene.players.map((p, i) => (
              <span key={p.steamId} className={hover?.i === i ? s.hl : undefined}><i style={{ background: COLOR[p.role] }} /><b>{p.name ?? shortId(p.steamId)}</b> {dinoName(p.species)} {pct(p.growth)}{p.role === 'victim' ? '' : ` · ${num(p.dist)} m`}</span>
            ))}
            {scene.missing ? <span className={s.note}>Lần chết này có trước khi panel lưu hiện trường: chỉ có vị trí người chết.</span>
              : scene.players.length === 1 ? <span className={s.note}>Không có người chơi nào khác trong {scene.near} m.</span> : null}
          </div>
        )}
        <div><Button variant="ghost" onClick={() => setMore(!more)}>{more ? 'Ẩn chi tiết' : 'Xem chi tiết giao chiến'}</Button></div>
        {more && scene && <Fight scene={scene} />}
      </div>
    </div>
  );
}

function Fight({ scene }: { scene: Scene }) {
  const f = scene.fight;
  if (!f) {
    return <div className={s.fight}><div className={s.mutedLine}>{scene.missing ? 'Lần chết này có trước khi panel lưu hiện trường.'
      : 'Không có đòn PvP nào ngay trước khi chết (chết vì AI, ngã, đói, chảy máu…, game không báo những thứ đó).'}</div></div>;
  }
  const nameOf = (id: string): string => f.rows.find((x) => x.steamId === id)?.name ?? shortId(id);
  return (
    <div className={s.fight}>
      <div className={s.mutedLine}>Trận đánh {dur(f.to - f.from)}, {clock(f.from)} → {clock(f.to)} · chỉ đòn giữa người chơi</div>
      <table>
        <thead><tr><th>Dino tham gia</th><th className={s.n}>Gây dame</th><th className={s.n}>Chịu dame</th><th className={s.n}>Số đòn</th><th className={s.n}>Bị trúng</th></tr></thead>
        <tbody>{f.rows.map((r) => (
          <tr key={r.steamId}>
            <td><b>{r.name ?? shortId(r.steamId)}</b>{r.steamId === scene.steamId ? <span className={s.dead}> (chết)</span> : r.steamId === scene.killer ? <span className={s.killer}> (kẻ giết)</span> : null}
              <div className={s.mutedLine}>{dinoName(r.species)} · {pct(r.growth)}</div></td>
            <td className={`${s.n} ${s.dealt}`}>{num(r.dealt)}</td><td className={`${s.n} ${s.taken}`}>{num(r.taken)}</td><td className={s.n}>{r.hits}</td><td className={s.n}>{r.hitsTaken}</td>
          </tr>
        ))}</tbody>
      </table>
      <div className={s.hits}><table>
        <thead><tr><th>Trước khi chết</th><th>Đòn</th><th className={s.n}>Sát thương</th></tr></thead>
        <tbody>{f.hits.map((h, i) => (
          <tr key={i}><td className={s.mutedLine}>{h.t - scene.t === 0 ? 'lúc chết' : `${h.t - scene.t} s`}</td>
            <td>{nameOf(h.attacker)} <span className={s.mutedLine}>→</span> {nameOf(h.victim)}</td>
            <td className={`${s.n} ${s.taken}`}>−{num(h.amount)}{h.ticks > 1 && <span className={s.mutedLine}> (cắn giữ ×{h.ticks})</span>}</td></tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
