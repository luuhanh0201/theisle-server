import { useState } from 'react';
import type { PlayerMe } from '@isle/api';
import { TierBadge } from '../../components/TierFx';
import { growthStage, pct, slotTier, when } from '../../lib/dino';
import { type BoardRow, type Leaderboard } from '../../lib/queries';
import { dur } from '../game/Stats';

type RTab = 'kills' | 'playtime' | 'longestLife' | 'hunters' | 'lives';
const TABS: ReadonlyArray<readonly [RTab, string]> = [
  ['kills', '⚔️ Top Hạ Gục (Kills)'], ['playtime', '⏱️ Top Giờ Chơi'], ['longestLife', '👑 Kỷ Lục Sống Lâu'], ['hunters', '🏹 Thợ Săn'], ['lives', '📜 Các Đời Dino Của Bạn'],
];

/** The top three's moving decoration (apex eye, rex flames, DNA veins), the rest's grit (app.js renderRankFx). */
function RankFx({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="slot-tier-fx tier-apex-fx rank-fx" aria-hidden="true">
        <div className="apex-fire-sweep rank-fire-sweep" />
        <div className="rank-eye-wrap">
          <div className="apex-eye-box rank-eye">
            <svg className="apex-eye-svg" viewBox="0 0 100 50">
              <defs>
                <radialGradient id="rankEyeGrad1" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#fef08a" /><stop offset="40%" stopColor="#f97316" /><stop offset="80%" stopColor="#dc2626" /><stop offset="100%" stopColor="#450a0a" />
                </radialGradient>
              </defs>
              <path className="eye-lid-upper" d="M 6,25 Q 50,-4 94,25" fill="none" stroke="rgba(239,68,68,0.75)" strokeWidth="1.6" />
              <path className="eye-lid-lower" d="M 6,25 Q 50,54 94,25" fill="none" stroke="rgba(239,68,68,0.75)" strokeWidth="1.6" />
              <ellipse className="eye-sclera" cx="50" cy="25" rx="36" ry="16" fill="rgba(185,28,28,0.32)" />
              <ellipse className="eye-iris" cx="50" cy="25" rx="18" ry="15" fill="url(#rankEyeGrad1)" />
              <polygon className="eye-pupil" points="49,11 51,11 52,25 51,39 49,39 48,25" fill="#050101" />
              <ellipse className="eye-glint" cx="44" cy="20" rx="3" ry="1.5" fill="#ffffff" />
            </svg>
          </div>
        </div>
        <svg className="apex-claws-svg rank-claws" viewBox="0 0 160 160" preserveAspectRatio="none">
          <path className="claw-slash s1" d="M 22,6 L 148,132" fill="none" />
          <path className="claw-slash s2" d="M 38,0 L 162,126" fill="none" />
          <path className="claw-slash s3" d="M 10,26 L 132,148" fill="none" />
        </svg>
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="slot-tier-fx tier-rex-fx rank-fx" aria-hidden="true">
        <div className="rex-flame-aura" />
        <svg className="rex-cracks-svg rank-cracks" viewBox="0 0 600 60" preserveAspectRatio="none">
          <path d="M 0,60 L 60,35 L 120,48 L 190,25 L 260,40 L 340,15 L 420,38 L 510,20 L 600,45" fill="none" stroke="currentColor" strokeWidth="2.2" />
          <path d="M 120,48 L 150,60 M 260,40 L 290,60 M 420,38 L 460,60" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="slot-tier-fx tier-dna-fx rank-fx" aria-hidden="true">
        <svg className="dna-veins-svg rank-dna-veins" viewBox="0 0 600 60" preserveAspectRatio="none">
          <path className="dna-capillary c1" d="M -10,30 Q 80,10 160,35 T 320,20 T 480,40 T 610,25" fill="none" />
          <path className="dna-capillary c2" d="M 40,55 Q 140,20 240,45 T 400,25 T 560,50" fill="none" />
          <circle className="dna-node n1" cx="160" cy="35" r="3.2" />
          <circle className="dna-node n2" cx="320" cy="20" r="3.2" />
          <circle className="dna-node n3" cx="480" cy="40" r="3.2" />
        </svg>
      </div>
    );
  }
  return <div className="slot-tier-fx tier-fossil-fx rank-fx" aria-hidden="true"><div className="fossil-grit-overlay" /></div>;
}

const TIER_CLASS = ['', 'tier-apex', 'tier-rex', 'tier-dna'];
function BoardItem({ item, rank, tab }: { item: BoardRow; rank: number; tab: RTab }) {
  const top = rank <= 3;
  const val = tab === 'playtime' || tab === 'longestLife' ? dur(item.value) : tab === 'hunters' ? `🏹 ${item.value} lần` : `${item.value} kills`;
  return (
    <li className={`leaderboard-item ${TIER_CLASS[rank] ?? 'tier-fossil'} ${top ? `rank-top rank-${rank}` : 'rank-rest'}`}>
      <RankFx rank={rank} />
      <div className="leaderboard-item-left">
        <span className={`leaderboard-rank ${top ? `top-${rank}` : ''}`}>{top ? `👑 #${rank}` : `#${rank}`}</span>
        <div className="leaderboard-item-details">
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
            <b className="leaderboard-player-name">{item.name ?? 'Ẩn danh'}</b>
            {top && <span className={`tag ${TIER_CLASS[rank]}`} style={{ marginLeft: 6, fontSize: 11 }}>👑 Top {rank}</span>}
          </div>
          {item.species && <span className="muted leaderboard-species" style={{ fontSize: 12 }}>{item.species}</span>}
        </div>
      </div>
      <b className="leaderboard-val-num">{val}</b>
    </li>
  );
}

