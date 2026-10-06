import { Friends } from '../../features/map/Friends';
import { MapCard } from '../../features/map/MapCard';
import { useMe } from '../../lib/queries';

/** Bản đồ (#map): your dino on the map, the AI, the zones, where players are; Kết bạn. */
export function MapPage() {
  const me = useMe();
  return (
    <>
      <MapCard me={me} />
      <Friends me={me} />
    </>
  );
}
