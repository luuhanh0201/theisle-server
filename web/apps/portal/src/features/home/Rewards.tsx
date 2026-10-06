import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Checkin, PlayerMe, Quest } from '@isle/api';
import { goTo } from '../../app/router';
import { useToast } from '../../app/toast';
import { RelBadge } from '../../components/RelBadge';
import { Amber, fmtAmber } from '../../lib/amber';
import { portalPost } from '../../lib/http';
import { ME } from '../../lib/queries';

/** 3 or 2,5 (one decimal, Vietnamese), a quest's progress. */
const qnum = (v: number): string => (Number.isInteger(v) ? String(v) : Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 1 }));

/** One quest: what, how far, its reward and the button to take it. */
function QuestRow({ q, locked, busy, onClaim }: { q: Quest; locked: boolean; busy: boolean; onClaim: (id: string) => void }) {
  const p = q.target > 0 ? Math.min(100, Math.round(q.progress / q.target * 100)) : 100;
  return (
    <li className={`hq-item${q.claimed ? ' claimed' : q.done ? ' done' : ''}`}>
      <div><b>{q.label}</b>
        <div className="hq-meta">{qnum(q.progress)}/{qnum(q.target)} {q.unit} · thưởng <Amber n={q.reward} /></div></div>
      {q.claimed ? <span className="hq-meta">✓ Đã nhận</span>
        : <button type="button" className={`btn ${q.done && !locked ? 'btn-emerald' : 'btn-ghost'}`} data-quest={q.id} disabled={!(q.done && !locked && !busy)} onClick={() => onClaim(q.id)}><Amber n={q.reward} sign="+" /></button>}
      <div className="hr-progress"><i style={{ width: `${p}%` }} /></div>
    </li>
  );
}

/** The 7 days of the check-in, today's button. */
function CheckinCard({ c, locked, rel, busy, onCheckin }: { c: Checkin; locked: string | undefined; rel: string | undefined; busy: boolean; onCheckin: () => void }) {
  const p = c.needed > 0 ? Math.min(100, Math.round(c.minutes / c.needed * 100)) : 100;
  const reward = c.rewards[c.day - 1] ?? 0;
  const todayGift = c.day === c.rewards.length && c.bonusItem ? `🎁 ${c.bonusItem}` : '';
  const gets = <>{reward > 0 && <Amber n={reward} sign="+" />}{reward > 0 && todayGift ? ' + ' : ''}{todayGift}</>;
  const label = c.claimed ? '✓ Đã điểm danh hôm nay' : c.ready ? (reward > 0 || todayGift ? <>Điểm danh: {gets}</> : 'Điểm danh') : `Chơi thêm ${Math.max(0, c.needed - c.minutes)} phút để điểm danh`;
  const can = c.ready && !locked;
  return (
    <section className="hr-card hr-checkin" id="home-checkin">
      <h3>📅 Điểm danh hằng ngày <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>ngày {c.day}/{c.rewards.length}</span> <RelBadge b={rel} /></h3>
      <div className="hr-days">
        {c.rewards.map((r, i) => {
          const n = i + 1;
          const cls = n < c.day || (c.claimed && n === c.day) ? 'done' : n === c.day ? 'today' : '';
          // The last day's gift: in place of the amount when the day gives no Hổ phách, else a badge on
          // the cell's corner. A day with neither: "-".
          const gift = n === c.rewards.length && c.bonusItem ? <span className="hr-gift-in" title={c.bonusItem}>🎁</span> : null;
          const what = cls === 'done' ? '✓' : r > 0 ? <Amber n={r} sign="+" /> : gift ?? '-';
          return (
            <div key={n} className={`hr-day ${cls}`}><span className="hr-n">Ngày {n}</span><b>{what}</b>
              {gift && r > 0 && cls !== 'done' && <span className="hr-gift" title={c.bonusItem ?? ''}>🎁</span>}</div>
          );
        })}
      </div>
      <div className="hr-row" style={{ justifyContent: 'space-between' }}><span className="muted">Hôm nay đã chơi <b>{c.minutes}</b>/{c.needed} phút trong game</span>
        {c.bonusItem && <span className="muted">Ngày {c.rewards.length}: +🎁 {c.bonusItem}</span>}</div>
      <div className="hr-progress"><i style={{ width: `${p}%` }} /></div>
      {locked && <div className="hr-note">🧪 {locked}</div>}
      <div className="hr-row">
        <button type="button" className={`btn ${can ? 'btn-emerald' : 'btn-ghost'}`} id="home-checkin-btn" disabled={!(can && !busy)} onClick={onCheckin}>{label}</button>
        <span className="muted">Bỏ lỡ 1 ngày là quay về ngày 1 · ngày mới lúc 00:00</span>
      </div>
    </section>
  );
}

