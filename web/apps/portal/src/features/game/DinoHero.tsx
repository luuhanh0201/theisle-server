import { useEffect, useRef } from 'react';
import type { PlayerDino, PlayerMe, PrisonView } from '@isle/api';
import { TierBadge, TierFx } from '../../components/TierFx';
import { growthStage, growthWidth, heroTier, pct, tierClasses } from '../../lib/dino';
import { useDino3D } from '../../lib/dino3d';
import { isLab } from '../../lib/lab';

/** "1 giờ 5 phút" / "45 phút", as the server says it. */
export function prisonDur(sec: number): string {
  const m = Math.max(1, Math.round(Math.max(0, sec) / 60));
  const h = Math.floor(m / 60);
  return h === 0 ? `${m} phút` : m % 60 === 0 ? `${h} giờ` : `${h} giờ ${m % 60} phút`;
}

/** Serving a prison sentence (bridge prison.ts): what is left, and how it runs. */
export function PrisonBanner({ p }: { p: PrisonView | null }) {
  if (!p) return <div className="prison-banner" id="game-prison" hidden />;
  return (
    <div className={`prison-banner${p.escaped ? ' escaped' : ''}`} id="game-prison">
      {p.escaped
        ? <><b>🚨 Bạn đang vượt ngục</b>, cả server thấy vị trí của bạn trên bản đồ, ai hạ được bạn sẽ được ghi công. Án còn <b>{prisonDur(p.remainingSec)}</b>, chỉ trừ khi bạn quay lại khu tù.</>
        : <><b>🔒 Bạn đang ở tù</b>, còn <b>{prisonDur(p.remainingSec)}</b> ({p.offense}: {p.reason}). Án chỉ trừ khi bạn online và ở trong khu tù; trong tù không lớn, không đói khát, không mất máu, không dùng được gara.</>}
    </div>
  );
}

export const VITALS: ReadonlyArray<readonly [keyof PlayerDino['vitals'], string, string]> = [
  ['health', 'Máu (Health)', '#ef4444'], ['stamina', 'Thể lực (Stamina)', '#f59e0b'], ['hunger', 'Dạ dày (Hunger)', '#84cc16'],
  ['thirst', 'Nước (Thirst)', '#3b82f6'], ['blood', 'Huyết (Blood)', '#b91c1c'], ['oxygen', 'Oxy (Oxygen)', '#06b6d4'],
];

/** One vital: the amount / its max, the bar (dim without a max), low under 25 %. */
export function vitalView(cur: number | null | undefined, max: number | null | undefined): { val: string; width: string; opacity: string; low: boolean } {
  const ratio = typeof max === 'number' && max > 0 && typeof cur === 'number' ? Math.max(0, Math.min(1, cur / max)) : null;
  return {
    width: ratio === null ? '100%' : `${(ratio * 100).toFixed(1)}%`,
    opacity: ratio === null ? '0.4' : '1',
    val: typeof cur !== 'number' ? '?' : ratio === null ? `${Math.round(cur)}` : `${Math.round(cur)} / ${Math.round(max as number)}`,
    low: ratio !== null && ratio < 0.25,
  };
}

function Vitals({ dino }: { dino: PlayerDino }) {
  return (
    <>
      {VITALS.map(([k, label, color]) => {
        const v = dino.vitals ? vitalView(dino.vitals[k], dino.max?.[k]) : { val: '--', width: '0%', opacity: '', low: false };
        return (
          <div key={k} className={`vital-card${v.low ? ' low' : ''}`} data-v={k}>
            <div className="vital-header"><span className="vital-name">{label}</span><span className="vital-val">{v.val}</span></div>
            <div className="vital-track"><div className="vital-fill" style={{ background: color, width: v.width, opacity: v.opacity || undefined }} /></div>
          </div>
        );
      })}
    </>
  );
}

