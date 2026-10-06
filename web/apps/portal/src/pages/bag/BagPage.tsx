import { Bag } from '../../features/bag/Bag';
import { useMe } from '../../lib/queries';

/** Túi đồ (#bag): the account's items, used on the dino played now or into the garage. */
export function BagPage() {
  const me = useMe();
  return <Bag me={me} />;
}
