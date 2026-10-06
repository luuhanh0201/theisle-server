import type { PlayerMe } from '@isle/api';
import { inLauncher, launcher, useGameMode } from '../../lib/launcher';
import { useServer } from '../../lib/queries';
import { useToast } from '../toast';
import { useDrawer } from './drawer';
import { DISCORD_PATH, Svg } from './icons';

/** Only a Discord invite from the server's Game.ini is linked (bridge publicServerInfo). */
export const discordOk = (url: unknown): url is string => typeof url === 'string' && /^https:\/\/discord(app)?\.(gg|com)\//.test(url);

/** Đăng nhập Steam, or the name and Đăng xuất (app.js renderAuth). */
function Auth({ me }: { me: PlayerMe | null | undefined }) {
  if (me === undefined) return <div id="auth-actions" />;
  if (me === null) {
    return <div id="auth-actions"><a className="btn btn-steam" href="/auth/steam" style={{ padding: '7px 14px', fontSize: 12 }}>Đăng nhập Steam</a></div>;
  }
  const who = me.name ?? me.steamId;
  const logout = async (): Promise<void> => {
    await fetch('/auth/logout', { method: 'POST' });
    location.reload();
  };
  return (
    <div id="auth-actions">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="muted auth-name" style={{ fontSize: 13, fontWeight: 600 }} title={who}>👤 {who}</span>
        <button type="button" className="btn btn-ghost" id="logout-btn" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => void logout()}>Đăng xuất</button>
      </div>
    </div>
  );
}

/** Game mode: one click puts the launcher out of the way (launcher main.js). */
function GameModeBtn() {
  const gm = useGameMode();
  const l = launcher();
  if (!l?.gameModeGet) return null;
  return (
    <button type="button" className="btn btn-ghost game-mode-btn" id="game-mode" aria-pressed={gm.on}
      title="Chế độ chơi game: thu launcher xuống khay, chỉ giữ các khung overlay bạn chọn" onClick={() => l.gameModeSet?.(!gm.on)}>
      🎮<span className="gm-text"> Chế độ chơi game</span>
    </button>
  );
}

export function Header({ me, onTour }: { me: PlayerMe | null | undefined; onTour?: () => void }) {
  const srv = useServer();
  const { setOpen, setCollapsed } = useDrawer();
  const toast = useToast();
  return (
    <header className="top-header">
      <button type="button" className="mobile-menu-btn" id="mobile-menu-toggle" aria-label="Mở menu điều hướng" onClick={() => setOpen(true)}>
        <Svg name="menu" size={22} />
      </button>
      <button type="button" className="desktop-sidebar-expand-btn" id="desktop-sidebar-expand" aria-label="Mở rộng menu" title="Mở rộng menu bên trái" onClick={() => setCollapsed(false)}>
        <Svg name="panel" size={16} />
        <span>Mở menu</span>
      </button>

      <div className="header-actions">
        <button type="button" className="btn btn-ghost tour-trigger-btn" id="tour-btn" title="Hướng dẫn sử dụng tính năng và bản đồ AI"
          onClick={() => (onTour ? onTour() : toast('Hướng dẫn chưa chuyển sang trang mới'))}>
          <Svg name="help" size={15} />
          <span>Hướng dẫn</span>
        </button>
        <GameModeBtn />
        {srv && discordOk(srv.discord) && (
          <a className="btn btn-discord" id="srv-discord" href={srv.discord} target="_blank" rel="noopener">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={DISCORD_PATH} /></svg>
            <span>Discord</span>
          </a>
        )}
        {/* Nothing about downloading the launcher, inside it (AGENTS.md "Launcher"). */}
        {!inLauncher() && (
          <a className="btn btn-ghost web-only" id="get-launcher" href="/tai.html">
            <Svg name="download" size={15} />
            <span>Tải launcher</span>
          </a>
        )}
        <Auth me={me} />
      </div>
    </header>
  );
}
