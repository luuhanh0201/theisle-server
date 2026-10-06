import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Select } from '@isle/ui';
import type { PlayerMe } from '@isle/api';
import { ERROR_VI, waitCommand } from '../../lib/commands';
import { useDino3D } from '../../lib/dino3d';
import { ME } from '../../lib/queries';
import { cardMatches, demoSlots, FINAL_VI, GARA_TIER, replyVi, type Diet } from './garage';
import { Slot } from './Slot';

type Status = { kind: '' | 'ok' | 'bad'; node: ReactNode } | null;
const Msgs = ({ list }: { list: string[] }) => (list.length > 0 ? <ul>{list.map((m, i) => <li key={i}>{replyVi(m)}</li>)}</ul> : null);

/**
 * The web garage: the player's own store / redeem (POST /api/garage → the bridge queues it → DinoGarage runs
 * it in game). A store counts down while the dino stands still; /api/command/<id> gives the start (accepted
 * or refused, with the game's reply) and then how the countdown ended.
 */
export function Garage({ me }: { me: PlayerMe | null | undefined }) {
  const qc = useQueryClient();
  const api = useDino3D(true);
  const [busy, setBusy] = useState(false);
  const [storing, setStoring] = useState<{ until: number } | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [where, setWhere] = useState('here');
  const [search, setSearch] = useState('');
  const [diet, setDiet] = useState<Diet>('all');
  const [preview, setPreview] = useState(false);
  const [, tick] = useState(0);
  // The store's countdown is redrawn every second.
  useEffect(() => {
    if (!storing) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [storing]);
  const list = useRef<HTMLUListElement>(null);
  // The filter goes by what each card shows, as before React.
  useLayoutEffect(() => {
    for (const card of list.current?.querySelectorAll<HTMLElement>('.garage-slot-card') ?? []) {
      card.style.display = cardMatches(card.textContent ?? '', search, diet) ? '' : 'none';
    }
  });

  const rules = me?.garageRules ?? { maxSlots: 3, redeemAt: 'current', storeCountdown: 30, cooldown: 180, tier: 'normal' };
  const send = async (action: 'store' | 'redeem', slot?: string, at?: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setStatus({ kind: '', node: action === 'store' ? 'Đang gửi lệnh cất…' : 'Đang gửi lệnh lấy ra…' });
    let released = false;
    try {
      const r = await fetch('/api/garage', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...(slot ? { slot } : {}), ...(at ? { where: at } : {}) }),
      });
      const body = await r.json().catch(() => null) as { id?: unknown; error?: string } | null;
      if (r.status === 429) { setStatus({ kind: 'bad', node: 'Chậm lại chút: mỗi vài giây chỉ một lệnh.' }); return; }
      if (r.status !== 202 || typeof body?.id !== 'number') {
        setStatus({ kind: 'bad', node: `Không gửi được lệnh${body?.error ? `: ${body.error}` : ''}.` });
        return;
      }
      const id = body.id;
      setStatus({ kind: '', node: 'Đã gửi, chờ game xử lý…' });
      // 1) Did the game take it? (the mod polls its inbox every 2 s)
      const start = await waitCommand(id, 20, (b) => b.status === 'done');
      if (start === null) { setStatus({ kind: 'bad', node: 'Chưa thấy game trả lời. Thử lại sau ít phút.' }); return; }
      const msgs = <Msgs list={start.messages ?? []} />;
      if (!start.ok) {
        const err = start.error ? ERROR_VI[start.error] ?? start.error : '';
        setStatus({ kind: 'bad', node: <>❌ {err || 'Game từ chối lệnh.'}{msgs}</> });
        return;
      }
      if (action === 'redeem') { setStatus({ kind: 'ok', node: <>✅ Game đang khôi phục dino.{msgs}</> }); return; }
      // 2) A store: the countdown runs in game; wait for how it ends.
      const secs = rules.storeCountdown ?? 30;
      setStoring({ until: Date.now() + secs * 1000 });
      setStatus({ kind: '', node: <>⏳ Game đã nhận lệnh, đang đếm ngược.{msgs}</> });
      setBusy(false);
      released = true;
      const end = await waitCommand(id, secs + 20, (b) => b.final != null);
      setStoring(null);
      if (end === null || !end.final) setStatus({ kind: 'bad', node: 'Không nhận được kết quả cất. Kiểm tra lại gara sau ít giây.' });
      else if (end.final.ok) setStatus({ kind: 'ok', node: <>✅ Đã cất dino vào gara. Respawn đúng loài rồi bấm <b>Lấy ra</b> khi muốn chơi lại.</> });
      else setStatus({ kind: 'bad', node: `❌ Cất thất bại: ${FINAL_VI[end.final.reason ?? ''] ?? end.final.reason ?? 'không rõ lý do'}. Bạn có thể cất lại ngay.` });
    } catch {
      setStatus({ kind: 'bad', node: 'Mất kết nối khi gửi lệnh. Thử lại.' });
    } finally {
      if (!released) setBusy(false);
      void qc.refetchQueries({ queryKey: [ME] }).catch(() => undefined);
    }
  };

  // A guest: the card as the page has it before any data.
  if (!me) {
    return (
      <div className="card">
        <Head count="0 slot" tier={null} />
        <div className="garage-actions">
          <div className="garage-store-row"><button type="button" className="btn btn-emerald" id="gara-store-btn" disabled>📥 Cất dino đang chơi</button></div>
          <p className="muted garage-hint" id="gara-store-hint">Đăng nhập và vào game để cất / lấy dino.</p>
          <div className="garage-status" id="gara-status" role="status" aria-live="polite" hidden />
        </div>
        <Filters search={search} setSearch={setSearch} diet={diet} setDiet={setDiet} preview={preview} setPreview={setPreview} />
        <ul className="garage-list" id="gara-slots-list" ref={list}><li className="muted" style={{ padding: 16, textAlign: 'center' }}>Chưa có dino nào trong gara.</li></ul>
      </div>
    );
  }

  const maxText = rules.maxSlots == null ? '∞' : rules.maxSlots;
  // Store: needs a dino in game, a free place, nothing in flight; the admin's minimums (the game checks them again).
  const playing = Boolean(me.online && me.dino);
  const full = rules.maxSlots != null && me.garage.length >= rules.maxSlots;
  const d = me.dino;
  const hpPct = d && typeof d.vitals?.health === 'number' && typeof d.max?.health === 'number' && d.max.health > 0 ? d.vitals.health / d.max.health * 100 : null;
  const growPct = d && typeof d.growth === 'number' ? d.growth * 100 : null;
  const minHp = rules.minHealthPct ?? 0;
  const minGrow = rules.minGrowthPct ?? 0;
  const lowHp = minHp > 0 && hpPct !== null && hpPct < minHp;
  const young = minGrow > 0 && growPct !== null && growPct < minGrow - 1e-6;
  const hint = storing
    ? `Đang cất: còn ${Math.max(0, Math.ceil((storing.until - Date.now()) / 1000))} giây: đứng yên trong bán kính 5 m, không đánh và không bị đánh.`
    : !me.online ? 'Vào game để cất / lấy dino.'
      : !me.dino ? 'Chọn loài và spawn dino trước.'
        : full ? `Gara đã đầy (${rules.maxSlots}), lấy bớt một con ra trước.`
          : lowHp ? `Máu phải từ ${minHp}% trở lên mới cất được (đang ${Math.floor(hpPct as number)}%).`
            : young ? `Dino phải lớn từ ${minGrow}% trở lên mới cất được (đang ${Math.floor(growPct as number)}%).`
              : `Cất ${me.dino.species ?? 'dino'} đang chơi: đếm ngược ${rules.storeCountdown} giây, trong lúc đó đứng yên (trong 5 m), không đánh và không bị đánh.`;
  const slots = preview ? demoSlots() : me.garage;
  const redeem = (slot: string): void => void send('redeem', slot, rules.redeemAt === 'choice' ? where : undefined);

  return (
    <div className="card">
      <Head count={preview ? 'Demo hiệu ứng' : `${me.garage.length} / ${maxText}`}
        tier={<>{GARA_TIER[rules.tier ?? ''] ?? GARA_TIER['normal']}: <b>{rules.maxSlots == null ? 'không giới hạn ô' : `${rules.maxSlots} ô`}</b>, chờ <b>{rules.cooldown ?? 0} giây</b> giữa 2 lần cất / lấy.</>} />
      <div className="garage-actions">
        <div className="garage-store-row">
          <button type="button" className="btn btn-emerald" id="gara-store-btn" disabled={busy || Boolean(storing) || !playing || full || lowHp || young} onClick={() => void send('store')}>📥 Cất dino đang chơi</button>
        </div>
        {rules.redeemAt === 'choice' && (
          <label className="garage-where" id="gara-where-box">
            Lấy ra tại
            <Select id="gara-where" aria-label="Lấy ra tại" value={where} onChange={setWhere} options={[{ value: 'here', label: 'chỗ đang đứng' }, { value: 'stored', label: 'chỗ đã cất' }]} />
          </label>
        )}
        <p className="muted garage-hint" id="gara-store-hint">{hint}</p>
        <div className={`garage-status${status?.kind ? ` ${status.kind}` : ''}`} id="gara-status" role="status" aria-live="polite" hidden={!status}>{status?.node}</div>
      </div>
      <Filters search={search} setSearch={setSearch} diet={diet} setDiet={setDiet} preview={preview} setPreview={setPreview} />
      <ul className="garage-list" id="gara-slots-list" ref={list}>
        {slots.length === 0 ? (
          <li style={{ padding: '32px 16px', textAlign: 'center', background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🚗</div>
            <b>Gara của bạn đang trống</b>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>Bấm <b>Cất dino đang chơi</b> ở trên để cất, hoặc bấm <b>Xem hiệu ứng thẻ</b> để xem hoạt ảnh.</p>
          </li>
        ) : slots.map((g) => {
          // Redeem: online, playing the SAME species (the mod checks it too).
          const same = me.dino && g.species && me.dino.species === g.species;
          const why = preview ? 'Mẫu thử nghiệm cấp độ' : !me.online ? 'Vào game trước' : !me.dino ? `Spawn ${g.species ?? 'đúng loài'} trước`
            : !same ? `Respawn thành ${g.species ?? 'đúng loài'} để lấy ra` : '';
          return <Slot key={g.slot} g={g} why={why} busy={busy} demo={preview} api={api} onRedeem={redeem} />;
        })}
      </ul>
    </div>
  );
}

function Head({ count, tier }: { count: string; tier: ReactNode }) {
  return (
    <div className="card-header">
      <div>
        <h3 className="card-title">🚗 Dino Đang Cất Trong Gara</h3>
        <span className="card-subtitle">Lưu giữ an toàn, khôi phục khi cần chơi</span>
        <span className="card-subtitle" id="gara-tier" style={{ display: 'block' }}>{tier}</span>
      </div>
      <span className="tag" id="gara-count-tag">{count}</span>
    </div>
  );
}

function Filters({ search, setSearch, diet, setDiet, preview, setPreview }: {
  search: string; setSearch: (v: string) => void; diet: Diet; setDiet: (d: Diet) => void; preview: boolean; setPreview: (v: boolean) => void;
}) {
  const tabs: ReadonlyArray<readonly [Diet, string]> = [['all', 'Tất cả'], ['carnivore', 'Ăn thịt (Carno)'], ['herbivore', 'Ăn cỏ (Herbi)']];
  return (
    <div className="gara-filter-bar">
      <div className="gara-search-box">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
        <input type="text" id="gara-search-input" placeholder="Tìm tên loài dino trong kho…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="gara-diet-tabs">
        {tabs.map(([k, label]) => <button key={k} type="button" className={`gara-filter-btn${diet === k ? ' active' : ''}`} data-diet={k} onClick={() => setDiet(k)}>{label}</button>)}
      </div>
      <button type="button" className={`gara-preview-btn${preview ? ' active' : ''}`} id="gara-preview-btn" title="Xem thử hiệu ứng hoạt ảnh của thẻ dino" onClick={() => setPreview(!preview)}>
        {preview ? '✕ Tắt xem hiệu ứng' : '👁️ Xem hiệu ứng thẻ'}
      </button>
    </div>
  );
}
