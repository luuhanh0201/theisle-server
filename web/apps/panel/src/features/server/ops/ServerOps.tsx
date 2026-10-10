import type { JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getJson, type Readiness, type ServerStatusFull } from '@isle/api';
import { Hint } from '@isle/ui';
import { DdosCard } from './DdosCard';
import { GrowthEventsCard } from './GrowthEventsCard';
import { PowerCard, STATUS_URL } from './PowerCard';
import { RconCard } from './RconCard';
import { ReadinessCard } from './ReadinessCard';
import { ScheduleCard } from './ScheduleCard';
import s from './Ops.module.css';

/** The server's status (every 2 s) for a page that needs it: the page once it is here. */
function WithStatus({ page }: { page: (st: ServerStatusFull) => JSX.Element }) {
  const status = useQuery({ queryKey: [STATUS_URL], queryFn: () => getJson<ServerStatusFull>(STATUS_URL), refetchInterval: 2000 });
  const st = status.data;
  if (status.error && !st) return <Hint>Không tải được trạng thái server: {(status.error as Error).message}</Hint>;
  if (!st) return <Hint>Đang tải…</Hint>;
  return <div className={s.stack}>{page(st)}</div>;
}

/**
 * Server's sub-pages, one feature each (owner, 2026-10-10: not one long page): Vận hành (status, power,
 * readiness), Lịch & sự kiện (restart schedule, growth events), DDoS (the warning), RCON.
 */
export function ServerOps() {
  const ready = useQuery({ queryKey: ['/api/server/readiness'], queryFn: () => getJson<Readiness>('/api/server/readiness'), refetchInterval: 2000 });
  return <WithStatus page={(st) => <><PowerCard status={st} /><ReadinessCard r={ready.data} /></>} />;
}
export function ServerSchedule() {
  return <WithStatus page={(st) => <><ScheduleCard status={st} /><GrowthEventsCard /></>} />;
}
export function ServerDdos() {
  return <div className={s.stack}><DdosCard /></div>;
}
export function ServerRcon() {
  return <WithStatus page={(st) => <RconCard rconEnabled={st.rconEnabled} />} />;
}
