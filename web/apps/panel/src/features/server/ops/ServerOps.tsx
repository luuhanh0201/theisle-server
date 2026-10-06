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

/** Server → Vận hành: status and power, readiness, restart schedule, growth events, DDoS warning, RCON (one under the other). */
export function ServerOps() {
  const status = useQuery({ queryKey: [STATUS_URL], queryFn: () => getJson<ServerStatusFull>(STATUS_URL), refetchInterval: 2000 });
  const ready = useQuery({ queryKey: ['/api/server/readiness'], queryFn: () => getJson<Readiness>('/api/server/readiness'), refetchInterval: 2000 });
  const st = status.data;
  if (status.error && !st) return <Hint>Không tải được trạng thái server: {(status.error as Error).message}</Hint>;
  if (!st) return <Hint>Đang tải…</Hint>;
  return (
    <div className={s.stack}>
      <PowerCard status={st} />
      <ReadinessCard r={ready.data} />
      <ScheduleCard status={st} />
      <GrowthEventsCard />
      <DdosCard />
      <RconCard rconEnabled={st.rconEnabled} />
    </div>
  );
}
