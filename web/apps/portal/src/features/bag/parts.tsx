import type { ReactNode } from 'react';
import { mutSlug, type BagGroup } from './bag';

export type Status = { kind: '' | 'ok' | 'bad'; node: ReactNode } | null;

/** A mutation's icon (filled by mut-icons.js, one request for all). */
export const MutIcon = ({ name, cls = '' }: { name: unknown; cls?: string }) => <img className={`mut-ico ${cls}`} data-mut-icon={mutSlug(name)} alt="" />;

/** The tickets (items.ts): what each card says. */
export const BAG_TICKET: Record<string, { icon: string; action?: string; desc: (g: BagGroup) => ReactNode }> = {
  mutation_ticket: { icon: '🎟️', desc: (g) => <>Đổi ra một mutation tự chọn (đúng chế độ ăn của loài{g.maxRarity === 'special' ? <>, <b>cả mutation nhiệm vụ</b></> : ''}) vào một ô đã mở.</> },
  mutation_clear: { icon: '🧹', desc: () => 'Bỏ mutation ở một ô để chọn lại trong game.' },
  prime_ticket: { icon: '👑', desc: () => 'Dino 100% chưa prime: dùng là lên prime (đủ 10 điều kiện).' },
  dino_box: { icon: '🎁', action: 'Mở hộp', desc: (g) => <>{g.pick === 'random' ? <>Mở ra <b>1 dino ngẫu nhiên</b></> : <>Mở hộp: <b>tự chọn loài</b></>}, tăng trưởng ngẫu nhiên {Math.round((g.growthMin ?? 0.5) * 100)}–{Math.round((g.growthMax ?? 1) * 100)}%. Mở ra vật phẩm Dino trong túi, dùng nó để chọn giới tính và mutation.</> },
  dino: { icon: '🦖', action: 'Dùng', desc: () => <>Dùng để chọn <b>giới tính</b> và <b>mutation</b> (ô mở theo tăng trưởng: ô 1 từ 25%, ô 2 từ 50%, ô 3–4 từ 75%). Dino vào <b>gara</b> với <b>đủ 10 nhiệm vụ prime</b>.</> },
  growth_bag: { icon: '🌱', desc: (g) => <>Dino đang chơi <b>+{Math.round((g.amount ?? 0.1) * 100)}% tăng trưởng</b>, {(g.below ?? 0.6) >= 1 ? 'dùng cho mọi dino chưa 100%' : `chỉ dùng khi dino dưới ${Math.round((g.below ?? 0.6) * 100)}%`}.</> },
  loot_box: { icon: '🏺', action: 'Mở hòm', desc: (g) => <>Mở ra <b>1 vật phẩm ngẫu nhiên</b>{g.prizes ? ` trong ${g.prizes} món` : ''}. Món càng hiếm càng khó trúng.</> },
  // Written like the game's own item text (owner, 2026-10-05).
  salt_lick: { icon: '🧂', desc: () => <>Một khối khoáng mặn hiếm thấy trên đảo. Liếm vài lần, dạ dày dịu lại ngay: <b>hết trạng thái ốm sau khi nôn</b>. Dùng khi dino đang ốm sau khi nôn.</> },
  food_box: { icon: '🍖', desc: (g) => <>Dino đang chơi <b>+{Math.round((g.amount ?? 0.2) * 100)}% thức ăn</b> (chống đói, không tăng chất dinh dưỡng).</> },
};

