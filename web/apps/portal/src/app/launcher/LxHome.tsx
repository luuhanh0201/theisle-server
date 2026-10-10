import { useRef, useState } from 'react';
import type { Checkin, Milestones, PlayerMe, Quest } from '@isle/api';
import { RelBadge } from '../../components/RelBadge';
import { useRewardActions } from '../../features/home/Rewards';
import { MilestoneReward, milestoneRule, milestoneStatus, nextMilestone } from '../../features/home/Milestones';
import { Amber } from '../../lib/amber';
import { useNews, useServer } from '../../lib/queries';
import { RANGES, RANGE_NAMES, join, leaveByUser, setMaster, setRange, toggleMic, useVoice } from '../../lib/voice';
import { Svg } from '../shell/icons';
import { goView } from './view';

const qnum = (v: number): string => (Number.isInteger(v) ? String(v) : Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 1 }));
const ico = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function CardHead({ icon, title, sub, children }: { icon: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="lx-card-head">
      <span className="lx-ico">{icon}</span>
      <div className="lx-card-title"><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
      {children && <div className="lx-card-act">{children}</div>}
    </div>
  );
}

/**
 * The voice room in one bar (lib/voice.ts, the same room as Voice): in or out, how far your voice carries (each
 * click: the next range, as the range key), who speaks near you, the micro on / off (its mode kept), the sound on / off
 * (the volume kept), the full settings (Voice).
 */
