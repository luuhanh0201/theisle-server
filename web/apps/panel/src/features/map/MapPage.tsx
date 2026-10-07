import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getJson } from '@isle/api';
import { Card, CardBody, Checkbox, PageHead } from '@isle/ui';
import { can } from '../../app/nav';
import { useSession } from '../../app/session';
import { unitsOf } from '../../lib/map';
import { dateTime } from '../../lib/format';
import { LAYERS, type AiLive, type Flora, type MapPlayer } from './data';
import { applyLive, loadMapData, setAiZones, setFlora, setGuard, setPlayers } from './load';
import { MapView, pathText } from './MapView';
import { DropPane, GuardPane, PlayersPane, ResetPane } from './Panes';
import { changed, fitToPoints, gd, lm, setLayer, useMapState, type AiZonesView, type GuardView, type LifePath } from './store';
import { ZonesPane } from './ZonesPane';
import { FloraReload } from './FloraReload';
import s from './Map.module.css';

const SIDES: ReadonlyArray<readonly [string, string]> = [['zones', 'Vùng AI'], ['drop', 'Thả AI'], ['reset', 'Làm mới'], ['guard', 'Dino nhỏ'], ['players', 'Người chơi']];
/** The bridge keeps the whole path of the last 5 lives. */
const PATH_LIVES = 5;
const sideSaved = (): string => { try { return localStorage.getItem('map-side') || 'zones'; } catch { return 'zones'; } };

