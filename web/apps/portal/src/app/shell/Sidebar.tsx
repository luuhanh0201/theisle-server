import type { ReactNode } from 'react';
import type { PlayerMe } from '@isle/api';
import { RelBadge } from '../../components/RelBadge';
import { homeRelease } from '../../lib/releases';
import { inLauncher, launcher, updateAction, updateLabel, useUpdateState } from '../../lib/launcher';
import { useServer } from '../../lib/queries';
import { useVoiceDot } from '../../lib/voiceDot';
import { openRules } from '../actions';
import { goTo, useTab, type Tab } from '../router';
import { useDrawer } from './drawer';
import { Svg, type IconName } from './icons';

/** Whether the shop shows in the menu (bridge svip.ts: null = admins only; an older bridge: with Hổ phách). */
export const shopShown = (me: PlayerMe | null | undefined): boolean => (me?.shop !== undefined ? Boolean(me.shop) : Boolean(me?.economy));

const Rel = ({ b }: { b: string | undefined }) => <RelBadge b={b} nav />;

function NavBtn({ tab, icon, label, title, children }: { tab: Tab; icon: IconName; label: string; title: string; children?: ReactNode }) {
  const now = useTab();
  const { setOpen } = useDrawer();
  return (
    <button type="button" className={`nav-btn${now === tab ? ' active' : ''}`} data-nav={tab} title={title} onClick={() => { goTo(tab); setOpen(false); }}>
      <span className="nav-icon"><Svg name={icon} /></span>
      <span className="nav-label">{label}</span>
      {children}
    </button>
  );
}

/** The launcher build under the server name, and (1.0.7+) a button to look for a newer one, then install it. */
function LauncherVersion() {
  const st = useUpdateState();
  const l = launcher();
  if (!l?.version) return null;
  const u = st && l.updateGet ? updateLabel(st) : null;
  return (
    <>
      {' · '}<span className="launcher-version">Launcher v{l.version}</span>
      {u && <>{' '}<button type="button" className={`launcher-update${u.ready ? ' ready' : ''}`} hidden={u.text === ''} disabled={u.disabled} title={u.title} onClick={updateAction}>{u.text}</button></>}
    </>
  );
}

