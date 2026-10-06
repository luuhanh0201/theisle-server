import { BlockPage } from '../../app/BlockPage';
import { MutationItems } from '../../features/items/mutations/MutationItems';
import { Skins } from '../../features/items/skins/Skins';
import { Tickets } from '../../features/items/tickets/Tickets';

/** Vật phẩm: the server's items, made, named and given by admins (skins, mutations, tickets and boxes). */
export function ItemsPage({ sub }: { sub: string }) {
  return <BlockPage tab="items" sub={sub} title="Vật phẩm"
    intro={<>Vật phẩm của server: admin tạo, đặt tên, tặng vào kho của người chơi. Hiện có <b>Skin dino</b>, <b>Mutation</b> và <b>Phiếu &amp; hộp</b> (đổi / bỏ mutation, Prime, hộp dino, túi tăng trưởng, hộp food), người chơi dùng từ Túi đồ; sau này thêm quay hòm, cửa hàng.</>}
    pages={{ skins: Skins, mutations: MutationItems, tickets: Tickets }} />;
}
