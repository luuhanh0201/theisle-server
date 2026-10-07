import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import './launcher.css';
import type { PlayerMe } from '@isle/api';
import { RelBadge } from '../../components/RelBadge';
import { Amber } from '../../lib/amber';
import { launcher, setLauncherUi, updateAction, updateLabel, useGameMode, useUpdateState } from '../../lib/launcher';
import { useMe, useServer } from '../../lib/queries';
import { useVoice } from '../../lib/voice';
import { useVoiceDot } from '../../lib/voiceDot';
import { Page } from '../../pages';
import { CommandPalette } from '../CommandPalette';
import { goTo } from '../router';
import { DrawerProvider } from '../shell/drawer';
import { discordOk } from '../shell/Header';
import { shopShown } from '../shell/Sidebar';
import { DISCORD_PATH, Svg, type IconName } from '../shell/icons';
import { Tour, useTour } from '../Tour';
import { dinoCard } from '../../features/home/LauncherHub';
import { LxHome } from './LxHome';
import { firstPlay, goView, groupOf, useLxView, type LxGroup, type LxView } from './view';

function initials(name: string): string {
  const w = name.replace(/[[\]().,:·-]/g, ' ').split(/\s+/).filter((x) => /[\p{L}\p{N}]/u.test(x));
  return ((w[0]?.[0] ?? 'X') + (w[1]?.[0] ?? w[0]?.[1] ?? '')).toUpperCase();
}

/** The three parts on top; a light slides to the one picked (owner, 2026-10-07: "hiệu ứng chuyển menu"). */
function TopNav({ group, me }: { group: LxGroup; me: PlayerMe | null | undefined }) {
  const playing = Boolean(me?.dino && me.online);
  const nav = useRef<HTMLElement>(null);
  const [glow, setGlow] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return undefined;
    const place = (): void => {
      const on = el.querySelector<HTMLElement>(`[data-lx-group="${group}"]`);
      if (on) setGlow({ left: on.offsetLeft, width: on.offsetWidth });
    };
    place();
    // The labels hide on a narrow window (the buttons change size): follow them.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [group]);
  const item = (g: LxGroup, icon: IconName, label: string, to: () => void, extra?: ReactNode) => (
    <button type="button" className={`lx-tab${group === g ? ' on' : ''}`} data-lx-group={g} aria-current={group === g ? 'page' : undefined} title={label} onClick={to}>
      <Svg name={icon} size={16} /><span className="lx-tab-txt">{label}</span>{extra}
    </button>
  );
  return (
    <nav className="lx-tabs" aria-label="Phần chính" ref={nav}>
      {glow && <span className="lx-tab-glow" aria-hidden="true" style={{ transform: `translateX(${glow.left}px)`, width: glow.width }} />}
      {item('home', 'home', 'Trang Chủ', () => goView('home'))}
      {item('play', 'game', 'Trò Chơi', () => goView(firstPlay()),
        <span className={`lx-live-dot${playing ? ' on' : ''}`} id="nav-dino-badge" title={playing ? 'Đang chơi một con dino' : 'Chưa vào game'} />)}
      {item('overlay', 'overlay', 'Overlay', () => goView('overlay'), <span className="lx-pill">HUD</span>)}
    </nav>
  );
}

function VoiceChip({ view }: { view: LxView }) {
  const dot = useVoiceDot();
  const v = useVoice();
  return (
    <button type="button" className={`lx-chip lx-voice-chip${v.connected ? ' on' : ''}${view === 'voice' ? ' here' : ''}`} id="lx-voice-chip"
      title={dot?.text ?? 'Voice: chưa vào phòng'} onClick={() => goView('voice')}>
      <Svg name="voice" size={14} /><span className="lx-chip-txt">Voice</span>
      {dot && <span className={`nav-voice-dot ${dot.kind}`} id="nav-voice-dot" role="img" aria-label={dot.text} />}
    </button>
  );
}

function SlotsChip() {
  const srv = useServer();
  const up = srv !== null && srv !== undefined;
  return (
    <span className={`lx-chip lx-slots${up && srv.phase === 'running' ? ' up' : ''}`} id="sidebar-slots" title="Người chơi trên server">
      <i className="lx-dot" />
      <b className="tabular-nums">{srv === undefined ? '-' : up ? `${srv.online ?? 0}/${srv.maxPlayers ?? 100}` : '0/100'}<span className="lx-slot-word"> slot</span></b>
      <span className="lx-ping">24ms</span>
    </span>
  );
}

/** The launcher's version and its update (never a download: AGENTS.md "Launcher"). */
function UpdateChip() {
  const st = useUpdateState();
  const l = launcher();
  if (!l?.version) return null;
  const u = st && l.updateGet ? updateLabel(st) : null;
  return (
    <button type="button" className={`lx-chip lx-update${u?.ready ? ' ready' : ''}`} id="lx-update" disabled={u?.disabled ?? !l.updateGet}
      title={u?.title ?? `Đang dùng v${l.version}`} onClick={updateAction}>
      <span className="launcher-version">Launcher</span>
      <b className="lx-ver">v{l.version}</b>
      {u && u.text && (u.ready || u.disabled) && <span className="launcher-update">{u.text}</span>}
    </button>
  );
}

