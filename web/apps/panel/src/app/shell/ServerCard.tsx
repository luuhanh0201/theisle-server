import { useQuery } from '@tanstack/react-query';
import { getJson, type Health, type ServerStatus } from '@isle/api';
import { serverState } from './serverState';
import styles from './ServerCard.module.css';

/** Is the game up, how many online, how fresh: every 2 s (the service's phase every 10 s). */
export function ServerCard() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => getJson<Health>('/api/health'), refetchInterval: 2000 });
  const status = useQuery({ queryKey: ['server-status'], queryFn: () => getJson<ServerStatus>('/api/server/status'), refetchInterval: 10_000 });
  const [dot, title, sub] = serverState(health.isError ? null : health.data ?? null, status.data?.phase ?? null);
  return (
    <div className={styles.card}>
      <div className={styles.row}><span className={`${styles.pulse}${dot ? ` ${styles[dot]}` : ''}`} /><span className={styles.title}>{health.isPending ? 'Đang kết nối…' : title}</span></div>
      <div className={styles.sub}>{health.isPending ? ' ' : sub}</div>
    </div>
  );
}
