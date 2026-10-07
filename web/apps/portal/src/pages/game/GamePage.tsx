import { DinoHero } from '../../features/game/DinoHero';
import { PrimeCard } from '../../features/game/PrimeCard';
import { Stats } from '../../features/game/Stats';
import { Tele } from '../../features/game/Tele';
import { launcherUi } from '../../lib/launcher';
import { useMe } from '../../lib/queries';

/**
 * Dino Live (#game): the dino played now, tele con non, its prime tasks, the player's counts. In the launcher's look
 * (Live Monitor, owner 2026-10-07) tele and prime share a row, two columns; the counts come last.
 */
export function GamePage() {
  const me = useMe();
  if (launcherUi()) {
    return (
      <>
        <DinoHero me={me} />
        <div className="lx-cols-2"><Tele me={me} /><PrimeCard me={me} /></div>
        <Stats me={me} />
      </>
    );
  }
  return (
    <>
      <DinoHero me={me} />
      <Tele me={me} />
      <PrimeCard me={me} />
      <Stats me={me} />
    </>
  );
}
