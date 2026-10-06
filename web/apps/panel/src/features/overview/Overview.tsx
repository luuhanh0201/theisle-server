import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getJson, type PlayerRow } from '@isle/api';
import { Card, CardBody, CardHead, Icon, PageHead, type IconName } from '@isle/ui';
import { can } from '../../app/nav';
import { useSession } from '../../app/session';
import { Feed } from '../../components/feed/Feed';
import type { FeedEvent } from '../../components/feed/describe';
import { num } from '../../lib/format';
import { ago } from '../../lib/time';
import { PHASE_VN } from '../server/ops/labels';
import { Perf } from './Perf';
import s from './Overview.module.css';

export const FILTERS: ReadonlyArray<readonly [string, string | null]> = [
  ['Tất cả', null], ['Chiến đấu', 'damage,death'], ['Chết', 'death'],
  ['Ra / vào', 'session_start,session_end,spawn'], ['Growth', 'growth,growth_set,mutation'],
  ['Gara', 'garage_store,garage_redeem'], ['Chat', 'chat'],
];
const QUICK: ReadonlyArray<readonly [string, string]> = [
  ['#server/status', 'Khởi động lại / tắt (có đếm ngược)'], ['#server/rcon', 'Thông báo toàn server'],
  ['#map', 'Vùng AI · thả AI · làm mới AI'], ['#world/flora', 'Thực vật'], ['#world/fish', 'Cá'],
  ['#garage/stored', 'Tạo dino vào gara'], ['#mods/messages', 'Sửa thông báo'], ['#admin/audit', 'Nhật ký admin'],
];
interface Status { phase?: string; operation?: { kind: string; step: string } | null; schedule?: { next?: number | null } | null }
interface Health { lastEventAt: number | null; online: number }
export type Alert = { tone: 'critical' | 'warning'; text: string; href: string; act: string };

/** What needs the admin's eye now: the server not running, an operation going on, a restart soon, the mod silent. */
export function alertsOf(st: Status, health: Health, nowS = Date.now() / 1000): Alert[] {
  const out: Alert[] = [];
  if (st.phase && st.phase !== 'running') out.push({ tone: st.phase === 'failed' || st.phase === 'stopped' ? 'critical' : 'warning', text: `Server: ${PHASE_VN[st.phase] ?? st.phase}.`, href: '#server/status', act: 'Mở Server' });
  if (st.operation) out.push({ tone: 'warning', text: `Đang ${st.operation.kind === 'stop' ? 'tắt' : 'khởi động lại'} server (${st.operation.step}).`, href: '#server/status', act: 'Xem' });
  else if (st.schedule?.next && st.schedule.next - nowS < 1800) {
    out.push({ tone: 'warning', text: `Khởi động lại định kỳ lúc ${new Date(st.schedule.next * 1000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}.`, href: '#server/schedule', act: 'Lịch' });
  }
  if (health.lastEventAt && nowS - health.lastEventAt > 600 && st.phase === 'running' && health.online > 0) {
    out.push({ tone: 'warning', text: `Mod chưa ghi sự kiện nào từ ${ago(health.lastEventAt)}, mod có thể lỗi.`, href: '#server/status', act: 'Kiểm tra' });
  }
  return out;
}

/** Tổng quan: KPIs, alerts, the server's performance, the game's log, shortcuts. Refreshed every 2 s. */
export function Overview() {
  const { access } = useSession();
  const server = can(access, 'server.view');
  const players = useQuery({ queryKey: ['/api/players'], queryFn: () => getJson<{ players: PlayerRow[] }>('/api/players'), refetchInterval: 2000 }).data?.players ?? [];
  const [filter, setFilter] = useState<string | null>(null);
  const feedUrl = `/api/feed?limit=150${filter ? `&type=${encodeURIComponent(filter)}` : ''}`;
  const feed = useQuery({ queryKey: [feedUrl], queryFn: () => getJson<{ events: FeedEvent[] }>(feedUrl), refetchInterval: 2000 }).data?.events;
  const st = useQuery({ queryKey: ['/api/server/status'], queryFn: () => getJson<Status>('/api/server/status'), refetchInterval: 10_000, enabled: server }).data;
  const health = useQuery({ queryKey: ['/api/health'], queryFn: () => getJson<Health>('/api/health'), refetchInterval: 10_000, enabled: server }).data;
  const alerts = st && health ? alertsOf(st, health) : [];
  const online = players.filter((p) => p.online).length;
  const sum = (k: keyof PlayerRow): number => players.reduce((a, p) => a + (Number(p[k]) || 0), 0);
  const kpi = (ic: IconName, tone: string, v: React.ReactNode, k: string) => (
    <Card className={s.kpi}><span className={`${s.ico} ${s[tone]}`}><Icon name={ic} /></span><div><div className={s.v}>{v}</div><div className={s.k}>{k}</div></div></Card>
  );
  return (
    <div>
      <PageHead title="Tổng quan" sub="Tình trạng server, hiệu năng và mọi diễn biến, cập nhật mỗi 2 giây." />
      <div className={s.kpis}>
        {kpi('players', 'tone-accent', <>{online}<span className={s.of}> / {players.length}</span></>, 'Đang online / đã thấy')}
        {kpi('death', 'tone-kill', num(sum('kills')), 'Kill được quy người')}
        {kpi('damage', 'tone-dmg', num(sum('damageDealt')), 'Damage PvP')}
        {kpi('chat', 'tone-chat', num(sum('chats' as keyof PlayerRow)), 'Tin chat')}
        {kpi('garage', 'tone-gar', num(sum('stored' as keyof PlayerRow)), 'Lượt cất gara')}
      </div>
      {alerts.length > 0 && (
        <div className={s.alerts}>
          {alerts.map((a) => (
            <div key={a.text} className={`${s.banner} ${a.tone === 'critical' ? s['tone-dmg'] : s['tone-gar']}`}><Icon name="warn" /><span>{a.text}</span><a className={s.soft} href={a.href}>{a.act}</a></div>
          ))}
        </div>
      )}
      {server && <Perf />}
      <div className={s.split}>
        <Card>
          <CardHead title="Diễn biến" />
          <CardBody>
            <div className={s.chips}>
              {FILTERS.map(([label, types]) => <button key={label} type="button" className={types === filter ? s.on : undefined} aria-pressed={types === filter} onClick={() => setFilter(types)}>{label}</button>)}
            </div>
            <Feed events={feed ?? []} empty={feed === undefined ? 'Đang tải…' : 'Chưa có sự kiện'} />
          </CardBody>
        </Card>
        <Card>
          <CardHead title="Thao tác nhanh" />
          <CardBody><div className={s.quick}>{QUICK.map(([href, label]) => <a key={href} className={s.soft} href={href}>{label}</a>)}</div></CardBody>
        </Card>
      </div>
    </div>
  );
}
