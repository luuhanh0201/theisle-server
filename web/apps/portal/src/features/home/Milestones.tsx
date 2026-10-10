import type { Milestone, Milestones } from '@isle/api';
import { Amber } from '../../lib/amber';

/**
 * The server's online milestones on Trang chủ (bridge milestones.ts, owner 2026-10-10): the server
 * reaching N players online at once, held some minutes, gives everyone with enough minutes in game a
 * reward, once each, taken here. The web's look (MilestonesCard) and the launcher's (LxHome) share these.
 */

/** "2:05": a hold so far. */
export const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The next milestone not reached yet (the bar runs towards it), or null when all are. */
export const nextMilestone = (m: Milestones): Milestone | null => m.defs.find((d) => !d.reached) ?? null;

/** What a milestone gives: Hổ phách, then each item. */
export function MilestoneReward({ d }: { d: Milestone }) {
  const items = d.items.map((x) => `${x.qty > 1 ? `${x.qty} × ` : ''}${x.name}`);
  return <>{d.amber > 0 && <Amber n={d.amber} sign="+" />}{d.amber > 0 && items.length > 0 ? ' · ' : ''}{items.length > 0 && `🎁 ${items.join(', ')}`}{d.amber === 0 && items.length === 0 && '-'}</>;
}

/** Where a milestone stands for this player: done, to take, not enough minutes, being held, not yet. */
export function milestoneStatus(m: Milestones, d: Milestone): { kind: 'claimed' | 'claim' | 'minutes' | 'held' | 'wait'; text: string } {
  if (d.claimed) return { kind: 'claimed', text: '✓ Đã nhận' };
  if (d.reached) return m.eligible ? { kind: 'claim', text: 'Nhận quà' } : { kind: 'minutes', text: `Cần chơi đủ ${m.minPlayMinutes} phút` };
  if (d.heldS !== null) return { kind: 'held', text: `Đang giữ ${mmss(d.heldS)} / ${m.holdMinutes} phút` };
  return { kind: 'wait', text: 'Chưa đạt' };
}

/** The line under the title. */
export const milestoneRule = (m: Milestones): string =>
  `Server có đủ người online cùng lúc${m.holdMinutes > 0 ? ` liên tục ${m.holdMinutes} phút` : ''}: mọi người đã chơi đủ ${m.minPlayMinutes} phút đều nhận quà, mỗi mốc 1 lần.`;

/** The web look's card (Rewards). */
export function MilestonesCard({ m, busy, onClaim }: { m: Milestones; busy: boolean; onClaim: (id: string) => void }) {
  const next = nextMilestone(m);
  const p = next ? Math.min(100, Math.round(m.online / next.players * 100)) : 100;
  return (
    <section className="hr-card hr-milestones" id="home-milestones">
      <h3>🏆 Mốc Online Toàn Server</h3>
      <p>{milestoneRule(m)}</p>
      <div className="hr-row" style={{ justifyContent: 'space-between' }}>
        <span className="muted">Đang online <b>{m.online}</b>{next ? <> / {next.players} người</> : ' người'}</span>
        {!next && <span className="muted">Đã đạt mọi mốc</span>}
      </div>
      <div className="hr-progress"><i style={{ width: `${p}%` }} /></div>
      <ul className="hq-list">
        {m.defs.map((d) => {
          const st = milestoneStatus(m, d);
          return (
            <li key={d.id} className={`hq-item${d.claimed ? ' claimed' : d.reached ? ' done' : ''}`}>
              <div><b>{d.players} người online cùng lúc</b>
                <div className="hq-meta">thưởng <MilestoneReward d={d} /></div></div>
              {st.kind === 'claim'
                ? <button type="button" className="btn btn-emerald" data-milestone={d.id} disabled={busy} onClick={() => onClaim(d.id)}>{st.text}</button>
                : <span className="hq-meta">{st.text}</span>}
            </li>
          );
        })}
      </ul>
      {!m.eligible && <p style={{ fontSize: 12.5 }}>Bạn đã chơi {m.playMinutes}/{m.minPlayMinutes} phút. Chơi đủ là nhận được quà mọi mốc đã đạt, không có hạn.</p>}
    </section>
  );
}
