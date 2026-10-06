import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson } from '@isle/api';
import { Button, Checkbox, NumberInput, Select, Switch, useToast } from '@isle/ui';
import { useConfirm } from '../../app/confirm';
import { useSession } from '../../app/session';
import { Avatar, PlayerLink } from '../../components/dino/Identity';
import { Meter } from '../../components/dino/Vitals';
import { dinoName, pct, shortId } from '../../lib/format';
import { aiError } from './hit';
import { az, centerOf, changed, clearTrail, flyTo, gd, lm, requestDraw, shownPos, useMapState, visibleTrail } from './store';
import s from './Map.module.css';

const speciesOptions = (kinds: ReadonlyArray<readonly [string, string]>) =>
  kinds.flatMap(([kind, group]) => (az.data?.species ?? []).filter((x) => x.kind === kind).map((x) => ({ value: x.key, label: x.label, group })));

/** Thả AI (mod AIZones, bridge/src/ai-drop.ts): next to a player online, a few AI of a kind. */
export function DropPane() {
  useMapState();
  const toast = useToast();
  const { withToken } = useSession();
  const online = lm.players.filter((p) => p.loc);
  const [who, setWho] = useState<string | null>(null);
  const [species, setSpecies] = useState('Tyrannosaurus');
  const [count, setCount] = useState(1);
  const [dist, setDist] = useState(8);
  const [growth, setGrowth] = useState(100);
  const target = who !== null && online.some((p) => p.steamId === who) ? who : online[0]?.steamId ?? '';
  const go = (): void => {
    if (!target) { toast('Chọn một người chơi đang online', 'err'); return; }
    const body = { steamId: target, species, count: Math.round(count), distanceM: Math.round(dist), growth: Math.round(growth) / 100 };
    const label = az.speciesLabel[species] ?? species;
    void withToken('thả AI', async (token) => {
      const { id } = await adminFetch<{ id: string }>('/api/ai-drop', 'POST', token, body);
      toast(`Đã gửi lệnh thả ${body.count} × ${label}, chờ server…`);
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const { result } = await getJson<{ result: { ok: boolean; made?: number; error?: string } | null }>(`/api/ai-drop?id=${id}`);
        if (!result) continue;
        if (result.ok) toast(`Đã thả ${result.made} con ${label}${result.error ? ` (thiếu vì ${aiError(result.error)})` : ''}`);
        else toast(`Không thả được: ${aiError(result.error ?? '?')}`, 'err');
        requestDraw();
        return;
      }
      toast('Server chưa nhận lệnh sau 30 giây, mod AIZones có đang chạy không?', 'err');
    });
  };
  return (
    <div className={s.pane}>
      <div className={s.row}><label htmlFor="drop-player">Người chơi</label>
        <Select id="drop-player" value={target} onChange={setWho}
          options={online.length === 0 ? [{ value: '', label: '(không có ai online)' }] : online.map((p) => ({ value: p.steamId, label: `${p.name ?? shortId(p.steamId)} · ${dinoName(p.species)}` }))} /></div>
      <div className={s.row}><label htmlFor="drop-species">Loại AI</label>
        <Select id="drop-species" value={species} onChange={setSpecies} options={speciesOptions([['dino', 'Khủng long'], ['animal', 'Thú']])} /></div>
      <div className={s.grid}>
        <label>Số con (1–5)<NumberInput aria-label="Số con" min={1} max={5} value={count} onChange={setCount} /></label>
        <label>Cách (m)<NumberInput aria-label="Cách (m)" min={2} max={200} value={dist} onChange={setDist} /></label>
        <label>Growth (%)<NumberInput aria-label="Growth (%)" min={10} max={100} step={5} value={growth} onChange={setGrowth} /></label>
      </div>
      <Button onClick={go} disabled={online.length === 0}>Thả AI</Button>
      <details className={s.howto}><summary>Cách dùng</summary>
        <p>Dưới 15 m: thả ngay cạnh người chơi, chia đều vòng quanh họ. Từ 15 m: thả ở chỗ đã có người/AI từng đứng, các con
          cách nhau ≥ 15 m. Không tính vào tổng AI toàn server; server không nhận trong 30 giây thì lệnh tự huỷ.</p>
      </details>
    </div>
  );
}