function GameModeChip() {
  const gm = useGameMode();
  const l = launcher();
  if (!l?.gameModeGet) return null;
  return (
    <button type="button" className={`lx-chip lx-gm${gm.on ? ' on' : ''}`} id="game-mode" aria-pressed={gm.on}
      title="Chế độ chơi game: thu launcher xuống khay, chỉ giữ các khung overlay bạn chọn" onClick={() => l.gameModeSet?.(!gm.on)}>
      🎮<span className="gm-text"> Chơi game</span>
    </button>
  );
}

/** Who is logged in and their Hổ phách; a menu: the guide, Discord, the web look, Đăng xuất. Or Đăng nhập Steam. */
function Account({ me, onTour }: { me: PlayerMe | null | undefined; onTour: () => void }) {
  const srv = useServer();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent): void => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  if (me === undefined) return <div id="auth-actions" className="lx-account" />;
  if (me === null) {
    return <div id="auth-actions" className="lx-account"><a className="btn btn-steam lx-login" href="/auth/steam">Đăng nhập Steam</a></div>;
  }
  const who = me.name ?? me.steamId;
  const logout = async (): Promise<void> => {
    await fetch('/auth/logout', { method: 'POST' });
    location.reload();
  };
  return (
    <div id="auth-actions" className="lx-account" ref={box}>
      <button type="button" className="lx-me" aria-haspopup="menu" aria-expanded={open} title={who} onClick={() => setOpen(!open)}>
        <span className="lx-avatar">{initials(who)}</span>
        <span className="lx-me-txt"><b className="auth-name">{who}</b>{me.economy && <span className="lx-amber" id="home-amber"><Amber n={me.economy.balance} /></span>}</span>
      </button>
      {open && (
        <div className="lx-menu" role="menu">
          <button type="button" role="menuitem" id="tour-btn" onClick={() => { setOpen(false); onTour(); }}><Svg name="help" size={15} /> Hướng dẫn</button>
          {me.economy && <button type="button" role="menuitem" onClick={() => { setOpen(false); goView('shop'); }}>🛒 Cửa hàng Hổ phách</button>}
          {srv && discordOk(srv.discord) && (
            <a role="menuitem" id="srv-discord" href={srv.discord} target="_blank" rel="noopener" onClick={() => setOpen(false)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={DISCORD_PATH} /></svg> Discord
            </a>
          )}
          <button type="button" role="menuitem" id="lx-web-look" onClick={() => setLauncherUi(false)}>🖥️ Giao diện web</button>
          <button type="button" role="menuitem" id="logout-btn" className="lx-danger" onClick={() => void logout()}>Đăng xuất</button>
        </div>
      )}
    </div>
  );
}

/**
 * Trò chơi's side bar (owner, 2026-10-07): the pages of Trò chơi, a light list beside the page (the menu is the bar on top),
 * in this order: Live Monitor, Live map & bạn bè, Gara, Skin, Bảng xếp hạng, Túi đồ, Cửa hàng; the whole height,
 * the dino played now and the Hổ phách at its foot. No Luật & Dinh Dưỡng.
 */
function PlaySide({ view, me }: { view: LxView; me: PlayerMe | null | undefined }) {
  const rel = me?.releases ?? {};
  const items = Array.isArray(me?.items) ? me.items.length : 0;
  const friends = me?.friends && !me.friends.locked ? me.friends.incoming ?? 0 : 0;
  const playing = Boolean(me?.dino && me.online);
  const dino = dinoCard(me);
  const btn = (to: LxView, icon: IconName, label: string, extra?: ReactNode) => (
    <button type="button" className={`lx-side-btn${view === to ? ' on' : ''}`} data-lx-nav={to} aria-current={view === to ? 'page' : undefined} onClick={() => goView(to)}>
      <Svg name={icon} size={16} /><span className="lx-side-txt">{label}</span>{extra}
    </button>
  );
  return (
    <aside className="lx-side">
      <div className="lx-side-head">Trò chơi</div>
      <nav className="lx-side-list" aria-label="Trò chơi">
        {btn('game', 'game', 'Live Monitor', <span className={`lx-live${playing ? '' : ' off'}`} id="nav-dino-live">Live</span>)}
        {btn('map', 'map', 'Live Map & Bạn Bè', friends > 0 ? <span className="lx-count warn" id="nav-map-badge" title="Lời mời kết bạn">{friends}</span> : undefined)}
        {btn('gara', 'gara', 'Gara', <span className="lx-count" id="nav-gara-badge">{me?.garage.length ?? 0}</span>)}
        {btn('skin', 'skin', 'Skin')}
        {btn('ranking', 'ranking', 'Bảng Xếp Hạng')}
        {me?.bag && btn('bag', 'bag', 'Túi Đồ', <><RelBadge b={rel['bag']} nav />{items > 0 && <span className="lx-count" id="nav-bag-badge">{items}</span>}</>)}
        {shopShown(me) && btn('shop', 'shop', 'Cửa Hàng', <RelBadge b={rel['shop']} nav />)}
      </nav>
      <div className="lx-side-foot">
        <button type="button" className={`lx-side-dino${playing ? ' on' : ''}`} id="lx-side-dino" onClick={() => goView('game')} title="Mở Live Monitor">
          <span className="lx-side-dino-top"><b>{dino.species}</b><span className="lx-side-dino-pct">{playing ? dino.pct : ''}</span></span>
          <span className="lx-bar thin"><i style={{ width: dino.width }} /></span>
          <span className="lx-side-dino-st">{playing ? 'Đang chơi' : dino.badge.replace(/^[○●]\s*/, '')}</span>
        </button>
        {me?.economy && <div className="lx-side-amber"><span>Hổ phách</span><Amber n={me.economy.balance} /></div>}
      </div>
    </aside>
  );
}

