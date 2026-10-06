import { BlockPage } from '../../app/BlockPage';
import { DinoCreator } from '../../features/garage/creator/DinoCreator';
import { GarageList } from '../../features/garage/list/GarageList';
import { GarageSettings } from '../../features/garage/settings/GarageSettings';

/** Gara → Dino & tạo dino: the stored slots, and the creator under them. */
function Stored() {
  return <><GarageList /><DinoCreator /></>;
}

/** Gara: the players' stored dinos, dinos made into a garage, and the garage's rules. */
export function GaragePage({ sub }: { sub: string }) {
  return <BlockPage tab="garage" sub={sub} title="Gara"
    intro="Quản lý dino người chơi đang cất, tạo dino vào gara theo yêu cầu và cấu hình quy tắc hệ thống Gara."
    pages={{ stored: Stored, settings: GarageSettings }} />;
}
