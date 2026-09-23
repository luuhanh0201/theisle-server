/**
 * Community reference for Evrima mutations, shown in the panel when no admin
 * has written their own note.
 *
 * Compiled from two independent community guides that agree on almost every
 * entry (see SOURCES). Descriptions are our own Vietnamese wording, not quotes.
 * Where the sources disagree the entry says so (`status: 'disputed'`) instead
 * of picking one.
 *
 * `name` is the display name. The in-game FName is the display name for the
 * mutations documented so far ("Reniculate Kidneys", "Reinforced Tendons");
 * known exceptions go in `aliases`. Matching is by normalised name, see
 * normaliseMutationName().
 *
 * `tiers` are the values per entombment tier as the sources list them
 * (strength grows with each entombment).
 *
 * Re-check against the sources after a major game update; update
 * REFERENCE_CHECKED when you do.
 */

export const REFERENCE_CHECKED = '2026-09-23';

export const SOURCES = {
  theisleInfo: 'https://www.theisle.info/guide/mutations',
  quickGuide: 'https://www.evrimaquickguide.com/gameplay/health-statuses/mutations',
  devKnowledge:
    'https://github.com/diplomatic-tendencies/evrima-dev-knowledge/blob/main/EVRIMA_QuestMutation_Fix.md',
} as const;

export type Diet = 'all' | 'carnivore' | 'herbivore' | 'herbivore_omnivore';

export interface MutationReference {
  name: string;
  /** Other FNames seen for the same mutation. */
  aliases?: string[];
  description: string;
  diet: Diet;
  femaleOnly?: boolean;
  groupLeaderOnly?: boolean;
  /** lifecycle = default pool; slot2 = only on slot 2 (and 4); unlock = quest-gated. */
  kind: 'lifecycle' | 'slot2' | 'unlock';
  /** For kind 'unlock': what the player has to do. */
  unlock?: string;
  /** Which slot(s) an unlocked mutation can go in, when the sources say. */
  slots?: string;
  tiers?: string;
  status: 'active' | 'removed' | 'test' | 'disputed';
  statusNote?: string;
  sources: (keyof typeof SOURCES)[];
}

const BOTH: (keyof typeof SOURCES)[] = ['theisleInfo', 'quickGuide'];

