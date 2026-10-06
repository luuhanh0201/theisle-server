import { useEffect, useRef } from 'react';
import type { PlayerSlot } from '@isle/api';
import { SkinStrip } from '../../components/SkinStrip';
import { TierBadge, TierFx } from '../../components/TierFx';
import { growthStage, pct, slotTier, when } from '../../lib/dino';
import type { Dino3DApi } from '../../lib/dino3d';

/** What a stored dino has LEFT (as stored = as it comes back); old slots without a max: the amount alone. */
const SLOT_VITALS: ReadonlyArray<readonly ['health' | 'stamina' | 'thirst', string, string]> = [['health', 'Máu', '#ef4444'], ['stamina', 'Stamina', '#f59e0b'], ['thirst', 'Nước', '#3b82f6']];
function SlotVitals({ g }: { g: PlayerSlot }) {
  if (!g.vitals || SLOT_VITALS.every(([k]) => typeof g.vitals[k] !== 'number')) {
    return g.gift ? <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Chỉ số do admin đặt khi tạo.</div> : null;
  }
  return (
    <div className="slot-vitals">
      {SLOT_VITALS.map(([k, label, color]) => {
        const v = g.vitals[k]; const m = g.max?.[k];
        if (typeof v !== 'number') return null;
        const ratio = typeof m === 'number' && m > 0 ? Math.max(0, Math.min(1, v / m)) : null;
        return (
          <div key={k} className="sv"><span>{label}</span>
            <div className="sv-track"><i style={{ width: `${ratio === null ? 100 : (ratio * 100).toFixed(0)}%`, background: color, opacity: ratio === null ? 0.35 : 1 }} /></div>
            <b title={ratio === null ? '' : `còn ${Math.round(v)} / tối đa ${Math.round(m as number)}`}>{Math.round(v).toLocaleString('vi-VN')}{ratio === null ? '' : ` · ${Math.round(ratio * 100)}%`}</b>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The slot in 3D, in the colours it was stored with (skin3d.js; for everyone since 2026-10-01): one viewer per
 * slot, loaded when first seen; a model that did not come is tried again 20 s later.
 */
function Slot3D({ api, g }: { api: Dino3DApi | null; g: PlayerSlot }) {
  const box = useRef<HTMLDivElement>(null);
  const viewer = useRef<ReturnType<Dino3DApi['create']> | null>(null);
  const shown = useRef<string | null>(null);
  const key = JSON.stringify([g.species, g.skin]);
  useEffect(() => {
    if (!api || !box.current || !g.species || shown.current === key) return undefined;
    viewer.current ??= api.create(box.current, { interactive: false, autoRotate: true, fit: 0.95 });
    shown.current = key;
    let retry: number | undefined;
    void viewer.current.show(g.species, api.fromGame(g.skin) ?? { colors: {} }).catch(() => false)
      .then((ok) => { if (!ok) retry = window.setTimeout(() => { if (shown.current === key) shown.current = null; }, 20_000); });
    return () => window.clearTimeout(retry);
  }, [api, key, g.species, g.skin]);
  if (!api || !g.species) return <div className="slot-3d-spot" data-slot3d={g.slot} />;
  return <div className="slot-3d" ref={box} />;
}

/** One garage card: the tier's look, the dino, its tasks, when stored, what it has left, Lấy ra. */
export function Slot({ g, why, busy, demo, api, onRedeem }: { g: PlayerSlot & { tier?: string }; why: string; busy: boolean; demo: boolean; api: Dino3DApi | null; onRedeem: (slot: string) => void }) {
  const tier = slotTier(g);
  const st = growthStage(g.growth);
  return (
    <li className={`garage-slot-card stacked ${tier.className}`} data-tier={tier.key}>
      <TierFx tier={tier} />
      <div className="garage-slot-body">
        <Slot3D api={api} g={g} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            <b style={{ fontSize: 15 }}>{g.species ?? 'Dino'}</b>
            <span className="tag" title={st.name}>{st.icon} Growth {pct(g.growth)}</span>
            <TierBadge tier={tier} />
            {g.gift && <span className="tag purple">Quà Admin</span>}
          </div>
          <SkinStrip skin={g.skin as Parameters<typeof SkinStrip>[0]['skin']} />
          {g.primeTasks && <div style={{ marginTop: 6 }}><span className={`tag${g.primeTasks.eligible ? '' : ' warning'}`} title="Nhiệm vụ prime đã hoàn thành">Nhiệm vụ {g.primeTasks.done}/10{g.primeTasks.eligible ? ' · đủ điều kiện' : ''}</span></div>}
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Cất lúc: {when(g.storedAt)}{why ? ` · ${why}` : ''}</div>
          <SlotVitals g={g} />
        </div>
        <button type="button" className="btn btn-emerald slot-redeem" data-redeem={g.slot} disabled={Boolean(why) || busy || demo} onClick={() => onRedeem(g.slot)}>{demo ? '👁️ Mẫu demo' : '📤 Lấy ra'}</button>
      </div>
    </li>
  );
}
