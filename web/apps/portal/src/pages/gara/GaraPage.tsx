import { Commands } from '../../features/gara/Commands';
import { Garage } from '../../features/gara/Garage';
import { launcherUi } from '../../lib/launcher';
import { useMe } from '../../lib/queries';

/**
 * Gara (#gara): the chat commands, the player's garage (store / redeem from the web). The launcher's look has the
 * garage only, no chat commands (owner, 2026-10-07).
 */
export function GaraPage() {
  const me = useMe();
  return (
    <>
      {!launcherUi() && <Commands />}
      <Garage me={me} />
    </>
  );
}