export const MUTATION_REFERENCE: MutationReference[] = [
  // --- lifecycle, every species -------------------------------------------
  { name: 'Cellular Regeneration', description: 'Hồi máu nhanh hơn.', diet: 'all', kind: 'lifecycle', tiers: '15% / 20% / 25% / 25%', status: 'active', sources: BOTH },
  { name: 'Congenital Hypoalgesia', description: 'Giảm sát thương nhận vào khi đánh nhau với loài to hơn mình.', diet: 'all', kind: 'lifecycle', tiers: '15% / 20% / 25% / 25%', status: 'active', sources: BOTH },
  { name: 'Efficient Digestion', description: 'Thanh đói tụt chậm hơn.', diet: 'all', kind: 'lifecycle', tiers: '20% / 25% / 30% / 30%', status: 'active', sources: BOTH },
  { name: 'Enlarged Meniscus', description: 'Sát thương do ngã trừ vào stamina trước, hết stamina mới trừ vào máu.', diet: 'all', kind: 'lifecycle', status: 'active', sources: BOTH },
  { name: 'Epidermal Fibrosis', description: 'Tăng khả năng kháng chảy máu.', diet: 'all', kind: 'lifecycle', tiers: '15% / 20% / 25% / 25%', status: 'active', sources: BOTH },
  { name: 'Featherweight', description: 'Dấu chân để lại biến mất nhanh hơn nhiều, khó bị lần theo.', diet: 'all', kind: 'lifecycle', tiers: '50%', status: 'active', sources: BOTH },
  { name: 'Hydrodynamic', description: 'Bơi nhanh hơn.', diet: 'all', kind: 'lifecycle', tiers: '15% / 20% / 25% / 25%', status: 'active', sources: BOTH },
  { name: 'Hydro-regenerative', aliases: ['Hydro Regenerative', 'HydroRegenerative'], description: 'Hồi máu nhanh hơn khi trời mưa.', diet: 'all', kind: 'lifecycle', tiers: '25% / 50% / 75% / 75%', status: 'active', sources: BOTH },
  { name: 'Increased Inspiratory Capacity', description: 'Tăng dung tích oxy — lặn dưới nước được lâu hơn.', diet: 'all', kind: 'lifecycle', tiers: '15% / 20% / 25% / 25%', status: 'active', sources: BOTH },
  { name: 'Infrasound Communication', description: 'Phát ra ít tiếng động hơn hẳn khi giao tiếp bằng tiếng kêu trong game, khó bị nghe thấy.', diet: 'all', kind: 'lifecycle', tiers: '50% / 60% / 70% / 70%', status: 'active', sources: BOTH },
  { name: 'Nocturnal', description: 'Ban đêm hồi máu và máu bị khoá (locked health) nhanh hơn.', diet: 'all', kind: 'lifecycle', tiers: '5% / 7% / 10% / 10%', status: 'active', sources: BOTH },
  { name: 'Osteosclerosis', description: 'Chống gãy xương, hoặc giảm sát thương khi bị gãy.', diet: 'all', kind: 'lifecycle', tiers: '20% / 25% / 30% / 30%', status: 'active', sources: BOTH },
  { name: 'Photosynthetic Tissue', aliases: ['PhotosyntheticTissueStatAdder'], description: 'Ban ngày hồi máu và máu bị khoá (locked health) nhanh hơn.', diet: 'all', kind: 'lifecycle', tiers: '5% / 7% / 10% / 10%', status: 'active', sources: ['theisleInfo', 'quickGuide', 'devKnowledge'] },
  { name: 'Reabsorption', description: 'Hồi một ít nước khi trời mưa hoặc khi đang bơi trong nước uống được.', diet: 'all', kind: 'lifecycle', tiers: '1 / 2 / 3 / 3', status: 'active', sources: BOTH },
  { name: 'Sequential Hermaphroditism', description: 'Đổi giới tính của dino. Mutation này không di truyền cho con.', diet: 'all', kind: 'lifecycle', status: 'active', sources: BOTH },
  { name: 'Submerged Optical Retention', description: 'Nhìn xa hơn khi ở dưới nước.', diet: 'all', kind: 'lifecycle', tiers: '5% / 10% / 20% / 20%', status: 'active', sources: BOTH },
  { name: 'Sustained Hydration', description: 'Thanh khát tụt chậm hơn.', diet: 'all', kind: 'lifecycle', tiers: '20% / 25% / 30% / 30%', status: 'active', sources: BOTH },
  { name: 'Wader', description: 'Ít bị chậm lại hơn khi lội qua vùng nước nông.', diet: 'all', kind: 'lifecycle', tiers: '25% / 50% / 75% / 75%', status: 'active', sources: BOTH },
  { name: 'Advanced Gestation', description: 'Mang trứng, ấp trứng và thời gian hồi làm tổ nhanh hơn.', diet: 'all', femaleOnly: true, kind: 'lifecycle', tiers: '50% / 75% / 1 / 1', status: 'active', sources: BOTH },

  // --- lifecycle, herbivores -------------------------------------------------
  { name: 'Barometric Sensitivity', description: 'Được báo trước khi sắp có bão hoặc hạn hán.', diet: 'herbivore', kind: 'lifecycle', status: 'active', sources: BOTH },
  { name: 'Hypervigilance', description: 'Góc nhìn camera rộng hơn khi đang ăn/uống, và nghe tiếng bước chân của con khác rõ hơn.', diet: 'herbivore', kind: 'lifecycle', tiers: '50% / 60% / 70% / 70%', status: 'active', sources: BOTH },
  { name: 'Photosynthetic Regeneration', description: 'Ban ngày hồi stamina nhanh hơn.', diet: 'herbivore', kind: 'lifecycle', tiers: '10%', status: 'active', sources: BOTH },
  { name: 'Social Behavior', description: 'Tăng giới hạn số thành viên trong nhóm. Chỉ có tác dụng với trưởng nhóm.', diet: 'herbivore_omnivore', groupLeaderOnly: true, kind: 'lifecycle', tiers: '1.5 / 2 / 3 / 3', status: 'active', sources: BOTH },
  { name: 'Truculency', description: 'Khi hất lưng (buck) có tỉ lệ cao hơn làm rơi con đang bám trên người.', diet: 'herbivore', kind: 'lifecycle', tiers: '5% / 10% / 15% / 15%', status: 'active', sources: BOTH },
  { name: 'Xerocole Adaptation', description: 'Nhận thêm một ít nước khi ăn cây.', diet: 'herbivore', kind: 'lifecycle', tiers: '15% / 20% / 25% / 25%', status: 'active', sources: BOTH },

  // --- lifecycle, carnivores -------------------------------------------------
  { name: 'Accelerated Prey Drive', description: 'Gây thêm sát thương lên con vật còn dưới 35% máu.', diet: 'carnivore', kind: 'lifecycle', tiers: '10% / 15% / 20% / 20%', status: 'active', sources: BOTH },
  { name: 'Hematophagy', description: 'Hồi một phần thanh khát khi ăn xác.', diet: 'carnivore', kind: 'lifecycle', tiers: '15% / 25% / 35% / 35%', status: 'active', sources: BOTH },
  { name: 'Hemomania', description: 'Gây thêm sát thương lên mục tiêu đang chảy máu.', diet: 'carnivore', kind: 'lifecycle', tiers: '5% / 7% / 10% / 10%', status: 'active', sources: BOTH },

  // --- slot 2 (and 4) only ---------------------------------------------------
  { name: 'Gastronomic Regeneration', description: 'Mỗi lần ăn hồi lại một ít máu.', diet: 'all', kind: 'slot2', tiers: '5% / 10% / 15% / 15%', status: 'active', sources: BOTH },
  { name: 'Tactile Endurance', description: 'Chuyển một phần sát thương nhận vào thành stamina.', diet: 'herbivore', kind: 'slot2', tiers: '25% / 35% / 50% / 50%', status: 'active', sources: BOTH },
  { name: 'Cannibalistic', description: 'Dành cho loài vốn không ăn đồng loại: thêm chính loài mình vào danh sách con mồi ưa thích để lấy dinh dưỡng.', diet: 'carnivore', kind: 'slot2', status: 'active', sources: BOTH },
  { name: 'Hypermetabolic Inanition', description: 'Thanh no càng thấp (càng đói) thì gây sát thương càng cao.', diet: 'carnivore', kind: 'slot2', tiers: '15% / 20% / 25% / 25%', status: 'active', sources: BOTH },
  {
    name: 'Traumatic Thrombosis',
    description: 'Không chết vì mất máu khi đang nằm nghỉ.',
    diet: 'all', kind: 'slot2', status: 'disputed',
    statusNote: 'evrimaquickguide (cập nhật 9/2026) ghi đã bị gỡ ở v0.21.720; theisle.info (5/2026) vẫn liệt kê. Kiểm tra trên server trước khi dùng.',
    sources: ['theisleInfo', 'quickGuide', 'devKnowledge'],
  },

  // --- unlocked by in-game tasks ---------------------------------------------
  { name: 'Augmented Tapetum', description: 'Nhìn rõ hơn vào ban đêm.', diet: 'carnivore', kind: 'unlock', unlock: 'Giết 5 người chơi vào ban đêm', slots: 'slot 2', tiers: '1 / 2 / 3', status: 'active', sources: BOTH },
  { name: 'Enhanced Digestion', description: 'Các chỉ số dinh dưỡng giảm chậm hơn.', diet: 'all', kind: 'unlock', unlock: 'Duy trì dinh dưỡng trong 60 phút', slots: 'slot 2 / 3', tiers: '10% / 15% / 25% / 25%', status: 'active', sources: BOTH },
  { name: 'Heightened Ghrelin', description: 'Ăn quá no (overeat) được nhiều hơn hẳn.', diet: 'all', kind: 'unlock', unlock: 'Giữ thanh đói trên 80% trong 30 phút', slots: 'slot 2', tiers: '25% / 50% / 75% / 75%', status: 'active', sources: BOTH },
  { name: 'Multichambered Lungs', description: 'Tăng ngưỡng hồi stamina.', diet: 'all', kind: 'unlock', unlock: 'Tiêu 4.500 stamina bằng chạy nước rút hoặc bơi nhanh', slots: 'slot 2 / 3', tiers: '5% / 10% / 15% / 15%', status: 'active', sources: BOTH },
  { name: 'Osteophagic', description: 'Ăn được xương để lành gãy xương nhanh hơn.', diet: 'carnivore', kind: 'unlock', unlock: 'Ăn xương trong lúc đang bị gãy xương', status: 'active', sources: BOTH },
  { name: 'Parthenogenesis', description: 'Làm tổ được mà không cần bạn đời. Không di truyền cho con.', diet: 'all', femaleOnly: true, kind: 'unlock', slots: 'slot 2', status: 'active', sources: BOTH },
  { name: 'Prolific Reproduction', description: 'Con non hồi máu và stamina nhanh hơn, cần ít thức ăn hơn và lớn nhanh hơn.', diet: 'all', femaleOnly: true, kind: 'unlock', slots: 'slot 2', status: 'active', sources: BOTH },
  { name: 'Reinforced Tendons', description: 'Nhảy tốn ít stamina hơn; với Pteranodon thì cất cánh tốn ít stamina hơn.', diet: 'all', kind: 'unlock', unlock: 'Nhảy 50 lần', tiers: '25% / 35% / 50% / 50%', status: 'active', sources: ['theisleInfo', 'quickGuide', 'devKnowledge'] },
  { name: 'Reniculate Kidneys', aliases: ['Reniculate Kidney'], description: 'Uống được nước mặn. Theo nguồn: thanh khát 1.000, lượng nước nhận khi uống nước mặn −2,5%.', diet: 'all', kind: 'unlock', unlock: 'Mất 1.250 thanh khát vì uống nước mặn', slots: 'slot 2 / 3', status: 'active', sources: ['theisleInfo', 'quickGuide', 'devKnowledge'] },

  // --- test build only / removed ---------------------------------------------
  { name: 'Pit Organ', description: 'Nhìn thấy các nguồn phát hồng ngoại (IR).', diet: 'all', kind: 'lifecycle', status: 'test', statusNote: 'Chỉ có trên bản thử nghiệm (Horde test).', sources: ['theisleInfo'] },
  { name: 'Paratrepsis', description: 'Giả vờ bị gãy xương.', diet: 'all', kind: 'lifecycle', status: 'test', statusNote: 'Chỉ có trên bản thử nghiệm (Horde test).', sources: ['theisleInfo'] },
  { name: 'Cochlear Sensitivity', description: 'Nhận biết bẫy âm thanh từ xa.', diet: 'all', kind: 'lifecycle', status: 'test', statusNote: 'Chỉ có trên bản thử nghiệm (Horde test).', sources: ['theisleInfo'] },
  { name: 'Intraspecific Aggression', description: 'Gây thêm sát thương lên con cùng loài.', diet: 'all', kind: 'lifecycle', status: 'removed', statusNote: 'Đã bị gỡ ở v0.15.116.', sources: BOTH },
];

/**
 * The reference entry for an in-game FName, or null.
 *
 * Exact match on the normalised name or an alias first. Failing that, the
 * longest reference name the FName STARTS with, which catches suffixed
 * internal names like "PhotosyntheticTissueStatAdder" — but never matches a
 * shorter name inside a longer one the other way round.
 */
export function findReference(fname: string): MutationReference | null {
  const key = normaliseMutationName(fname);
  if (key === '') return null;
  let best: MutationReference | null = null;
  let bestLen = 0;
  for (const ref of MUTATION_REFERENCE) {
    for (const n of [ref.name, ...(ref.aliases ?? [])]) {
      const k = normaliseMutationName(n);
      if (k === key) return ref;
      if (key.startsWith(k) && k.length > bestLen && k.length >= 6) {
        best = ref;
        bestLen = k.length;
      }
    }
  }
  return best;
}

/**
 * "Reniculate Kidneys", "reniculate_kidneys", "MUT_ReniculateKidneys" -> "reniculatekidneys".
 * Case, spaces, underscores, hyphens and a MUT_ prefix are all noise.
 */
export function normaliseMutationName(name: string): string {
  return name.replace(/^MUT_/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