function readLoginError(): string | null {
  const e = new URLSearchParams(location.search).get('login_error');
  if (!e) return null;
  history.replaceState(null, '', location.pathname);
  return `Đăng nhập không thành công: ${e}`;
}

/**
 * The launcher's own look (owner's design, 2026-10-07): a bar on top (the server, Trang chủ / Trò chơi / Overlay HUD,
 * voice, slots, the launcher's version, game mode, the account), Trò chơi's own bar, the page, a footer. The pages are
 * the site's (pages/, features/: the same calls and rules), Trang chủ its own (LxHome) from the same data.
 */
export function LauncherShell() {
  const me = useMe();
  const srv = useServer();
  const view = useLxView();
  const group = groupOf(view);
  const [error] = useState(readLoginError);
  const tour = useTour();
  const name = srv?.name || 'The Isle Evrima';

  useEffect(() => { if (srv?.name) document.title = srv.name; }, [srv?.name]);
  useEffect(() => { if (me !== undefined && view === 'bag' && !me?.bag) goTo('home'); }, [view, me]);
  useEffect(() => {
    document.documentElement.classList.add('lx-ui');
    return () => document.documentElement.classList.remove('lx-ui');
  }, []);
  // A page once opened stays (hidden), as on the web: what was typed, picked or zoomed is still there.
  const [seen, setSeen] = useState<LxView[]>([view]);
  useEffect(() => { setSeen((s) => (s.includes(view) ? s : [...s, view])); }, [view]);
  const pages = seen.includes(view) ? seen : [...seen, view];
  // Trò chơi scrolls its page only (the side bar stays): another page starts at its top.
  const pagesBox = useRef<HTMLDivElement>(null);
  useEffect(() => { if (pagesBox.current) pagesBox.current.scrollTop = 0; }, [view]);

  return (
    <DrawerProvider>
      <div className={`lx${group === 'play' ? ' lx-fixed' : ''}`} id="app-layout">
        <header className="lx-top top-header">
          {/* The server's logo where its name was (owner, 2026-10-07); the name stays for screen readers and the tooltip. */}
          <a href="#home" className="lx-brand brand" title={name} onClick={(e) => { e.preventDefault(); goView('home'); }}>
            <img className="lx-logo-img" src="/img/logo-96.webp" width="40" height="40" alt="" />
            <b id="srv-name" className="lx-sr">{name}</b>
          </a>
          <TopNav group={group} me={me} />
          <div className="lx-right header-actions">
            <VoiceChip view={view} />
            <SlotsChip />
            <UpdateChip />
            <GameModeChip />
            <Account me={me} onTour={tour.start} />
          </div>
        </header>
        <main className={`lx-main page-container lx-g-${group}`}>
          <div id="error" className="err" hidden={error === null}>{error}</div>
          <div className={group === 'play' ? 'lx-play' : undefined}>
            {group === 'play' && <PlaySide view={view} me={me} />}
            <div className="lx-pages" ref={pagesBox}>
              {pages.map((t) => (
                <section key={t} id={`page-${t}`} className="page-content" hidden={t !== view}>
                  {t === 'home' ? <LxHome me={me} /> : <Page tab={t} />}
                </section>
              ))}
            </div>
          </div>
        </main>
        <footer className="lx-foot">
          <span><b>{name}</b> · The Isle Evrima Dedicated Server</span>
          <span className="lx-foot-r">Voice · Unreal Engine 5.6 · 60 TPS</span>
        </footer>
      </div>
      <CommandPalette onTour={tour.start} />
      <Tour step={tour.step} setStep={tour.setStep} />
    </DrawerProvider>
  );
}