/** The dino played now in 3D, in its colours (lab only; skin3d.js); hidden while there is none or it does not load. */
function Game3D({ dino }: { dino: PlayerDino | null }) {
  const on = isLab() && Boolean(dino?.species);
  const api = useDino3D(on);
  const box = useRef<HTMLDivElement>(null);
  const viewer = useRef<ReturnType<NonNullable<typeof api>['create']> | null>(null);
  const shownKey = useRef<string | null>(null);
  const failed = useRef(false);
  const key = dino ? JSON.stringify([dino.species, dino.skin]) : null;
  useEffect(() => {
    if (!on || !api || !box.current || !dino?.species || key === shownKey.current) return;
    viewer.current ??= api.create(box.current, { autoRotate: true, fit: 1.15 });
    shownKey.current = key;
    void viewer.current.show(dino.species, api.fromGame(dino.skin) ?? { colors: {} }).catch(() => false).then((ok) => {
      failed.current = !ok;
      if (box.current) box.current.hidden = !ok;
    });
  }, [on, api, key, dino]);
  return <div className="dino-3d" id="game-3d" ref={box} hidden={!on || !api || failed.current} />;
}

/** The card of the dino played now (app.js renderGame + updateHeroTierFx); a guest sees the page's first text. */
export function DinoHero({ me }: { me: PlayerMe | null | undefined }) {
  const d = me?.dino && me.online ? me.dino : null;
  const st = d ? growthStage(d.growth) : null;
  // Its tier only once logged in (a guest: the plain card).
  const tier = me ? heroTier(me.online && me.dino ? me.dino : null) : null;
  const species = d ? d.species ?? 'Dino Đang Chơi' : !me ? 'Chưa vào game' : me.online ? 'Đang chọn loài' : 'Chưa vào server';
  const status = d ? 'Đang trực tuyến trên server Gateway' : !me ? 'Vào server để theo dõi chỉ số trực tiếp.'
    : me.online ? 'Bạn đang ở sảnh chọn dino ingame.' : 'Vào game để hiển thị đầy đủ chỉ số và vị trí.';
  const growth = d && st ? `${st.icon} Growth: ${pct(d.growth)}` : me ? '🥚 Growth: 0%' : 'Growth: 0%';
  return (
    <>
      <PrisonBanner p={me?.prison ?? null} />
      <div className={`dino-hero-card${tier ? ` ${tierClasses(tier)}` : ''}`} id="game-hero-card">
        <div className="slot-tier-fx hero-tier-fx" id="game-hero-fx" aria-hidden="true">{tier && <TierFx tier={tier} />}</div>
        <div className="dino-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <span className="tag info" id="game-live-tag">ĐANG ĐIỀU KHIỂN</span>
              {tier ? <TierBadge tier={tier} id="game-dino-tier-badge" /> : <span className="ftag f0" id="game-dino-tier-badge" hidden>F0</span>}
            </div>
            <h2 className="dino-species" id="game-dino-species">{species}</h2>
            <p className="muted" id="game-dino-status" style={{ margin: '4px 0 0', fontSize: 13 }}>{status}</p>
          </div>
          <div className="dino-growth-badge" id="game-dino-growth" title={st?.name}>{growth}</div>
        </div>

        <Game3D dino={d} />

        <div style={{ marginTop: 14 }}>
          <div className="player-meter-header">
            <span className="muted" style={{ fontSize: 12 }}>Tiến trình trưởng thành</span>
            <span id="game-growth-pct" className="tabular-nums" style={{ fontWeight: 700 }}>{d ? pct(d.growth) : '0%'}</span>
          </div>
          <div className="meter-bar" style={{ height: 10 }}>
            <div className="meter-fill" id="game-growth-fill" style={{ width: d ? growthWidth(d.growth) : '0%', background: 'linear-gradient(90deg, #10b981, #06b6d4)' }} />
          </div>
        </div>

        <div className="vitals-grid" id="game-vitals">
          {d ? <Vitals dino={d} /> : me ? <p className="muted" style={{ gridColumn: '1/-1', padding: '12px 0', margin: 0 }}>Chưa có chỉ số sinh tồn của dino.</p> : null}
        </div>
      </div>
    </>
  );
}