/** The menu on the left (a drawer on a phone): the pages, their marks, the server's slots. */
export function Sidebar({ me }: { me: PlayerMe | null | undefined }) {
  const srv = useServer();
  const { open, setOpen, collapsed, setCollapsed } = useDrawer();
  const voice = useVoiceDot();
  const rel = me?.releases ?? {};
  const playing = Boolean(me?.dino && me.online);
  const friends = me?.friends && !me.friends.locked ? me.friends.incoming ?? 0 : 0;
  const items = Array.isArray(me?.items) ? me.items.length : 0;
  const up = srv !== null;
  const toggleTitle = collapsed ? 'Mở rộng menu bên trái' : 'Thu gọn menu bên trái';
  return (
    <>
      <div className={`drawer-backdrop${open ? ' open' : ''}`} id="drawer-backdrop" onClick={() => setOpen(false)} />
      <aside className={`sidebar${open ? ' drawer-open' : ''}`} id="portal-sidebar">
        <div className="sidebar-header">
          <a href="#home" className="brand" data-nav="home" onClick={() => setOpen(false)}>
            <img className="brand-logo" src="/img/logo-96.webp" width="40" height="40" alt="Logo server Xóm Gáy" />
            <div className="brand-info">
              <h1 id="srv-name">{srv?.name || 'The Isle Evrima'}</h1>
              <p>Cổng Người Chơi · Gateway<LauncherVersion /></p>
            </div>
          </a>
          <button type="button" className="sidebar-toggle" id="sidebar-toggle" title={toggleTitle} aria-label={toggleTitle} onClick={() => setCollapsed(!collapsed)}>
            <Svg name="collapse" className="icon-collapse" />
            <Svg name="expand" className="icon-expand" />
          </button>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-group">
            <div className="nav-group-title">Tổng quan & Theo dõi</div>
            <NavBtn tab="home" icon="home" label="Trang chủ" title="Trang chủ"><Rel b={homeRelease(me)} /></NavBtn>
            <NavBtn tab="game" icon="game" label="Dino Live Monitor" title="Dino Live Monitor">
              {/* LIVE: lit while they play a dino, dim otherwise. */}
              <span className={`nav-live${playing ? ' on' : ''}`} id="nav-dino-badge" title="Trực tiếp từ game">LIVE</span>
            </NavBtn>
            <NavBtn tab="map" icon="map" label="Bản đồ Gateway" title="Bản đồ Gateway Live">
              <span className="nav-live on" title="Vị trí trực tiếp từ game">LIVE</span>
              {friends > 0 && <span className="nav-badge" id="nav-map-badge" title="Lời mời kết bạn">{friends}</span>}
            </NavBtn>
          </div>

          <div className="nav-group">
            <div className="nav-group-title">Tính năng sinh tồn</div>
            <NavBtn tab="gara" icon="gara" label="Gara Khủng Long" title="Gara Khủng Long">
              <span className="nav-badge" id="nav-gara-badge">{me?.garage.length ?? 0}</span>
            </NavBtn>
            <NavBtn tab="ranking" icon="ranking" label="Bảng Xếp Hạng" title="Bảng Xếp Hạng & Chiến Tích" />
            <NavBtn tab="skin" icon="skin" label="Skin Studio" title="Skin Studio"><span className="nav-pill-new">MỚI</span></NavBtn>
            {/* Túi đồ: shown when the bridge says the bag is open to this account. */}
            {me?.bag && (
              <NavBtn tab="bag" icon="bag" label="Túi đồ" title="Túi đồ">
                <Rel b={rel['bag']} />
                {items > 0 && <span className="nav-badge" id="nav-bag-badge">{items}</span>}
              </NavBtn>
            )}
            {shopShown(me) && <NavBtn tab="shop" icon="shop" label="Cửa hàng" title="Cửa hàng Hổ phách"><Rel b={rel['shop']} /></NavBtn>}
          </div>

          <div className="nav-group">
            <div className="nav-group-title">Công cụ tiện ích</div>
            <NavBtn tab="voice" icon="voice" label="Voice 3D" title="Voice 3D">
              {voice && <span className={`nav-voice-dot ${voice.kind}`} id="nav-voice-dot" role="img" title={voice.text} aria-label={voice.text} />}
            </NavBtn>
            {/* The overlay is the launcher's: its page only shows there. */}
            {inLauncher() && <NavBtn tab="overlay" icon="overlay" label="Game Overlay HUD" title="Game Overlay HUD" />}
          </div>

          <div className="nav-group">
            <div className="nav-group-title">Hệ thống & Cẩm nang</div>
            {/* Nothing about downloading the launcher, inside it (AGENTS.md "Launcher"). */}
            {!inLauncher() && (
              <a className="nav-btn nav-launcher web-only" id="sidebar-launcher-link" href="/tai.html" title="Tải Xóm Gáy Launcher">
                <span className="nav-icon"><Svg name="download" /></span>
                <span className="nav-label">Tải Launcher</span>
                <span className="nav-badge" id="sidebar-lp-badge">v2.8</span>
              </a>
            )}
            <button type="button" className="nav-btn" data-action="open-rules" title="Luật Server & Cẩm Nang" onClick={() => { setOpen(false); openRules(); }}>
              <span className="nav-icon"><Svg name="book" /></span>
              <span className="nav-label">Luật & Dinh Dưỡng</span>
            </button>
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className="server-status-pill">
            <div className="s-pulse-dot" />
            <div className="s-info">
              <span className="s-slots" id="sidebar-slots">{srv === undefined ? 'Server Gateway Live' : up ? `${srv.online ?? 0} / ${srv.maxPlayers ?? 100} slot` : '0 / 100 slot'}</span>
              <span className="s-ping">24ms · Unreal Engine 5.6</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