/**
 * The rewards first, where they are seen (owner, 2026-10-05): the starter gift (bridge starter.ts), the
 * Hổ phách balance, the daily check-in (economy.ts), the daily / weekly quests (quests.ts).
 */
export function Rewards({ me }: { me: PlayerMe | null | undefined }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const eco = me?.economy ?? null;
  const gift = me?.starter ?? null;
  const quests = me?.quests ?? null;
  const rel = me?.releases ?? {};

  /** A claim: one at a time, the toast, then /me read again at once. */
  const claim = async (url: string, body: unknown, ok: (b: Record<string, unknown>) => string, fail: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      toast(ok(await portalPost<Record<string, unknown>>(url, body)));
    } catch (e) {
      const status = (e as { status?: number }).status;
      toast(status === undefined ? '❌ Mất kết nối. Thử lại.' : `❌ ${e instanceof Error && e.message && !e.message.startsWith('HTTP ') ? e.message : fail}`);
    } finally {
      await qc.refetchQueries({ queryKey: [ME] }).catch(() => undefined);
      setBusy(false);
    }
  };
  const starter = (): void => void claim('/api/starter/claim', {}, (b) => `✅ Đã nhận ${String(b['item'])}, xem trong Túi đồ`, 'Không nhận được quà.');
  const quest = (id: string): void => void claim('/api/quests/claim', { quest: id }, (b) => `✅ ${String(b['label'])}: +${fmtAmber(b['reward'] as number)} Hổ phách`, 'Không nhận được thưởng.');
  const checkin = (): void => void claim('/api/checkin', {}, (b) => {
    const got = [(b['reward'] as number) > 0 ? `+${fmtAmber(b['reward'] as number)} Hổ phách` : '', b['item'] ? `🎁 ${String(b['item'])}` : ''].filter(Boolean).join(' và ');
    return `✅ Điểm danh ngày ${String(b['day'])}${got ? `: ${got}` : ''}`;
  }, 'Không điểm danh được.');

  return (
    <div className="home-rewards" id="home-rewards">
      <div className="hr-bar">
        {/* The starter gift: a small button in the corner, its text on hover. */}
        {gift && (
          <span className="hr-starter" id="home-starter">
            <button type="button" className="hr-starter-btn" id="home-starter-btn" aria-describedby="home-starter-tip" disabled={Boolean(gift.locked) || busy} onClick={starter}>
              🎁 Quà tân thủ <RelBadge b={rel['starter']} /><b>Nhận</b>
            </button>
            <span className="hr-starter-tip" id="home-starter-tip" role="tooltip"><b>Hộp dino tự chọn</b>, mỗi tài khoản 1 lần. Nhận hộp vào <b>Túi đồ</b> → mở hộp, <b>chọn loài</b> (tăng trưởng ngẫu nhiên 50–100%) → dùng Dino vừa mở để chọn <b>giới tính</b> và <b>mutation</b>. Dino vào gara với <b>đủ 10 nhiệm vụ prime</b>.{gift.locked && <><br />🧪 {gift.locked}</>}</span>
          </span>
        )}
        {/* The balance, by the way in (a click: the shop). */}
        {eco && (
          <span className="hr-amber" id="home-amber" title="Mở cửa hàng Hổ phách" onClick={() => goTo('shop')}>
            <Amber n={eco.balance} />{eco.locked && <> <small style={{ opacity: 0.75 }}>(thử nghiệm)</small></>}
          </span>
        )}
      </div>
      <div className="hr-grid">
        {eco && <CheckinCard c={eco.checkin} locked={eco.locked} rel={rel['amber']} busy={busy} onCheckin={checkin} />}
        {quests && (
          <section className="hr-card hr-quests" id="home-quests">
            <h3>🎯 Nhiệm vụ hôm nay <RelBadge b={rel['quests']} /></h3>
            {quests.daily.length ? <ul className="hq-list">{quests.daily.map((q) => <QuestRow key={q.id} q={q} locked={Boolean(quests.locked)} busy={busy} onClaim={quest} />)}</ul> : <p>Chưa có nhiệm vụ hôm nay.</p>}
            {quests.weekly && <><div className="hq-week">Nhiệm vụ tuần</div><ul className="hq-list"><QuestRow q={quests.weekly} locked={Boolean(quests.locked)} busy={busy} onClaim={quest} /></ul></>}
            {quests.locked && <div className="hr-note">🧪 {quests.locked}</div>}
            <p style={{ fontSize: 12.5 }}>Nhiệm vụ mới mỗi ngày lúc 00:00 (tuần: thứ Hai), theo loài bạn đang chơi lúc mở trang lần đầu trong ngày.</p>
          </section>
        )}
      </div>
    </div>
  );
}
