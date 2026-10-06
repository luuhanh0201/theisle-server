import { BlockPage } from '../../app/BlockPage';
import { FishSettings } from '../../features/world/fish/FishSettings';
import { FloraSettings } from '../../features/world/flora/FloraSettings';
import { WorldOverview } from '../../features/world/overview/WorldOverview';

/** Thế giới: what the island is like (AI, migration, day and night, plants, fish) and where to change it. */
export function WorldPage({ sub }: { sub: string }) {
  return <BlockPage tab="world" sub={sub} title="Thế giới" intro="AI, di cư, ngày đêm, thực vật và cá trên đảo, tóm tắt, và nơi chỉnh từng thứ."
    pages={{ overview: WorldOverview, flora: FloraSettings, fish: FishSettings }} />;
}
