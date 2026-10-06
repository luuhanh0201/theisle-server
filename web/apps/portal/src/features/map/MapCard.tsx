import { useEffect, useRef } from 'react';
import type { PlayerMe } from '@isle/api';
import { useTab } from '../../app/router';
import { getMap, loadAi, loadAiZones, loadHeat } from '../../lib/mapService';

/** Every `ms` while the map page is shown and the tab seen (a hidden tab asks nothing). */
function useWhileShown(fn: () => Promise<void>, ms: number, on: boolean): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!on) return undefined;
    let busy = false;
    const t = setInterval(() => {
      if (busy || document.hidden) return;
      busy = true;
      void ref.current().finally(() => { busy = false; });
    }, ms);
    return () => clearInterval(t);
  }, [ms, on]);
}

/** Bản Đồ Vệ Tinh Gateway: your dino on the map (map.js), the live AI every 2 s, the zones and the heat every minute. */
export function MapCard({ me }: { me: PlayerMe | null | undefined }) {
  const box = useRef<HTMLDivElement>(null);
  const shown = useTab() === 'map';
  // The map is made for a logged-in player only (app.js renderMap); a guest gets the empty box.
  const logged = Boolean(me);
  useEffect(() => {
    if (!logged || !box.current) return;
    const { root } = getMap();
    if (root.parentElement !== box.current) box.current.append(root);
  }, [logged]);
  useEffect(() => { if (me) getMap().map.update(me.dino); }, [me]);
  useWhileShown(loadAi, 2000, shown && logged);
  useWhileShown(loadAiZones, 60_000, shown && logged);
  useWhileShown(loadHeat, 60_000, shown && logged);
  const has = Boolean(me?.dino?.position);
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="card-header" style={{ marginBottom: 12 }}>
        <div>
          <h3 className="card-title">🗺️ Bản Đồ Vệ Tinh Gateway</h3>
          <span className="card-subtitle">Vị trí và góc nhìn Dino của bạn, cập nhật thời gian thực mỗi giây</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`tag${me && !has ? ' warning' : ''}`} id="map-status-tag">{!me ? 'Live tracking' : has ? 'Dino trực tuyến' : 'Chưa có vị trí'}</span>
        </div>
      </div>
      <div id="map" ref={box} />
    </div>
  );
}