function VoiceBar({ me }: { me: PlayerMe | null | undefined }) {
  const v = useVoice();
  const s = v.settings;
  const lastMaster = useRef(s.master > 0 ? s.master : 100);
  if (s.master > 0) lastMaster.current = s.master;
  const nextRange = (): void => {
    const i = (RANGES as readonly number[]).indexOf(s.range);
    setRange(RANGES[(i + 1) % RANGES.length] as number, false);
  };
  const status = v.loggedIn === false ? 'Đăng nhập để dùng voice' : v.connected ? 'Đang trực tuyến' : v.joining ? 'Đang vào phòng…'
    : v.autoWaiting ? 'Chờ vào game để tự vào lại' : 'Chưa vào phòng';
  return (
    <section className="lx-card lx-voicebar" id="lx-voice">
      <span className="lx-ico lx-ico-lg"><svg {...ico} width="22" height="22"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></svg></span>
      <div className="lx-vb-main">
        <div className="lx-eyebrow">VOICE GATEWAY <span className={`lx-state${v.connected ? ' on' : ''}`} id="lx-v-state">● {status}</span></div>
        <button type="button" className="lx-vb-range" id="lx-v-range" title="Đổi tầm nói (như phím đổi tầm)" disabled={!v.connected} onClick={nextRange}>
          Tầm nói: {RANGE_NAMES[s.range]} ({s.range}m)
        </button>
        <p>Âm thanh định vị không gian theo tọa độ khủng long trong game.</p>
      </div>
      <div className="lx-vb-peers" id="lx-v-peers">
        <Svg name="voice" size={14} />
        {v.connected && me && <span className="lx-peer self">{me.name ?? me.steamId} (Bạn)</span>}
        {v.peers.map((p) => (
          <span key={p.id} className={`lx-peer${p.speaking ? ' speaking' : ''}`}>{v.nameMode === 'none' ? 'Có người đang nói' : (p.name || 'Người chơi')}</span>
        ))}
        {(!v.connected || v.peers.length === 0) && <span className="lx-peer muted">{v.connected ? 'Chưa ai nói gần bạn' : v.joinNote || 'Vào phòng để nghe người chơi gần bạn'}</span>}
      </div>
      <div className="lx-vb-act">
        {v.loggedIn === true && (v.connected
          ? <button type="button" className="lx-btn danger" id="lx-v-leave" onClick={() => { void leaveByUser(); }}>Rời phòng</button>
          : v.autoWaiting
            // The room remembered (lib/voice.ts): waiting for the game; Rời phòng forgets it.
            ? <button type="button" className="lx-btn danger" id="lx-v-leave" onClick={() => { void leaveByUser(); }}>Rời phòng</button>
            : <button type="button" className="lx-btn primary" id="lx-v-join" disabled={v.joining} onClick={() => { void join(); }}>Vào phòng</button>)}
        <button type="button" className={`lx-icon-btn${s.mode === 'off' ? ' off' : ' on'}`} id="lx-v-mic" aria-pressed={s.mode !== 'off'}
          title={s.mode === 'off' ? 'Micro đang tắt: bấm để bật' : 'Tắt micro'} onClick={() => toggleMic()}>
          <svg {...ico} width="16" height="16"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />{s.mode === 'off' && <line x1="3" y1="3" x2="21" y2="21" />}</svg>
        </button>
        <button type="button" className={`lx-icon-btn${s.master === 0 ? ' off' : ''}`} id="lx-v-sound" aria-pressed={s.master > 0}
          title={s.master === 0 ? 'Đang tắt tiếng: bấm để nghe lại' : 'Tắt tiếng mọi người'} onClick={() => setMaster(s.master === 0 ? lastMaster.current : 0)}>
          <svg {...ico} width="16" height="16"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />{s.master === 0 ? <line x1="22" y1="9" x2="16" y2="15" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7" />}</svg>
        </button>
        <button type="button" className="lx-btn" id="lx-v-settings" onClick={() => goView('voice')}>
          <svg {...ico} width="15" height="15"><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /></svg>
          Cài đặt mở rộng
        </button>
      </div>
    </section>
  );
}

/** The 7 days (economy.ts): what each gives, today's, the minutes still to play, the button. */
function CheckinCard({ c, locked, rel, busy, onCheckin, gift }: {
  c: Checkin; locked: string | undefined; rel: string | undefined; busy: boolean; onCheckin: () => void; gift: React.ReactNode;
}) {
  const p = c.needed > 0 ? Math.min(100, Math.round(c.minutes / c.needed * 100)) : 100;
  const reward = c.rewards[c.day - 1] ?? 0;
  const todayGift = c.day === c.rewards.length && c.bonusItem ? `🎁 ${c.bonusItem}` : '';
  const gets = <>{reward > 0 && <Amber n={reward} sign="+" />}{reward > 0 && todayGift ? ' + ' : ''}{todayGift}</>;
  const label = c.claimed ? '✓ Đã điểm danh hôm nay' : c.ready ? (reward > 0 || todayGift ? <>Điểm danh: {gets}</> : 'Điểm danh') : `Chơi thêm ${Math.max(0, c.needed - c.minutes)} phút để điểm danh`;
  const can = c.ready && !locked;
  const streak = c.claimed ? c.day : c.day - 1;
  return (
    <section className="lx-card lx-checkin" id="home-checkin">
      <CardHead icon={<svg {...ico} width="18" height="18"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>}
        title={<>Điểm Danh Sinh Tồn {c.rewards.length} Ngày <RelBadge b={rel} /></>} sub="Chơi đủ phút mỗi ngày để nhận Hổ phách; ngày cuối có quà.">
        <span className="lx-streak">🔥 Chuỗi: {streak}/{c.rewards.length} ngày</span>
      </CardHead>
      {gift}
      <div className="lx-days">
        {c.rewards.map((r, i) => {
          const n = i + 1;
          const cls = n < c.day || (c.claimed && n === c.day) ? 'done' : n === c.day ? 'today' : '';
          const isGift = n === c.rewards.length && c.bonusItem;
          return (
            <div key={n} className={`lx-day hr-day ${cls}`} title={isGift ? c.bonusItem ?? '' : undefined}>
              {cls === 'done' && <span className="lx-tick">✓</span>}
              <span className="lx-day-n">Ngày {n}</span>
              <span className="lx-day-ico">{isGift ? '🎁' : r > 0 ? <img src="/amber.svg" alt="" title="Hổ phách" /> : null}</span>
              <span className="lx-day-v">{r > 0 ? `+${r.toLocaleString('vi-VN')}` : isGift ? 'Quà' : '-'}</span>
            </div>
          );
        })}
      </div>
      <div className="lx-prog-row"><span>Hôm nay đã chơi <b>{c.minutes}</b>/{c.needed} phút</span><span className="tabular-nums">{p}%</span></div>
      <div className="lx-bar"><i style={{ width: `${p}%` }} /></div>
      {locked && <div className="hr-note">🧪 {locked}</div>}
      <div className="lx-checkin-foot">
        <span className="lx-today">Phần thưởng hôm nay: <b>{reward > 0 || todayGift ? gets : '-'}</b></span>
        <button type="button" className={`lx-btn amber${can ? '' : ' idle'}`} id="home-checkin-btn" disabled={!(can && !busy)} onClick={onCheckin}>{label}</button>
      </div>
      <p className="lx-fine">Bỏ lỡ 1 ngày là quay về ngày 1 · ngày mới lúc 00:00{c.bonusItem ? ` · Ngày ${c.rewards.length}: +🎁 ${c.bonusItem}` : ''}</p>
    </section>
  );
}

function QuestRow({ q, weekly, locked, busy, onClaim }: { q: Quest; weekly: boolean; locked: boolean; busy: boolean; onClaim: (id: string) => void }) {
  const p = q.target > 0 ? Math.min(100, Math.round(q.progress / q.target * 100)) : 100;
  return (
    <li className={`lx-quest hq-item${q.claimed ? ' claimed' : q.done ? ' done' : ''}`}>
      <div className="lx-q-main">
        <b>{q.label}</b> <span className="lx-q-kind">{weekly ? 'Tuần' : 'Hằng ngày'}</span>
        <div className="lx-q-bar"><div className="lx-bar"><i style={{ width: `${p}%` }} /></div><span className="tabular-nums">{qnum(q.progress)}/{qnum(q.target)} {q.unit} ({p}%)</span></div>
      </div>
      <div className="lx-q-side">
        <span className="lx-q-reward"><Amber n={q.reward} sign="+" /></span>
        {q.claimed ? <span className="lx-q-st done">✓ Đã nhận</span>
          : q.done ? <button type="button" className="lx-btn primary sm" data-quest={q.id} disabled={locked || busy} onClick={() => onClaim(q.id)}>Nhận thưởng</button>
            : <span className="lx-q-st">Đang thực hiện</span>}
      </div>
    </li>
  );
}

function QuestsCard({ me, busy, onClaim }: { me: PlayerMe; busy: boolean; onClaim: (id: string) => void }) {
  const quests = me.quests;
  const [tab, setTab] = useState<'all' | 'daily' | 'weekly'>('all');
  if (!quests) return null;
  const locked = Boolean(quests.locked);
  const daily = tab !== 'weekly' ? quests.daily : [];
  const weekly = tab !== 'daily' && quests.weekly ? [quests.weekly] : [];
  return (
    <section className="lx-card lx-quests" id="home-quests">
      <CardHead icon={<svg {...ico} width="18" height="18"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>}
        title={<>Nhiệm Vụ Sinh Tồn <RelBadge b={me.releases?.['quests']} /></>} sub="Hoàn thành để nhận Hổ phách">
        <div className="lx-seg sm" role="tablist">
          {([['all', 'Tất cả'], ['daily', 'Hằng ngày'], ['weekly', 'Tuần']] as const).map(([k, t]) => (
            <button key={k} type="button" className={tab === k ? 'on' : ''} data-lx-quests={k} onClick={() => setTab(k)}>{t}</button>
          ))}
        </div>
      </CardHead>
      {daily.length + weekly.length > 0
        ? <ul className="lx-q-list">
          {daily.map((q) => <QuestRow key={q.id} q={q} weekly={false} locked={locked} busy={busy} onClaim={onClaim} />)}
          {weekly.map((q) => <QuestRow key={q.id} q={q} weekly locked={locked} busy={busy} onClaim={onClaim} />)}
        </ul>
        : <p className="lx-empty">{tab === 'weekly' ? 'Chưa có nhiệm vụ tuần.' : 'Chưa có nhiệm vụ hôm nay.'}</p>}
      {quests.locked && <div className="hr-note">🧪 {quests.locked}</div>}
      <p className="lx-fine">Nhiệm vụ mới mỗi ngày lúc 00:00 (tuần: thứ Hai), theo loài bạn đang chơi lúc mở trang lần đầu trong ngày.</p>
    </section>
  );
}

/** The server's online milestones (bridge milestones.ts): the same data and claim as the web's card. */
function MilestonesCard({ m, busy, onClaim }: { m: Milestones; busy: boolean; onClaim: (id: string) => void }) {
  const next = nextMilestone(m);
  const p = next ? Math.min(100, Math.round(m.online / next.players * 100)) : 100;
  return (
    <section className="lx-card lx-quests lx-milestones" id="home-milestones">
      <CardHead icon={<svg {...ico} width="18" height="18"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>}
        title="Mốc Online Toàn Server" sub={milestoneRule(m)} />
      <div className="lx-prog-row"><span>Đang online <b>{m.online}</b>{next ? <> / {next.players} người</> : ' người · đã đạt mọi mốc'}</span><span className="tabular-nums">{p}%</span></div>
      <div className="lx-bar"><i style={{ width: `${p}%` }} /></div>
      <ul className="lx-q-list">
        {m.defs.map((d) => {
          const st = milestoneStatus(m, d);
          return (
            <li key={d.id} className={`lx-quest hq-item${d.claimed ? ' claimed' : d.reached ? ' done' : ''}`}>
              <div className="lx-q-main"><b>{d.players} người online cùng lúc</b></div>
              <div className="lx-q-side">
                <span className="lx-q-reward"><MilestoneReward d={d} /></span>
                {st.kind === 'claim'
                  ? <button type="button" className="lx-btn primary sm" data-milestone={d.id} disabled={busy} onClick={() => onClaim(d.id)}>{st.text}</button>
                  : <span className={`lx-q-st${st.kind === 'claimed' ? ' done' : ''}`}>{st.text}</span>}
              </div>
            </li>
          );
        })}
      </ul>
      {!m.eligible && <p className="lx-fine">Bạn đã chơi {m.playMinutes}/{m.minPlayMinutes} phút. Chơi đủ là nhận được quà mọi mốc đã đạt, không có hạn.</p>}
    </section>
  );
}

/** Tin cập nhật (owner, 2026-10-07): the server's update notes from the panel, newest first, the first open. */
function NewsCard() {
  const items = useNews();
  const [open, setOpen] = useState<string | null>(null);
  const first = items?.[0]?.id ?? null;
  const isOpen = (id: string): boolean => (open === null ? id === first : open === id);
  return (
    <section className="lx-card lx-news" id="lx-news">
      <CardHead icon={<svg {...ico} width="18" height="18"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" /><path d="M18 14h-8M15 18h-5M10 6h8v4h-8z" /></svg>}
        title="Tin Cập Nhật" sub="Các bản cập nhật của server, mới nhất ở trên" />
      {items === undefined ? <p className="lx-empty">Đang tải…</p>
        : items.length === 0 ? <p className="lx-empty">Chưa có tin cập nhật nào. Bản cập nhật tới sẽ được báo ở đây.</p>
          : <ul className="lx-news-list">
            {items.map((n) => (
              <li key={n.id} className={isOpen(n.id) ? 'open' : ''}>
                <button type="button" className="lx-news-head" aria-expanded={isOpen(n.id)} onClick={() => setOpen(isOpen(n.id) ? '' : n.id)}>
                  <b>{n.title}</b><span className="lx-news-date">{newsDate(n.at)}</span>
                </button>
                {isOpen(n.id) && n.body && <p className="lx-news-body">{n.body}</p>}
              </li>
            ))}
          </ul>}
    </section>
  );
}
const newsDate = (t: number): string => new Date(t * 1000).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** The server (app.js renderServer's data), as rows. */
function ServerCard() {
  const srv = useServer();
  const up = srv?.phase === 'running';
  const status = srv === undefined ? 'Đang kiểm tra…' : srv === null ? 'Tắt hoặc mất kết nối' : up ? 'Trực tuyến' : 'Đang khởi động lại…';
  const rows: Array<[string, React.ReactNode, string?]> = [
    ['Trạng thái', <><i className={`lx-dot${srv && up ? ' up' : ''}`} id="srv-dot" /><span id="srv-status-text">{status}</span></>, srv && up ? 'ok' : 'warn'],
    ['Sức chứa người chơi', <span id="srv-slots-text">{srv ? `${srv.online ?? 0} / ${srv.maxPlayers ?? 100} slot` : '0 / 100 slot'}</span>],
    ['Độ trễ trung bình', '~24 ms · 60 TPS', 'ok'],
    ['Động cơ mô phỏng', 'Unreal Engine 5.6'],
    ['Bảo vệ máy chủ', 'Easy Anti-Cheat'],
    ['Chế độ máy chủ', 'Evrima Survival 24/7'],
  ];
  return (
    <section className="lx-card lx-server" id="lx-server">
      <CardHead icon={<svg {...ico} width="18" height="18"><rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" /></svg>}
        title={<>Máy Chủ {srv?.name ?? 'Gateway'}</>} sub="Bản đồ Gateway · The Isle Evrima" />
      <ul className="lx-rows">
        {rows.map(([k, v, c]) => <li key={k}><span>{k}</span><b className={c ?? ''}>{v}</b></li>)}
      </ul>
    </section>
  );
}

/**
 * Trang chủ of the launcher's look: the voice bar, the check-in, the quests, the server's online milestones, Tin cập nhật, the server. The same data
 * and claims as the web's Trang chủ (Rewards: useRewardActions). No live dino card (owner, 2026-10-07: Live Monitor has it).
 */
export function LxHome({ me }: { me: PlayerMe | null | undefined }) {
  const { busy, starter, quest, checkin, milestone } = useRewardActions();
  const eco = me?.economy ?? null;
  const gift = me?.starter ?? null;
  const rel = me?.releases ?? {};
  const giftBtn = gift ? (
    <div className="lx-starter" id="home-starter">
      <button type="button" className="lx-btn primary sm" id="home-starter-btn" disabled={Boolean(gift.locked) || busy} onClick={starter}>🎁 Nhận quà tân thủ <RelBadge b={rel['starter']} /></button>
      <span className="lx-fine">Hộp dino tự chọn, mỗi tài khoản 1 lần: nhận vào Túi đồ, mở hộp chọn loài (tăng trưởng 50–100%), rồi chọn giới tính và mutation.{gift.locked && <> 🧪 {gift.locked}</>}</span>
    </div>
  ) : null;
  return (
    <div className="lx-home">
      <VoiceBar me={me} />
      <div className="lx-grid-2">
        {eco ? <CheckinCard c={eco.checkin} locked={eco.locked} rel={rel['amber']} busy={busy} onCheckin={checkin} gift={giftBtn} />
          : giftBtn && <section className="lx-card">{giftBtn}</section>}
        {me && me.quests ? <QuestsCard me={me} busy={busy} onClaim={quest} /> : null}
        {me === null && (
          <section className="lx-card lx-guest">
            <CardHead icon={<Svg name="home" size={18} />} title="Đăng nhập để bắt đầu" sub="Điểm danh, nhiệm vụ, gara, túi đồ và voice cần đăng nhập Steam." />
            <a className="btn btn-steam lx-login" href="/auth/steam">Đăng nhập Steam</a>
          </section>
        )}
      </div>
      {me?.milestones && <MilestonesCard m={me.milestones} busy={busy} onClaim={milestone} />}
      <div className="lx-grid-2 wide-left">
        <NewsCard />
        <ServerCard />
      </div>
    </div>
  );
}
