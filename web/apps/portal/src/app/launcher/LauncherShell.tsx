import { useEffect, useRef, useState, type ReactNode } from 'react';
import './launcher.css';
import type { PlayerMe } from '@isle/api';
import { RelBadge } from '../../components/RelBadge';
import { Amber } from '../../lib/amber';
import { launcher, setLauncherUi, updateAction, updateLabel, useGameMode, useUpdateState } from '../../lib/launcher';
import { useMe, useServer } from '../../lib/queries';
import { useVoice } from '../../lib/voice';
import { useVoiceDot } from '../../lib/voiceDot';
import { Rules } from '../../features/home/Guide';
import { Page } from '../../pages';
import { CommandPalette } from '../CommandPalette';
import { goTo } from '../router';
import { DrawerProvider } from '../shell/drawer';
import { discordOk } from '../shell/Header';
import { shopShown } from '../shell/Sidebar';
import { DISCORD_PATH, Svg, type IconName } from '../shell/icons';
import { Tour, useTour } from '../Tour';
import { LxHome } from './LxHome';
import { firstPlay, goView, groupOf, useLxView, type LxGroup, type LxView } from './view';

function initials(name: string): string {
  const w = name.replace(/[[\]().,:·-]/g, ' ').split(/\s+/).filter((x) => /[\p{L}\p{N}]/u.test(x));
  return ((w[0]?.[0] ?? 'X') + (w[1]?.[0] ?? w[0]?.[1] ?? '')).toUpperCase();
}

function TopNav({ group, me }: { group: LxGroup; me: PlayerMe | null | undefined }) {
  const playing = Boolean(me?.dino && me.online);
  const item = (g: LxGroup, icon: IconName, label: string, to: () => void, extra?: ReactNode) => (
    <button type="button" className={`lx-tab${group === g ? ' on' : ''}`} data-lx-group={g} aria-current={group === g ? 'page' : undefined} onClick={to}>
      <Svg name={icon} size={16} /><span>{label}</span>{extra}
    </button>
  );
  return (
    <nav className="lx-tabs" aria-label="Phần chính">
      {item('home', 'home', 'Trang Chủ', () => goView('home'))}
      {item('play', 'game', 'Trò Chơi', () => goView(firstPlay(me)),
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
      title={dot?.text ?? 'Voice 3D: chưa vào phòng'} onClick={() => goView('voice')}>
      <Svg name="voice" size={14} /><span>Voice 3D</span>
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
      <b className="tabular-nums">{srv === undefined ? 'Server Gateway Live' : up ? `${srv.online ?? 0}/${srv.maxPlayers ?? 100} slot` : '0/100 slot'}</b>
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

/** Trò chơi's own bar: the bag, the garage, map and live, the shop, Skin Studio, the rankings, the rules. */
function PlayBar({ view, me }: { view: LxView; me: PlayerMe | null | undefined }) {
  const rel = me?.releases ?? {};
  const items = Array.isArray(me?.items) ? me.items.length : 0;
  const friends = me?.friends && !me.friends.locked ? me.friends.incoming ?? 0 : 0;
  const btn = (to: LxView, on: boolean, icon: IconName, label: string, extra?: ReactNode) => (
    <button type="button" className={`lx-sub${on ? ' on' : ''}`} data-lx-nav={to} aria-current={on ? 'page' : undefined} onClick={() => goView(to)}>
      <Svg name={icon} size={15} /><span>{label}</span>{extra}
    </button>
  );
  return (
    <div className="lx-subbar" role="tablist" aria-label="Trò chơi">
      {me?.bag && btn('bag', view === 'bag', 'bag', 'Túi Đồ', <><RelBadge b={rel['bag']} nav />{items > 0 && <span className="lx-count" id="nav-bag-badge">{items}</span>}</>)}
      {btn('gara', view === 'gara', 'gara', 'Gara Khủng Long', <span className="lx-count" id="nav-gara-badge">{me?.garage.length ?? 0}</span>)}
      {btn(view === 'game' ? 'game' : 'map', view === 'map' || view === 'game', 'map', 'Bản Đồ & Live Monitor',
        <><span className="lx-live">Live</span>{friends > 0 && <span className="lx-count warn" id="nav-map-badge" title="Lời mời kết bạn">{friends}</span>}</>)}
      {shopShown(me) && btn('shop', view === 'shop', 'shop', 'Cửa Hàng', <RelBadge b={rel['shop']} nav />)}
      {btn('skin', view === 'skin', 'skin', 'Skin Studio', <span className="lx-new">Mới</span>)}
      {btn('ranking', view === 'ranking', 'ranking', 'Bảng Xếp Hạng')}
      {btn('rules', view === 'rules', 'book', 'Luật & Dinh Dưỡng')}
    </div>
  );
}

/** Bản đồ or Dino Live, the two halves of "Bản Đồ & Live Monitor". */
function LiveSwitch({ view }: { view: LxView }) {
  return (
    <div className="lx-seg" role="tablist" aria-label="Bản đồ hoặc Dino Live">
      <button type="button" className={view === 'map' ? 'on' : ''} data-lx-live="map" onClick={() => goView('map')}><Svg name="map" size={14} /> Bản đồ Gateway</button>
      <button type="button" className={view === 'game' ? 'on' : ''} data-lx-live="game" onClick={() => goView('game')}><Svg name="game" size={14} /> Dino Live Monitor</button>
    </div>
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

  return (
    <DrawerProvider>
      <div className="lx" id="app-layout">
        <header className="lx-top top-header">
          <a href="#home" className="lx-brand brand" onClick={(e) => { e.preventDefault(); goView('home'); }}>
            <span className="lx-logo">{initials(name)}</span>
            <span className="lx-brand-txt">
              <b id="srv-name">{name}</b>
              <small>Cổng Người Chơi · Gateway</small>
            </span>
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
          {group === 'play' && <PlayBar view={view} me={me} />}
          {(view === 'map' || view === 'game') && <LiveSwitch view={view} />}
          {pages.map((t) => (
            <section key={t} id={`page-${t}`} className="page-content" hidden={t !== view}>
              {t === 'home' ? <LxHome me={me} /> : t === 'rules' ? <Rules /> : <Page tab={t} />}
            </section>
          ))}
        </main>
        <footer className="lx-foot">
          <span><b>{name}</b> · The Isle Evrima Dedicated Server</span>
          <span className="lx-foot-r">Voice 3D · Unreal Engine 5.6 · 60 TPS</span>
        </footer>
      </div>
      <CommandPalette onTour={tour.start} />
      <Tour step={tour.step} setStep={tour.setStep} />
    </DrawerProvider>
  );
}
