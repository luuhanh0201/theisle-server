import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminFetch, getJson, type PlayerRow } from '@isle/api';
import { Button, Card, CardBody, CardHead, NumberInput, Select, Slider, Switch, TextInput, useToast } from '@isle/ui';
import { useSession } from '../../../app/session';
import { dinoName, isNum } from '../../../lib/format';
import { parseCoords, toGame } from '../../../lib/map';
import s from './Player.module.css';

/** What the admin card reads of the player (the snapshot: current values, the maxima). */
export interface LivePlayer {
  steamId: string; online: boolean; species: string | null; growth: number | null;
  health: number | null; stamina: number | null; hunger: number | null; thirst: number | null; oxygen: number | null; blood: number | null;
  carb?: number | null; protein?: number | null; lipid?: number | null;
  max: Record<string, number> | null;
}

export const VITALS: ReadonlyArray<readonly [string, string]> = [['health', 'Máu'], ['hunger', 'Dạ dày'], ['thirst', 'Nước'], ['stamina', 'Thể lực'], ['blood', 'Huyết'],
  ['oxygen', 'Oxy'], ['carb', 'Carb'], ['protein', 'Protein'], ['lipid', 'Lipid']];
const DIET = ['hunger', 'thirst', 'carb', 'protein', 'lipid'];
const PRESETS: ReadonlyArray<readonly [number, string]> = [[20, '🐣 20% (Con non)'], [50, '🦖 50% (Thiếu niên)'], [75, '🦕 75% (Cận lớn)'], [100, '👑 100% (Trưởng thành)']];
const TABS: ReadonlyArray<readonly [Tab, string]> = [['vitals', '🩺 Chỉ số sinh tồn'], ['grow', '📈 Tăng trưởng'], ['tp', '📍 Dịch chuyển'], ['all', '📑 Xem tất cả']];
type Tab = 'vitals' | 'grow' | 'tp' | 'all';

/** Each vital as a share of its max (%), null when the snapshot lacks it. */
export function sharesOf(p: LivePlayer): Record<string, number | null> {
  const m = p.max ?? {};
  const rec = p as unknown as Record<string, unknown>;
  return Object.fromEntries(VITALS.map(([k]) => {
    const v = rec[k];
    const mx = m[k];
    return [k, isNum(v) && isNum(mx) && mx > 0 ? Math.round((v / mx) * 100) : null];
  }));
}