const RESET_STEP: Record<string, string> = { countdown: 'đang đếm ngược', killing: 'mod đang giết AI…', wiping: 'đang dọn xác…', done: 'xong', failed: 'thất bại', cancelled: 'đã huỷ' };
interface ResetOp { species: string[]; keepZoneSpecies: boolean; step: string; runAt: number; killed?: number; message?: string }
const COUNTDOWNS = [{ value: '0', label: 'Ngay lập tức' }, { value: '30', label: '30 giây' }, { value: '60', label: '1 phút' }, { value: '120', label: '2 phút' }, { value: '300', label: '5 phút' }];

/** Làm mới AI (bridge/src/ai-reset.ts): kill the AI (a kind, all, or all but the zones' kinds), then clear the bodies. */
export function ResetPane() {
  useMapState();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { withToken } = useSession();
  const st = useQuery({ queryKey: ['/api/ai-reset'], queryFn: () => getJson<{ current: ResetOp | null; last: ResetOp | null }>('/api/ai-reset'),
    refetchInterval: (q) => (q.state.data?.current ? 1500 : 10_000) }).data;
  const [pick, setPick] = useState('');
  const [countdown, setCountdown] = useState('60');
  const [wipe, setWipe] = useState(true);
  const op = st?.current ?? st?.last ?? null;
  const go = (): void => {
    const notZone = pick === '__notzone';
    const key = notZone ? '' : pick;
    const countdownSec = Number(countdown);
    const what = notZone ? 'mọi AI KHÔNG thuộc loài của các vùng đang bật (giữ lại AI của vùng)' : key ? (az.speciesLabel[key] ?? key) : 'TẤT CẢ AI trên server';
    confirm({
      title: 'Làm mới AI?', okLabel: 'Làm mới AI',
      body: <>Giết <b>{what}</b>{countdownSec ? `, báo trước cho người chơi ${countdownSec >= 60 ? `${countdownSec / 60} phút` : `${countdownSec} giây`}` : ' ngay lập tức'}
        {wipe ? ', rồi dọn mọi xác (cả xác của người chơi)' : ''}. Không hoàn tác được.</>,
      run: async (token) => {
        await adminFetch('/api/ai-reset', 'POST', token, { countdownSec, species: key ? [key] : [], keepZoneSpecies: notZone, wipeCorpses: wipe });
        toast('Đã bắt đầu làm mới AI.');
        await qc.invalidateQueries({ queryKey: ['/api/ai-reset'] });
      },
    });
  };
  const cancel = (): void => {
    void withToken('huỷ làm mới AI', async (token) => {
      await adminFetch('/api/ai-reset/cancel', 'POST', token);
      toast('Đã huỷ làm mới AI.');
      await qc.invalidateQueries({ queryKey: ['/api/ai-reset'] });
    });
  };
  const what = op ? (op.species.length ? op.species.map((k) => az.speciesLabel[k] ?? k).join(', ') : op.keepZoneSpecies ? 'AI ngoài loài của vùng' : 'mọi AI') : '';
  return (
    <div className={s.pane}>
      <div className={s.row}><label htmlFor="reset-species">AI cần làm mới</label>
        <Select id="reset-species" value={pick} onChange={setPick}
          options={[{ value: '', label: 'Tất cả AI' }, { value: '__notzone', label: 'Chỉ AI không thuộc loài của vùng' }, ...speciesOptions([['dino', 'Khủng long'], ['animal', 'Thú']])]} /></div>
      <div className={s.row}><label htmlFor="reset-countdown">Báo trước</label><Select id="reset-countdown" value={countdown} onChange={setCountdown} options={COUNTDOWNS} /></div>
      <Switch id="reset-wipe" checked={wipe} onChange={setWipe} label="Dọn xác sau đó (cả xác người chơi)" />
      {op && (
        <div className={s.hint2}>{st?.current ? 'Đang chạy' : 'Lần gần nhất'}: làm mới {what}, <b>{RESET_STEP[op.step] ?? op.step}</b>
          {op.step === 'countdown' && ` · còn ${Math.max(0, Math.round((op.runAt - Date.now()) / 1000))} s`}
          {typeof op.killed === 'number' && ` · ${op.killed} con`}{op.message && <> · <span className={s.kill}>{op.message}</span></>}</div>
      )}
      <div className={s.row} style={{ justifyContent: 'flex-start', gap: 8 }}>
        <Button variant="dangerSolid" onClick={go} disabled={!!st?.current}>Làm mới AI</Button>
        {st?.current?.step === 'countdown' && <Button variant="ghost" small onClick={cancel}>Huỷ</Button>}
      </div>
      <details className={s.howto}><summary>Cách dùng</summary>
        <p>Game không cho xoá AI từ mod (xoá là crash server), nên AI bị <b>giết</b> rồi dọn xác bằng lệnh của game; game và
          các vùng tự sinh AI mới. Dino của người chơi (kể cả con offline) không bị đụng tới. Nội dung thông báo sửa ở <a href="#mods/messages">Tính năng mod → Thông báo</a>.</p>
      </details>
    </div>
  );
}

