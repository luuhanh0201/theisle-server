import { useQuery } from '@tanstack/react-query';
import { inLauncher } from '../../lib/launcher';

interface TaiVersion { version?: unknown; windows?: { file?: string; size?: number } }

/**
 * The launcher download on Trang chủ: the Windows installer straight away (most players); Linux and the
 * install help on /tai.html ("xem thêm"). Web only: nothing about downloading inside the launcher.
 */
export function LauncherPromo() {
  const v = useQuery({
    queryKey: ['/tai/version.json'], enabled: !inLauncher(), staleTime: Infinity, retry: false,
    queryFn: async () => {
      const r = await fetch('/tai/version.json', { cache: 'no-cache' });
      return r.ok ? (await r.json()) as TaiVersion : null;
    },
  }).data;
  if (inLauncher()) return null;
  const f = v?.windows?.file ? v.windows : null;
  return (
    <div className="launcher-promo web-only" id="launcher-promo">
      <div className="lp-info">
        <img className="lp-logo" src="/img/logo-96.webp" width="60" height="60" alt="Logo launcher" />
        <div>
          <div className="lp-badge"><span className="lp-new">MỚI</span> Xóm Gáy Launcher <span id="lp-version">{typeof v?.version === 'string' ? `v${v.version}` : ''}</span></div>
          <h3 className="lp-title">Chơi trọn vẹn hơn với launcher của server</h3>
          <ul className="lp-feats">
            <li>🎙️ Voice: nói được cả khi đang tập trung ingame</li>
            <li>🗺️ Overlay mini map · 🦖 máu dino · 🏆 nhiệm vụ Prime</li>
            <li>🏡 Gara, bản đồ live, xếp hạng: một cú click</li>
          </ul>
        </div>
      </div>
      <div className="lp-cta">
        <a className="lp-btn" id="lp-btn" href={f ? `/tai/${encodeURIComponent(f.file as string)}` : '/tai.html'}>
          <span className="lp-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m6.5 10 5.5 5.5L17.5 10" /><path d="M4 20h16" /></svg></span>
          <span className="lp-text"><b>Tải launcher</b><small id="lp-os">{f ? `cho Windows${f.size ? ` · ${Math.round(f.size / 1048576)} MB` : ''} · miễn phí` : 'cho Windows · miễn phí'}</small></span>
        </a>
        <a className="lp-more" href="/tai.html" id="lp-more">Xem thêm: bản cho Linux &amp; hướng dẫn cài</a>
      </div>
    </div>
  );
}
