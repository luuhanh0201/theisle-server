import { Button } from '@isle/ui';
import { useSession } from '../session';
import styles from './MeCard.module.css';

/** Who is logged in (a Steam login; none through the SSH tunnel), and the way out. */
export function MeCard() {
  const { me } = useSession();
  if (!me?.steamId) return null;
  const logout = async (): Promise<void> => {
    await fetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
    location.href = '/login';
  };
  return (
    <div className={styles.card}>
      <div className={styles.who}><b>{me.name ?? 'Admin'}</b><span className={styles.sub}>{me.steamId}{me.ip ? ` · ${me.ip}` : ' · SSH tunnel'}</span></div>
      <Button variant="ghost" small onClick={() => void logout()}>Đăng xuất</Button>
    </div>
  );
}