/** Dino nhỏ (bridge/src/zone-guard.ts, mods/ZoneGuard): big dinos stung in the sanctuaries and zones marked. */
export function GuardPane() {
  useMapState();
  const toast = useToast();
  const qc = useQueryClient();
  const { withToken } = useSession();
  const d = gd.draft, data = gd.data;
  if (!d || !data) return <div className={s.pane}><span className={s.hint2}>Đang tải…</span></div>;
  const edit = (fn: () => void): void => { fn(); gd.dirty = true; changed(); };
  const small = (az.draft?.zones ?? []).filter((zn) => zn.smallOnly);
  const count = d.sanctuaries.length + small.length;
  const save = (): void => {
    void withToken('lưu luật dino nhỏ', async (token) => {
      await adminFetch('/api/zone-guard', 'PUT', token, gd.draft);
      gd.dirty = false;
      toast('Đã lưu luật dino nhỏ, mod áp dụng trong vài giây.');
      await qc.invalidateQueries({ queryKey: ['/api/zone-guard'] });
      changed();
    });
  };
  return (
    <div className={s.pane}>
      <Switch id="gd-enabled" checked={d.enabled} onChange={(v) => edit(() => { d.enabled = v; })} label={<b>Bật luật chỉ dino nhỏ</b>} />
      <div className={s.grid}>
        <label>Cảnh báo trước khi đốt (giây)<NumberInput aria-label="Cảnh báo trước khi đốt (giây)" min={0} max={600} step={5} value={d.graceSec} onChange={(v) => edit(() => { d.graceSec = Math.round(v); })} /></label>
        <label>Mỗi lần đốt cách (giây)<NumberInput aria-label="Mỗi lần đốt cách (giây)" min={1} max={60} value={d.everySec} onChange={(v) => edit(() => { d.everySec = Math.round(v); })} /></label>
        <label>Mất máu mỗi lần (% máu tối đa)<NumberInput aria-label="Mất máu mỗi lần" min={1} max={100} value={d.pct} onChange={(v) => edit(() => { d.pct = Math.round(v); })} /></label>
        <label>Tăng trưởng tối đa mặc định (%)<NumberInput aria-label="Tăng trưởng tối đa mặc định (%)" min={5} max={100} step={5} value={Math.round(d.defaultMax * 100)} onChange={(v) => edit(() => { d.defaultMax = Math.min(100, Math.max(5, v)) / 100; })} /></label>
      </div>
      <details className={s.sec} open><summary>Tăng trưởng tối đa theo loài</summary>
        <div className={s.hint2} style={{ marginBottom: 6 }}>Bỏ chọn = dùng mức mặc định ở trên. Dino lớn hơn mức này bị coi là "dino lớn".</div>
        <div className={s.gdSpecies}>{data.species.map((sp) => {
          const v = d.maxBySpecies[sp];
          return (
            <label key={sp} title={sp}><span>{sp}</span>
              <Select aria-label={`Tăng trưởng tối đa ${sp}`} value={v === undefined ? '' : String(Math.round(v * 100))}
                options={[{ value: '', label: `${Math.round(d.defaultMax * 100)} (mặc định)` }, ...Array.from({ length: 20 }, (_, i) => ({ value: String((i + 1) * 5), label: String((i + 1) * 5) }))]}
                onChange={(x) => edit(() => { if (x === '') delete d.maxBySpecies[sp]; else d.maxBySpecies[sp] = Number(x) / 100; })} />
            </label>
          );
        })}</div>
      </details>
      <details className={s.sec} open><summary>Khu bảo tồn áp dụng</summary>
        <div className={s.gdSanct}>
          {data.knownSanctuaries.length === 0 && <span className={s.hint2}>Bản đồ không có khu bảo tồn nào.</span>}
          {data.knownSanctuaries.map((n) => (
            <div key={n}>
              <Checkbox checked={d.sanctuaries.includes(n)} label={n.replace(/^Sanctuary\s*/, 'Khu ')}
                onChange={(v) => edit(() => { const on = new Set(d.sanctuaries); if (v) on.add(n); else on.delete(n); d.sanctuaries = [...on]; })} />
              <button type="button" className={s.go} title="Tới trên bản đồ" onClick={() => {
                const f = lm.data?.features.find((x) => x.layer === 'sanctuary' && x.name === n);
                if (f) flyTo(centerOf(f), 4);
              }}>↗</button>
            </div>
          ))}
        </div>
      </details>
      <details className={s.sec} open><summary>Vùng AI áp dụng</summary>
        <div className={s.hint2}>{small.length ? <>{small.map((zn, i) => <span key={zn.id}>{i > 0 && ', '}<b>{zn.name}</b></span>)}, bật/tắt bằng ô "Chỉ dino nhỏ" trong từng vùng (tab Vùng AI).</>
          : <>Chưa vùng AI nào. Mở một vùng ở tab <b>Vùng AI</b> và tick "Chỉ dino nhỏ".</>}</div>
      </details>
      <div className={s.hint2}>{!d.enabled ? 'Đang tắt.' : count === 0 ? 'Đang bật nhưng chưa chọn vùng nào.'
        : <>Đang áp dụng ở {count} vùng{gd.dirty && <>, <b className={s.warnTxt}>chưa lưu</b></>}.</>}</div>
      <Button onClick={save}>Lưu luật dino nhỏ</Button>
      <details className={s.howto}><summary>Cách dùng</summary>
        <p>Dino của người chơi lớn hơn mức cho phép đi vào vùng được chọn: nhận cảnh báo giữa màn hình, sau thời gian cảnh báo
          mà vẫn ở trong vùng thì bị <b>ong đốt</b>, mỗi lần mất % máu tối đa, ở lì thì chết. Ra khỏi vùng là dừng; quay lại
          trong vòng 1 phút thì bị đốt ngay, không được cảnh báo lại. Nội dung tin nhắn sửa ở
          {' '}<a href="#mods/messages">Tính năng mod → Thông báo</a>. Có hiệu lực trong vài giây, không cần khởi động lại.</p>
        <p>Hình khu bảo tồn lấy từ lớp Sanctuary của bản đồ (VulnonaMAP). AI không bị ảnh hưởng.</p>
      </details>
    </div>
  );
}

