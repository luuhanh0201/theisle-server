import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getJson, type FishState, type FloraState } from '@isle/api';
import { Button, Card, CardBody, CardHead } from '@isle/ui';
import { ago } from '../../../lib/time';
import styles from './WorldOverview.module.css';

interface AiZones { enabled: boolean; globalMax: number; zones: unknown[]; status: { stale: boolean; total?: number; cap?: number } | null }
interface Ambient { live: boolean | null; ini: boolean | null }
interface MapFlora { flora: { spawners: Array<{ active: boolean; mass: boolean }>; plants: unknown[]; fruits: unknown[] } | null }
interface GameConfig { settings?: Record<string, unknown>; effective?: Record<string, unknown> }

/** One GET for the cards, refreshed every 2 s like a list page; a failed one leaves its line out. */
const useJson = <T,>(url: string) => useQuery({ queryKey: [url], queryFn: () => getJson<T>(url), refetchInterval: 2000 });

/** Thế giới → Tổng quan: what the island is like now, and where to change each thing. */
export function WorldOverview() {
  const zones = useJson<AiZones>('/api/ai-zones').data;
  const ambient = useJson<Ambient>('/api/ai-ambient').data;
  const flora = useJson<MapFlora>('/api/map/flora').data?.flora ?? null;
  const floraCfg = useJson<FloraState>('/api/flora-settings').data;
  const fish = useJson<FishState>('/api/fish-settings').data;
  const cfg = useJson<GameConfig>('/api/game-config').data;
  const eff = (k: string): unknown => cfg?.settings?.[k] ?? cfg?.effective?.[k];
  const onOff = (v: unknown): string => (v === true ? 'bật' : v === false ? 'tắt' : '?');
  const active = flora ? flora.spawners.filter((s) => s.active).length : null;
  const mass = flora ? flora.spawners.filter((s) => s.mass).length : null;
  const c = floraCfg?.control;
  const disallowed = eff('DisallowedAIClasses');
  return (
    <div className={styles.cards}>
      <WorldCard title="AI" href="#map" action="Vùng AI trên bản đồ" lines={[
        zones?.status && !zones.status.stale ? <>AI đang sống: <b>{zones.status.total ?? '?'}</b> / {zones.status.cap ?? zones.globalMax}</> : 'Mod vùng AI chưa báo số liệu',
        zones ? <>Vùng AI: <b>{zones.enabled ? 'bật' : 'tắt'}</b> · {zones.zones.length} vùng</> : null,
        ambient ? <>AI game tự sinh quanh người chơi: <b>{onOff(ambient.live ?? ambient.ini)}</b></> : null,
        `Mật độ AI của game: ${String(eff('AIDensity') ?? '?')} · cấm: ${(Array.isArray(disallowed) ? disallowed : []).join(', ') || 'không'}`,
      ]} />
      <WorldCard title="Di cư" href="#server/cfg%3Amigration" action="Cấu hình di cư" lines={[
        active !== null ? <>Khóm cây đang di cư: <b>{active}</b> · đại di cư: <b>{mass}</b></> : 'Chưa có dữ liệu cây',
        <>Di cư: <b>{onOff(eff('bEnableMigration'))}</b> · đại di cư: <b>{onOff(eff('bEnableMassMigration'))}</b> · tuần tra: <b>{onOff(eff('bEnablePatrolZones'))}</b></>,
      ]} />
      <WorldCard title="Ngày đêm" href="#server/cfg%3Aworld" action="Cấu hình ngày đêm" lines={[
        <>Ngày <b>{String(eff('ServerDayLengthMinutes') ?? '?')}</b> phút · đêm <b>{String(eff('ServerNightLengthMinutes') ?? '?')}</b> phút</>,
      ]} />
      <WorldCard title="Thực vật" href="#world/flora" action="Cài đặt thực vật" lines={[
        c ? <><b>{c.plantsNutri}/{c.plants}</b> cây và <b>{c.fruitsNutri}/{c.fruits}</b> quả có chất</> : flora ? `${flora.plants.length} cây, ${flora.fruits.length} quả` : 'Chưa có dữ liệu',
        floraCfg ? <>Điều khiển: <b>{floraCfg.settings.control ? 'bật' : 'tắt'}</b> · tối đa {floraCfg.settings.migrationMaxPerArea} cây/khóm di cư</> : null,
      ]} />
      <WorldCard title="Cá" href="#world/fish" action="Cài đặt cá" lines={[
        fish ? <>Điều khiển: <b>{fish.settings.control ? 'bật' : 'tắt'}</b> · {fish.settings.perPlayer} / người · {fish.settings.species.length}/6 loài</> : null,
        fish?.census ? <>Lượt đếm {ago(fish.census.t)}: <b>{fish.census.total}</b> cá</> : 'Chưa có lượt đếm (cần người chơi online)',
      ]} />
    </div>
  );
}

function WorldCard({ title, lines, href, action }: { title: string; lines: ReactNode[]; href: string; action: string }) {
  return (
    <Card>
      <CardHead title={title} />
      <CardBody>
        <ul className={styles.list}>{lines.filter((l) => l !== null && l !== '').map((l, i) => <li key={i}>{l}</li>)}</ul>
        <a href={href}><Button variant="soft" small>{action}</Button></a>
      </CardBody>
    </Card>
  );
}