/** Bản đồ: the island live (players, AI, zones, plants, places), and the AI tools beside it. #map/path/<id>/<spawnedAt>: a life's path. */
export function MapPage() {
  useMapState();
  const { access } = useSession();
  const [side, setSide] = useState(sideSaved);
  const pathKey = /^#map\/path\/([^/]+)\/(\d+)$/.exec(location.hash);
  const [pathInfo, setPathInfo] = useState<{ text: React.ReactNode } | null>(null);
  useEffect(() => { void loadMapData(); }, []);
  const map = useQuery({ queryKey: ['/api/map'], queryFn: () => getJson<{ players: MapPlayer[]; ai?: AiLive | null }>('/api/map'), refetchInterval: 2000 }).data;
  useEffect(() => { if (map) setPlayers(map.players, map.ai ?? null); }, [map]);
  // Between full refreshes: positions, heading and AI every second from the live file.
  const live = useQuery({ queryKey: ['/api/map/live'], queryFn: () => getJson<Parameters<typeof applyLive>[0]>('/api/map/live'), refetchInterval: 1000, enabled: lm.data !== null }).data;
  useEffect(() => { if (live) applyLive(live); }, [live]);
  const flora = useQuery({ queryKey: ['/api/map/flora'], queryFn: () => getJson<{ flora: Flora | null }>('/api/map/flora'), refetchInterval: 60_000 }).data;
  useEffect(() => { if (flora) setFlora(flora.flora); }, [flora]);
  const zones = useQuery({ queryKey: ['/api/ai-zones'], queryFn: () => getJson<AiZonesView>('/api/ai-zones'), refetchInterval: 2000 }).data;
  useEffect(() => { if (zones) setAiZones(zones); }, [zones]);
  const guard = useQuery({ queryKey: ['/api/zone-guard'], queryFn: () => getJson<GuardView>('/api/zone-guard'), refetchInterval: 2000, enabled: !gd.dirty }).data;
  useEffect(() => { if (guard) setGuard(guard); }, [guard]);

  // #map/path/<steamId>/<spawnedAt>: fetch that life's path once, fit the view to it.
  const key = pathKey ? `${pathKey[1]}/${pathKey[2]}` : null;
  useEffect(() => {
    lm.path = null;
    setPathInfo(null);
    changed();
    if (!pathKey) return undefined;
    let on = true;
    const steamId = decodeURIComponent(pathKey[1] as string);
    void (async () => {
      try {
        const [data, name] = await Promise.all([
          getJson<Omit<LifePath, 'steamId'>>(`/api/player/${encodeURIComponent(steamId)}/path/${pathKey[2]}`),
          getJson<{ player: { name: string | null } | null }>(`/api/player/${encodeURIComponent(steamId)}`).then((d) => d.player?.name ?? null).catch(() => null),
        ]);
        if (!on) return;
        lm.path = { ...data, steamId };
        setPathInfo({ text: pathText(name, steamId, data, s.m ?? '') });
        await loadMapData();
        if (on && data.points.length > 0 && lm.data) fitToPoints(data.points.map(unitsOf));
        changed();
      } catch {
        if (on) setPathInfo({ text: <span>Không còn đường đi của đời dino này (bridge chỉ giữ {PATH_LIVES} đời gần nhất).</span> });
      }
    })();
    return () => { on = false; };
  }, [key]);

  const count: Record<string, number | string | undefined> = {};
  for (const f of lm.data?.features ?? []) count[f.layer] = ((count[f.layer] as number | undefined) ?? 0) + 1;
  count['trails'] = '';
  count['ai'] = lm.ai && !lm.ai.stale ? String(lm.ai.count) : '';
  count['fish'] = lm.ai && !lm.ai.stale ? String(lm.ai.fish ?? 0) : '';
  count['aizone'] = '';
  count['migrlive'] = lm.flora ? lm.flora.spawners.length : '';
  count['flora'] = lm.flora ? lm.flora.plants.length + lm.flora.fruits.length : '';
  const ai = lm.ai;
  const world = can(access, 'world.view');
  const pick = (id: string): void => { setSide(id); try { localStorage.setItem('map-side', id); } catch { /* not remembered */ } };
  return (
    <div>
      <PageHead title="Bản đồ trực tiếp" sub="Gateway: người chơi đang online, vệt di chuyển gần nhất, vùng di cư, tuần tra, sanctuary, nước, hang và nguồn thức ăn." />
      <div className={s.layout}>
        <Card>
          <CardBody>
            <MapView pathInfo={pathInfo} onClosePath={() => { location.hash = 'map'; }} />
            {lm.data && (
              <ul className={s.layers} aria-label="Lớp hiển thị">
                {LAYERS.filter(([id]) => count[id] !== undefined).map(([id, label, color]) => (
                  <li key={id} className={s.chip}>
                    <Checkbox checked={lm.on.has(id)} onChange={(v) => setLayer(id, v)} label={<><span className={s.sw} style={{ background: color }} />{label}<span className={s.n}>{count[id]}</span></>} /></li>
                ))}
                <li><FloraReload /></li>
                <li className={s.aiStatus}>{ai === null ? 'AI live: chưa có dữ liệu, StatsLogger mới ghi sau lần khởi động tới.'
                  : ai.stale ? `AI live: không có dữ liệu mới từ ${dateTime(ai.t)} (server tắt hoặc mod không chạy).`
                    : `AI live: ${ai.count} con${ai.aiAlive !== null ? ` (game đếm ${ai.aiAlive})` : ''}${ai.fish ? ` · ${ai.fish} cá` : ''}${ai.dead ? ` · ${ai.dead} xác` : ''} · đọc lúc ${new Date(ai.t * 1000).toLocaleTimeString('vi-VN', { hour12: false })}. Các lớp "(tham khảo)" và vùng/địa danh lấy từ VulnonaMAP, không phải dữ liệu live.`}</li>
              </ul>
            )}
            {lm.data && (
              <div className={s.legend}>Thực vật: <b style={{ color: '#fbbf24' }}>(α)</b> carb · <b style={{ color: '#f472b6' }}>(β)</b> protein · <b style={{ color: '#38bdf8' }}>(γ)</b> lipid · không ghi = không có chất (chữ hiện khi phóng to). Cây & vùng di cư là dữ liệu thật của server (vùng cập nhật ~2 phút, cây ~10 phút hoặc khi bấm Tải lại).{' '}
                Bản đồ &amp; dữ liệu địa điểm: <a href={lm.data.source.url} target="_blank" rel="noopener noreferrer">{lm.data.source.name}</a> ({lm.data.source.author}) · {lm.data.name}, cập nhật {lm.data.updated} · ảnh nền chụp trong game, bản quyền thuộc nhà phát triển game · kéo để di chuyển, cuộn để phóng to</div>
            )}
          </CardBody>
        </Card>
        <Card className={s.side}>
          <div className={s.tabs} role="tablist" aria-label="Công cụ bản đồ">
            {SIDES.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={side === id} className={side === id ? s.on : undefined} onClick={() => pick(id)}>{label}</button>)}
          </div>
          {side === 'zones' && <ZonesPane />}
          {side === 'drop' && <DropPane />}
          {side === 'reset' && (world ? <ResetPane /> : <div className={s.pane}><span className={s.hint2}>Cần quyền xem Thế giới.</span></div>)}
          {side === 'guard' && <GuardPane />}
          {side === 'players' && <PlayersPane />}
        </Card>
      </div>
    </div>
  );
}
