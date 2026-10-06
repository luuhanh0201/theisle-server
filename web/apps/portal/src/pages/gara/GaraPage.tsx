import { Commands } from '../../features/gara/Commands';
import { Garage } from '../../features/gara/Garage';
import { useMe } from '../../lib/queries';

/** Gara (#gara): the chat commands, the player's garage (store / redeem from the web). */
export function GaraPage() {
  const me = useMe();
  return (
    <>
      <Commands />
      <Garage me={me} />
    </>
  );
}