/** Người chơi trên bản đồ: click to fly there, hide a trail. */
export function PlayersPane() {
  useMapState();
  return (
    <div className={s.pane}>
      <div className={s.row}><span className={s.hint2}>Bấm để tới vị trí</span>
        <Button variant="soft" small title="Chỉ ẩn trên trình duyệt này; vệt mới vẫn vẽ tiếp" onClick={() => { for (const p of lm.players) clearTrail(p); }}>Xóa mọi vệt</Button></div>
      <ul className={s.rank}>
        {lm.players.length === 0 && <li className={s.rankEmpty}>Chưa có ai đang điều khiển dino</li>}
        {lm.players.map((p) => (
          <li key={p.steamId} onClick={(e) => { if ((e.target as HTMLElement).closest('a,button')) return; if (lm.data) flyTo(shownPos(p), 5); }}>
            <Avatar id={p.steamId} name={p.name} size="sm" />
            <div className={s.who}><div className={s.nm}><PlayerLink id={p.steamId} name={p.name} /></div><div className={s.spc}>{dinoName(p.species)} · {pct(p.growth)}</div></div>
            <div className={s.score}>{(p.maxHealth ?? 0) > 0 ? <Meter value={p.health} max={p.maxHealth as number} /> : <span className={s.n}>–</span>}
              {visibleTrail(p).length > 0 && <button type="button" className={s.trailClear} onClick={() => clearTrail(p)}>xóa vệt</button>}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
