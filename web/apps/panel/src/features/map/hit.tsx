import type { ReactNode } from 'react';
import { toGame, unitsOf } from '../../lib/map';
import { dinoName, pct, shortId } from '../../lib/format';
import { prDur } from '../../lib/players';
import { ago } from '../../lib/time';
import { LAYER, NUTRI, ZONE_VN, fishName, floraZoneState, foodName, nutriColor, nutriMark, plantName as plantLabel, type Feature, type Pt } from './data';
import { visible } from './draw';
import { az, fromScr, lm, scr, shownPos, aiZoneOf, type Hit } from './store';
import { inPolyGame, toMap, zoneHandles, zoneHas, zoneSize, type AiZone } from './zones';

function inPoly(pt: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as Pt, [xj, yj] = ring[j] as Pt;
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inShape(pt: Pt, f: Feature): boolean {
  if (f.kind === 'circle' && f.at && f.r) {
    const a = (-(f.rot ?? 0) * Math.PI) / 180;
    const dx = pt[0] - f.at[0], dy = pt[1] - f.at[1];
    const u = dx * Math.cos(a) - dy * Math.sin(a), v = dx * Math.sin(a) + dy * Math.cos(a);
    return (u / f.r[0]) ** 2 + (v / f.r[1]) ** 2 <= 1;
  }
  return f.kind === 'poly' && (f.pts ?? []).some((ring) => inPoly(pt, ring));
}
export function aiZoneAt(sx: number, sy: number): AiZone | null {
  if (!lm.on.has('aizone') || !az.draft || !lm.view) return null;
  const [gx, gy] = toGame(fromScr(sx, sy));
  let best: { zn: AiZone; d: number } | null = null;
  for (const zn of az.draft.zones) {
    if (!zoneHas(zn, gx, gy)) continue;
    const d = Math.hypot(gx - zn.x, gy - zn.y);
    if (!best || d < best.d) best = { zn, d };
  }
  return best?.zn ?? null;
}
/** What a press at (sx, sy) grabs on the selected zone: a handle, or its inside (move). */
export function zoneGrab(sx: number, sy: number): { mode: 'move' | 'handle'; key?: string; zn: AiZone; off?: Pt } | null {
  if (!lm.on.has('aizone') || !az.draft || !az.sel || az.placing || az.drawing) return null;
  const zn = az.draft.zones.find((z) => z.id === az.sel);
  if (!zn) return null;
  for (const h of zoneHandles(zn)) {
    const [hx, hy] = scr(toMap(h.at));
    if (Math.hypot(sx - hx, sy - hy) <= 11) return { mode: 'handle', key: h.key, zn };
  }
  const [gx, gy] = toGame(fromScr(sx, sy));
  if (zoneHas(zn, gx, gy)) return { mode: 'move', zn, off: [gx - zn.x, gy - zn.y] };
  return null;
}

/** What is under the pointer: a player, an AI, an AI zone, a plant, a plant area, a feature. */
export function hitTest(sx: number, sy: number): Hit | null {
  if (!lm.view || !lm.data) return null;
  const z = lm.view.s / lm.fit;
  const near = (p: Pt, r: number): boolean => { const [x, y] = scr(p); return Math.hypot(x - sx, y - sy) <= r; };
  for (const p of lm.players) if (near(shownPos(p), 12)) return { player: p };
  if (lm.ai && !lm.ai.stale) {
    for (const a of lm.ai.list) if (lm.on.has(a.f ? 'fish' : 'ai') && near(unitsOf(a), 8)) return { ai: a };
  }
  const zn = aiZoneAt(sx, sy);
  if (zn) return { azone: zn };
  if (lm.on.has('flora') && lm.flora) {
    let best: { p: NonNullable<Hit['plant']>; d: number } | null = null;
    for (const p of [...lm.flora.plants, ...lm.flora.fruits]) {
      const [x, y] = scr(toMap([p.x, p.y]));
      const d = Math.hypot(x - sx, y - sy);
      if (d <= 7 && (!best || d < best.d)) best = { p, d };
    }
    if (best) return { plant: best.p };
  }
  if (lm.on.has('migrlive') && lm.floraZones.length) {
    const [gx, gy] = toGame(fromScr(sx, sy));
    const hit = lm.floraZones.find(({ sp }) => inPolyGame(sp.shape?.spline ?? [], gx, gy));
    if (hit) return { fzone: hit.sp };
  }
  const feats = lm.data.features.filter((f) => visible(f, z));
  for (const f of feats) for (const m of f.marks ?? []) if (near(m.at, 9)) return { f, mark: m };
  for (const f of feats) if ((f.kind === 'point' || f.kind === 'label') && f.at && near(f.at, 9)) return { f };
  const pt = fromScr(sx, sy);
  for (const f of feats) if ((f.kind === 'poly' || f.kind === 'circle') && inShape(pt, f)) return { f };
  return null;
}
/** The same thing hovered (no redraw needed). */
export const sameHit = (a: Hit | null, b: Hit | null): boolean =>
  (a?.player?.steamId ?? a?.ai ?? a?.azone ?? a?.mark ?? a?.f ?? a?.plant ?? a?.fzone) === (b?.player?.steamId ?? b?.ai ?? b?.azone ?? b?.mark ?? b?.f ?? b?.plant ?? b?.fzone);

const AI_ERRORS: Record<string, string> = {
  expired: 'server không nhận kịp (mod AIZones có đang chạy?)',
  'the player is offline or has no dino': 'người chơi đã offline hoặc chưa có dino',
  'no spot left far enough from other AI': 'hết chỗ đứng đủ xa AI khác (vùng thưa hơn mức đặt)',
  'no world to spawn in': 'chưa lấy được world của game',
};
export const aiError = (e: string): string => AI_ERRORS[e] ?? (/^class not found/.test(e) ? `game không có class này (${e.slice(17)})` : e);

/** The tooltip of what is hovered. */
export function Tip({ h, m }: { h: Hit; m: string }): ReactNode {
  if (h.plant && lm.flora) {
    const p = h.plant;
    const mark = nutriMark(p);
    const zone = p.s ? lm.flora.spawners.find((sp) => sp.id === p.s) : null;
    const rec = p as unknown as Record<string, number | undefined>;
    return <><b>{plantLabel(p.c)}</b>{mark && <> <span style={{ color: nutriColor(p) }}>{mark}</span></>}<br />
      {mark ? `Cho chất: ${NUTRI.filter(([k]) => (rec[k] ?? 0) > 0).map(([k, sym]) => `${sym} ${Math.round((rec[k] as number) * 100)}%`).join(' · ')}` : 'Không có chất (chỉ no bụng)'}
      {p.eaten && <><br />đã bị ăn</>}<br /><span className={m}>{zone ? floraZoneState(zone)[0] : 'không thuộc vùng cây nào'} · dữ liệu {ago(lm.flora.t)}</span></>;
  }
  if (h.fzone && lm.flora) {
    const sp = h.fzone;
    const flags = [sp.patrol ? 'tuần tra' : '', sp.nesting ? 'làm tổ' : '', sp.juvenile ? 'con non' : ''].filter(Boolean).join(', ');
    const inside = lm.flora.plants.filter((p) => p.s === sp.id).length;
    return <><b>{floraZoneState(sp)[0]}</b><br />{inside} cây trong vùng{sp.amount != null ? ` · game đặt ${sp.amount}` : ''}
      {sp.multiplier != null ? ` · hệ số ${sp.multiplier}` : ''}{flags && <><br />{flags}</>}<br /><span className={m}>dữ liệu {ago(lm.flora.t)}</span></>;
  }
  if (h.azone && az.draft) {
    const zn = h.azone;
    const st = az.status?.zones?.[zn.id];
    const names = zn.species.map((k) => az.speciesLabel[k] ?? k).join(', ');
    return <><b>{zn.name}</b>, vùng AI{zn.enabled && az.draft.enabled ? '' : ' (tắt)'}<br />{names}<br />
      <span className={m}>{zoneSize(zn)} · tối thiểu {zn.min} · tối đa {zn.max} khi có người<br />
        mỗi lượt {zn.perTurnMin === zn.perTurnMax ? zn.perTurnMin : `${zn.perTurnMin}–${zn.perTurnMax}`} con / {zn.everySec} s · cách nhau ≥ {zn.spacingM} m
        {st && typeof st.count === 'number' && <><br />đang có {st.count} · {st.occupied ? `có người${typeof st.nextTurn === 'number' ? `, lượt sau ${st.nextTurn} s` : ''}` : 'vắng người'}</>}
        {st?.lastError && <><br />gần nhất: {aiError(st.lastError)}</>}
        <br />bấm để sửa</span></>;
  }
  if (h.ai && lm.ai) {
    const a = h.ai;
    const age = Math.max(0, Math.round(Date.now() / 1000 - lm.ai.t));
    if (a.f) return <><b>{fishName(a.c)}</b><br />Cá trên server{typeof a.z === 'number' ? ` · độ cao ${Math.round(a.z / 100)} m` : ''}<br /><span className={m}>vị trí đọc {age} s trước</span></>;
    const zn = aiZoneOf(a);
    return <><b>{dinoName(a.c)}</b><br />AI trên server{typeof a.hp === 'number' ? ` · máu ${Math.round(a.hp)}` : ''}
      {zn && <><br />tính cho vùng AI "{zn.name}"</>}<br /><span className={m}>vị trí đọc {age} s trước</span></>;
  }
  if (h.player) {
    const p = h.player;
    const hp = (p.maxHealth ?? 0) > 0 && typeof p.health === 'number' ? ` · máu ${Math.round((p.health / (p.maxHealth as number)) * 100)}%` : '';
    return <><b>{p.name ?? shortId(p.steamId)}</b>{p.prison && <> <span style={{ color: '#fca5a5' }}>{p.prison.escaped ? '🚨 đang trốn ngục' : '🔒 ở tù'} · còn {prDur(p.prison.remainingSec)}</span></>}<br />
      {dinoName(p.species)} · {pct(p.growth)}{hp}<br /><span className={m}>bấm để mở trang người chơi</span></>;
  }
  const f = h.f as Feature;
  if (h.mark) {
    return h.mark.what === 'exit' ? <><b>Cửa hang</b><br />{f.name}</>
      : <><b>Luồng khí bốc lên</b><br />{f.name}{h.mark.hours && <><br /><span className={m}>Hoạt động {h.mark.hours} (giờ trong game)</span></>}</>;
  }
  if (f.kind === 'point') return <><b>{foodName(f.name)}</b><br /><span className={m}>{f.group ?? ''}{f.checked ? ` · kiểm tra ${f.checked}` : ''}</span></>;
  if (f.kind === 'label') return <><b>{(f.text ?? '').replace(/\n/g, ' ')}</b><br /><span className={m}>{LAYER[f.layer]?.label}</span></>;
  return <><b>{f.name}</b><br /><span className={m}>{ZONE_VN[f.layer] ?? LAYER[f.layer]?.label}{f.mass ? ' · di cư lớn (mass migration)' : ''}</span></>;
}
