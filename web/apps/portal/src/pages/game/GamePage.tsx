import { DinoHero } from '../../features/game/DinoHero';
import { PrimeCard } from '../../features/game/PrimeCard';
import { Stats } from '../../features/game/Stats';
import { Tele } from '../../features/game/Tele';
import { useMe } from '../../lib/queries';

/** Dino Live (#game): the dino played now, tele con non, its prime tasks, the player's counts. */
export function GamePage() {
  const me = useMe();
  return (
    <>
      <DinoHero me={me} />
      <Tele me={me} />
      <PrimeCard me={me} />
      <Stats me={me} />
    </>
  );
}