/** A life as /me lists it (bridge dinoRows): its relogs, garage trips and rebirths together. */
interface LifeRow {
  species?: string | null; spawnedAt: number; lastAt: number; status: string; end?: string | null; seconds: number; growth: number | null;
  kills: number; killedBy: string | null; killedBySpecies: string | null; rebirths: number; elderStacks: number | null; tier?: string | number; prime?: boolean;
}
const STATUS: Record<string, readonly [string, string]> = {
  alive: ['Đang sống', 'info'], garage: ['Đang trong gara', ''], left: ['Đã thoát game (chưa chết)', ''],
  death: ['Đã chết', 'kill'], admin: ['Admin xoá', 'kill'], rebirth: ['Chuyển sinh', 'prime'],
};
function LifeItem({ l, i }: { l: LifeRow; i: number }) {
  const tier = slotTier(l);
  const high = tier.level > 0;
  const [label, tone] = STATUS[l.status] ?? [l.end ?? 'Không rõ', ''];
  const by = l.status === 'death' && l.killedBy ? ` bởi ${l.killedBy}${l.killedBySpecies ? ` (${l.killedBySpecies})` : ''}` : '';
  const st = growthStage(l.growth);
  const spawnDate = when(l.spawnedAt);
  const lastDate = l.status === 'alive' ? '' : ` · lần cuối ${when(l.lastAt)}`;
  return (
    <li className={`dino-life-item ${high ? `high-tier tier-${tier.key}` : 'fossil-tier'}`}>
      <div className="dli-main">
        <span className="dli-num">#{i + 1}</span>
        <div className="dli-info">
          <div className="dli-title">
            <b className="dli-name">{l.species ?? 'Dino'}</b>
            {high && <TierBadge tier={tier} />}
            <span className="tag" style={{ fontSize: 11 }} title={st.name}>{st.icon} {pct(l.growth)}</span>
            {l.rebirths > 0 && <span className="tag prime" style={{ fontSize: 11 }} title={`Đã chuyển sinh ${l.rebirths} lần`}>CS x{l.rebirths}</span>}
          </div>
          <div className="dli-sub muted">
            <span className={`tag ${tone}`}>{label}{by}</span>
            <span className="dli-dot">·</span>
            <span>sống {dur(l.seconds)}{l.rebirths > 0 ? ` · CS x${l.rebirths}` : ''}</span>
            <span className="dli-dot hide-xs">·</span>
            <span className="hide-xs" title={`Sinh ra: ${spawnDate}${lastDate}`}>{spawnDate}</span>
          </div>
        </div>
      </div>
      <div className="dli-kills" title={`${l.kills} hạ gục`}>⚔️ <b>{l.kills}</b><span className="dli-kills-unit"> kills</span></div>
    </li>
  );
}

const Empty = ({ text, pad = 24 }: { text: string; pad?: number }) => <li className="muted" style={{ padding: pad, textAlign: 'center' }}>{text}</li>;

/** Bảng Xếp Hạng: the players' boards (every 15 s) and the player's own dinos. */
export function Ranking({ me, board }: { me: PlayerMe | null | undefined; board: Leaderboard | null | undefined }) {
  const [tab, setTab] = useState<RTab>('kills');
  let body: React.ReactNode;
  if (tab === 'lives') {
    const lives = (me?.lives ?? []) as unknown as LifeRow[];
    body = lives.length === 0 ? <Empty text="Chưa có lịch sử đời dino nào." /> : lives.map((l, i) => <LifeItem key={`${l.spawnedAt}-${i}`} l={l} i={i} />);
  } else if (!board) {
    body = <Empty text="Đang tải bảng xếp hạng…" pad={16} />;
  } else {
    const list = board[tab] ?? [];
    body = list.length === 0 ? <Empty text="Chưa có người chơi trong danh sách." /> : list.map((item, idx) => <BoardItem key={idx} item={item} rank={idx + 1} tab={tab} />);
  }
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 className="card-title">🏆 Bảng Xếp Hạng &amp; Lịch Sử Sinh Tồn</h3>
          <span className="card-subtitle">Thành tích thợ săn đỉnh cao và nhật ký chiến đấu</span>
        </div>
      </div>
      <div className="ranking-tabs">
        {TABS.map(([k, label]) => <button key={k} type="button" className={`ranking-tab-btn${tab === k ? ' active' : ''}`} data-rtab={k} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      <div id="ranking-content">
        <ul className={`leaderboard-list${tab === 'lives' ? ' lives-mode' : ''}`} id="ranking-list">{body}</ul>
      </div>
    </div>
  );
}
