import { useMe } from '../../lib/queries';
import { Features, Rules } from '../../features/home/Guide';
import { LauncherHub } from '../../features/home/LauncherHub';
import { LauncherPromo } from '../../features/home/LauncherPromo';
import { Rewards } from '../../features/home/Rewards';
import { ServerStatus } from '../../features/home/ServerStatus';

/** Trang chủ (#home): the rewards, the launcher's hub, the server, the launcher promo (web), the guide. */
export function HomePage() {
  const me = useMe();
  return (
    <>
      <Rewards me={me} />
      <LauncherHub me={me} />
      <ServerStatus />
      <LauncherPromo />
      <Features />
      <Rules />
    </>
  );
}
