import { Icon } from '@isle/ui';
import { TABS, tabAllowed } from '../nav';
import { hrefOf, useHashRoute, usePlayerId } from '../router';
import { useSession } from '../session';
import { useTheme } from '../theme';
import { MeCard } from './MeCard';
import { ServerCard } from './ServerCard';
import styles from './Sidebar.module.css';

export function Sidebar() {
  const { access } = useSession();
  const route = useHashRoute();
  // A player's page lights Người chơi (as the panel before React).
  const tab = usePlayerId() === null ? route.tab : 'players';
  const [theme, toggleTheme] = useTheme();
  return (
    <aside className={styles.aside}>
      <div className={styles.brand}>
        <img className={styles.logo} src="/img/logo-96.webp" width={40} height={40} alt="Logo server" />
        <div className={styles.brandText}><b>Isle Panel</b><span>Evrima server admin</span></div>
      </div>
      <nav className={styles.nav} aria-label="Các trang của panel">
        {TABS.filter(([id]) => tabAllowed(access, id)).map(([id, label]) => (
          <a key={id} href={hrefOf(id)} className={id === tab ? styles.active : undefined} aria-current={id === tab ? 'page' : undefined}>
            <Icon name={id} /><span className={styles.label}>{label}</span>
          </a>
        ))}
      </nav>
      <div className={styles.foot}>
        <ServerCard />
        <MeCard />
        <button type="button" className={styles.theme} onClick={toggleTheme}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          <span>{theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'}</span>
        </button>
        <a className={styles.legacy} href="/">Về panel cũ</a>
      </div>
    </aside>
  );
}