/** Thao tác admin (POST /api/player/<id>/admin; mods/DinoGarage garage/admin.lua): heal, vitals, growth, teleport. */
export function PlayerAdmin({ p }: { p: LivePlayer }) {
  const toast = useToast();
  const { withToken } = useSession();
  const off = !p.online || !p.species;
  const [tab, setTab] = useState<Tab>('vitals');
  // The sliders keep what the admin set: the 2 s refresh does not reset them (as before React).
  const [start, setStart] = useState(() => sharesOf(p));
  const [vals, setVals] = useState<Record<string, number>>({});
  const [grow, setGrow] = useState(() => (isNum(p.growth) ? Math.round(p.growth * 100) : 100));
  const [prime, setPrime] = useState(false);
  const [to, setTo] = useState<string | null>(null);
  const [xy, setXy] = useState('');
  const [status, setStatus] = useState<{ tone: 'ok' | 'err' | 'sending'; text: string } | null>(null);
  const others = (useQuery({ queryKey: ['/api/players'], queryFn: () => getJson<{ players: PlayerRow[] }>('/api/players'), refetchInterval: 5000 }).data?.players ?? [])
    .filter((x) => x.online && x.steamId !== p.steamId);
  const target = to !== null && others.some((x) => x.steamId === to) ? to : others[0]?.steamId ?? '';

  const send = (body: object, label: string): void => {
    void withToken(label, async (token) => {
      setStatus({ tone: 'sending', text: `Đang gửi lệnh “${label}”…` });
      try {
        const { command } = await adminFetch<{ command: { id: number } }>(`/api/player/${encodeURIComponent(p.steamId)}/admin`, 'POST', token, body);
        setStatus({ tone: 'ok', text: `Đã gửi “${label}” (lệnh #${command.id}), game thực hiện trong vài giây.` });
        toast(`Đã gửi: ${label}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus({ tone: 'err', text: msg });
        toast(msg, 'err');
      }
    });
  };
  const setAll = (keys: string[]): void => setVals((v) => ({ ...v, ...Object.fromEntries(keys.map((k) => [k, 100])) }));
  const applyVitals = (): void => {
    const keys = Object.keys(vals);
    if (keys.length === 0) { toast('Chưa kéo chỉ số nào', 'err'); return; }
    send({ action: 'vitals', values: Object.fromEntries(keys.map((k) => [k, (vals[k] as number) / 100])) }, 'chỉnh chỉ số');
  };
  const applyGrow = (): void => {
    if (!(grow >= 10 && grow <= 100)) { toast('Tăng trưởng 10–100%', 'err'); return; }
    if (prime && grow !== 100) { toast('Prime chỉ đặt được ở tăng trưởng 100%', 'err'); return; }
    send({ action: 'grow', growth: grow / 100, ...(prime ? { prime: true } : {}) }, `tăng trưởng ${grow}%${prime ? ' + prime' : ''}`);
  };
  const tpPlayer = (): void => {
    if (!target) { toast('Không có người chơi nào để dịch chuyển tới', 'err'); return; }
    const x = others.find((o) => o.steamId === target);
    send({ action: 'teleport', toPlayer: target }, `dịch chuyển tới ${x ? `${x.name ?? x.steamId} · ${dinoName(x.species)}` : target}`);
  };
  const tpXy = (): void => {
    const pt = parseCoords(xy);
    if (!pt) { toast('Toạ độ như trong game: "349,211, 148,696" (Y, X)', 'err'); return; }
    const [x, y] = toGame(pt);
    send({ action: 'teleport', to: { x, y } }, `dịch chuyển tới ${x}, ${y}`);
  };
  const show = (t: Tab): boolean => tab === 'all' || tab === t;
  const shown = off ? { tone: 'off' as const, text: 'Người chơi không online hoặc chưa có dino.' } : status;

  return (
    <Card>
      <CardHead title={<><span className={s.shield}>🛡</span>Thao tác admin</>} sub="lệnh trực tiếp vào game (/adminpanel) · người chơi phải online" />
      <CardBody>
        <div className={s.padm}>
          <div className={s.heal}>
            <div className={s.healInfo}>
              <div className={s.healTitle}><span className={s.badge}>Cấp tốc</span><b>Hồi phục toàn diện</b></div>
              <div className={s.healDesc}>Hồi đầy 100% máu, huyết, thể lực, oxy · Gỡ bỏ gãy xương, trúng độc, nôn mửa</div>
            </div>
            <button type="button" className={s.healBtn} disabled={off} onClick={() => send({ action: 'heal' }, 'hồi máu & chữa trị')}><span>❤️</span> Hồi máu & chữa trị</button>
          </div>
          <div className={s.tabs} role="tablist" aria-label="Mục thao tác admin">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={`${s.tab}${tab === id ? ` ${s.on}` : ''}`} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {show('vitals') && (
            <div className={s.section}>
              <div className={s.toolbar}>
                <div className={s.toolbarLeft}>
                  <span className={s.quickLbl}>Đặt nhanh:</span>
                  <Button variant="ghost" small disabled={off} title="Kéo tất cả chỉ số lên 100%" onClick={() => setAll(VITALS.map(([k]) => k))}>⚡ Đầy 100%</Button>
                  <Button variant="ghost" small disabled={off} title="Kéo carb, protein, lipid, đói, khát lên 100%" onClick={() => setAll(DIET)}>🍖 Đầy dinh dưỡng</Button>
                  <Button variant="ghost" small disabled={off} title="Khôi phục về snapshot ban đầu" onClick={() => { setStart(sharesOf(p)); setVals({}); }}>↺ Lấy lại số hiện tại</Button>
                </div>
                <Button disabled={off} onClick={applyVitals}>✓ Áp chỉ số</Button>
              </div>
              <div className={s.vitals}>
                {VITALS.map(([k, label]) => {
                  const changed = k in vals;
                  const v = vals[k] ?? start[k] ?? null;
                  return (
                    <div key={k} className={`${s.vital}${changed ? ` ${s.changed}` : ''}`} data-k={k}>
                      <span className={s.vName}><i className={s.vDot} data-k={k} />{label}</span>
                      <Slider aria-label={label} min={0} max={100} value={v ?? 100} onChange={(n) => setVals((x) => ({ ...x, [k]: n }))} />
                      <b>{v === null ? '–' : `${v}%`}</b>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {show('grow') && (
            <div className={s.box}>
              <div className={s.growHead}>
                <div className={s.inline}><b>Mức tăng trưởng mục tiêu</b><span className={s.mutedSm}>(từ 10% đến 100%)</span></div>
                <span className={s.mutedSm}>Giữ nguyên % các chỉ số sinh tồn</span>
              </div>
              <div className={s.presets} role="group" aria-label="Mốc tăng trưởng chuẩn">
                <span className={s.quickLbl}>Mốc chuẩn:</span>
                {PRESETS.map(([n, label]) => <Button key={n} variant="ghost" small disabled={off} onClick={() => setGrow(n)}>{label}</Button>)}
              </div>
              <div className={s.growCtrl}>
                <div className={s.growSlider}><Slider aria-label="Kéo mức tăng trưởng" min={10} max={100} value={grow} onChange={setGrow} /></div>
                <div className={s.growVal}><NumberInput aria-label="Nhập % tăng trưởng" min={10} max={100} value={grow} onChange={setGrow} /><span>%</span></div>
                <span title="Prime chỉ đặt được ở 100%: đủ 10 điều kiện prime rồi game tính lại chỉ số prime sau vài giây">
                  <Switch checked={prime} onChange={setPrime} label="👑 Prime" disabled={off} /></span>
                <Button disabled={off} onClick={applyGrow}>Đặt tăng trưởng</Button>
              </div>
            </div>
          )}
          {show('tp') && (
            <div className={s.tpGrid}>
              <div className={s.box}>
                <div className={s.tpHead}><b>👥 Tới người chơi online</b><span className={s.mutedSm}>Dịch chuyển đặt cạnh đồng đội hoặc mục tiêu</span></div>
                <Select aria-label="Chọn người chơi đích" value={target} onChange={setTo}
                  options={others.length > 0 ? others.map((x) => ({ value: x.steamId, label: `${x.name ?? x.steamId} · ${dinoName(x.species)}` })) : [{ value: '', label: '(không ai khác online)' }]} />
                <Button disabled={off} onClick={tpPlayer}>Dịch chuyển tới người chơi</Button>
              </div>
              <div className={s.box}>
                <div className={s.tpHead}><b>📍 Tới toạ độ bản đồ</b><span className={s.mutedSm}>Hạ thổ xuống điểm đất an toàn gần nhất (≤ 50 m)</span></div>
                <TextInput aria-label="Toạ độ dịch chuyển" placeholder="Toạ độ game: ví dụ 349,211, 148,696" value={xy} onChange={(e) => setXy(e.target.value)} />
                <Button disabled={off} onClick={tpXy}>Dịch chuyển tới toạ độ</Button>
              </div>
            </div>
          )}
          {shown && <div className={`${s.padmStatus} ${s[shown.tone]}`} role="status">{shown.text}</div>}
        </div>
      </CardBody>
    </Card>
  );
}
