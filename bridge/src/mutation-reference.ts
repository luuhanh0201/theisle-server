/**
 * Community reference for Evrima mutations, shown in the panel when no admin
 * has written their own note.
 *
 * Primary source: Evrima Quick Guide (SOURCES.quickGuide, page updated
 * 4/9/2026). `en` is its one-line description as written there (the original
 * English the panel shows next to our Vietnamese `description`); `unlockEn`
 * its "How to get". The three test-build mutations it does not list come
 * from theisle.info. Where sources disagree the entry says so
 * (`status: 'disputed'`) instead of picking one.
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

export const REFERENCE_CHECKED = '2026-09-26';

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
  /** Vietnamese, ours. */
  description: string;
  /** The source's own English description. */
  en: string;
  diet: Diet;
  femaleOnly?: boolean;
  groupLeaderOnly?: boolean;
  /** lifecycle = default pool; slot2 = only on slot 2 (and 4); unlock = quest-gated. */
  kind: 'lifecycle' | 'slot2' | 'unlock';
  /** For kind 'unlock': what the player has to do (Vietnamese). */
  unlock?: string;
  /** …and as the source says it. */
  unlockEn?: string;
  /** Which slot(s) an unlocked mutation can go in, when the sources say. */
  slots?: string;
  /**
   * Values per generation, as the source lists them: đời 1 (never entombed),
   * then after 1, 2, 3 entombments; beyond the list the last one holds.
   * One number for the whole dino, not per slot: it follows the dino's
   * ElderReplicationStacks (entombments), so 16 mutations given at once to a
   * dino with 0 stacks all stay at the first value.
   */
  tiers?: string;
  /** What `tiers` measures, in Vietnamese ("sát thương lên mục tiêu đang chảy máu"). */
  stat?: string;
  status: 'active' | 'removed' | 'test' | 'disputed';
  statusNote?: string;
  sources: (keyof typeof SOURCES)[];
}

const BOTH: (keyof typeof SOURCES)[] = ['theisleInfo', 'quickGuide'];

export const MUTATION_REFERENCE: MutationReference[] = [
  // --- lifecycle, every species -------------------------------------------
  { name: 'Cellular Regeneration', en: 'Recovers health slightly faster', description: 'Hồi máu nhanh hơn một chút.', diet: 'all', kind: 'lifecycle', stat: 'tốc độ hồi máu', tiers: '15% / 20% / 25% / 25%', status: 'active', sources: BOTH },
  { name: 'Congenital Hypoalgesia', en: 'Reduce incoming damage when fighting larger species', description: 'Giảm sát thương nhận vào khi đánh nhau với loài to hơn mình.', diet: 'all', kind: 'lifecycle', stat: 'giảm sát thương nhận từ loài to hơn', tiers: '15% / 20% / 25% / 25%', status: 'active', sources: BOTH },
  { name: 'Efficient Digestion', en: 'Your food drains more slowly', description: 'Thanh đói (thức ăn) tụt chậm hơn.', diet: 'all', kind: 'lifecycle', stat: 'thanh đói tụt chậm hơn', tiers: '20% / 25% / 30% / 30%', status: 'active', sources: BOTH },
  { name: 'Enlarged Meniscus', en: 'Fall damage hits stamina before draining health', description: 'Sát thương do ngã trừ vào stamina trước, hết stamina mới trừ vào máu.', diet: 'all', kind: 'lifecycle', status: 'active', sources: BOTH },
  { name: 'Epidermal Fibrosis', en: 'Increase bleed resistance', description: 'Tăng khả năng kháng chảy máu.', diet: 'all', kind: 'lifecycle', stat: 'kháng chảy máu', tiers: '15% / 20% / 25% / 25%', status: 'active', sources: BOTH },
  { name: 'Featherweight', en: 'Your footprints fade much faster', description: 'Dấu chân của bạn biến mất nhanh hơn nhiều.', diet: 'all', kind: 'lifecycle', stat: 'dấu chân mờ nhanh hơn', tiers: '50%', status: 'active', sources: BOTH },
  { name: 'Hydrodynamic', en: 'Increased swimming speed', description: 'Bơi nhanh hơn.', diet: 'all', kind: 'lifecycle', stat: 'tốc độ bơi', tiers: '15% / 20% / 25% / 25%', status: 'active', sources: BOTH },
  { name: 'Hydro-regenerative', aliases: ['Hydro Regenerative', 'HydroRegenerative'], en: 'Recover health faster during rainy weather', description: 'Hồi máu nhanh hơn khi trời mưa.', diet: 'all', kind: 'lifecycle', stat: 'tốc độ hồi máu khi mưa', tiers: '25% / 50% / 75% / 75%', status: 'active', sources: BOTH },
  { name: 'Increased Inspiratory Capacity', en: 'Increased O2 Capacity', description: 'Tăng dung tích oxy (lặn dưới nước được lâu hơn).', diet: 'all', kind: 'lifecycle', stat: 'dung tích oxy', tiers: '15% / 20% / 25% / 25%', status: 'active', sources: BOTH },
  { name: 'Infrasound Communication', en: 'Make significantly less noise when talking in chat', description: 'Phát ra ít tiếng ồn hơn hẳn khi nói chuyện trong chat.', diet: 'all', kind: 'lifecycle', stat: 'giảm tiếng ồn khi nói chuyện', tiers: '50% / 60% / 70% / 70%', status: 'active', sources: BOTH },
  { name: 'Nocturnal', en: 'Faster health/locked health recovery at night', description: 'Ban đêm hồi máu và máu bị khoá (locked health) nhanh hơn.', diet: 'all', kind: 'lifecycle', stat: 'tốc độ hồi máu ban đêm', tiers: '5% / 7% / 10% / 10%', status: 'active', sources: BOTH },
  { name: 'Osteosclerosis', en: 'Resist or Reduce fracture damage', description: 'Chống gãy xương, hoặc giảm sát thương gãy xương.', diet: 'all', kind: 'lifecycle', stat: 'giảm sát thương gãy xương', tiers: '20% / 25% / 30% / 30%', status: 'active', sources: BOTH },
  { name: 'Photosynthetic Tissue', aliases: ['PhotosyntheticTissueStatAdder'], en: 'Faster health/locked health recovery during the day', description: 'Ban ngày hồi máu và máu bị khoá (locked health) nhanh hơn.', diet: 'all', kind: 'lifecycle', stat: 'tốc độ hồi máu ban ngày', tiers: '5% / 7% / 10% / 10%', status: 'active', sources: ['theisleInfo', 'quickGuide', 'devKnowledge'] },
  { name: 'Reabsorption', en: 'Recover a small amount of water during the rainy weather or while swimming in drinkable water', description: 'Hồi một ít nước khi trời mưa hoặc khi đang bơi trong nước uống được.', diet: 'all', kind: 'lifecycle', stat: 'nước hồi khi mưa / bơi trong nước ngọt', tiers: '1 / 2 / 3 / 3', status: 'active', sources: BOTH },
  { name: 'Sequential Hermaphroditism', en: 'Changes your sex. Mutation not passed on to children.', description: 'Đổi giới tính của bạn. Mutation này không di truyền cho con.', diet: 'all', kind: 'lifecycle', status: 'active', sources: BOTH },
  { name: 'Submerged Optical Retention', en: 'Increased underwater vision range', description: 'Nhìn xa hơn khi ở dưới nước.', diet: 'all', kind: 'lifecycle', stat: 'tầm nhìn dưới nước', tiers: '5% / 10% / 20% / 20%', status: 'active', sources: BOTH },
  { name: 'Sustained Hydration', en: 'Your water drains more slowly', description: 'Thanh khát (nước) tụt chậm hơn.', diet: 'all', kind: 'lifecycle', stat: 'thanh khát tụt chậm hơn', tiers: '20% / 25% / 30% / 30%', status: 'active', sources: BOTH },
  { name: 'Wader', en: 'Less hindered when wading through shallow water', description: 'Ít bị cản hơn khi lội qua vùng nước nông.', diet: 'all', kind: 'lifecycle', stat: 'giảm cản khi lội nước nông', tiers: '25% / 50% / 75% / 75%', status: 'active', sources: BOTH },
  { name: 'Advanced Gestation', en: 'Faster egg gestation/incubation/cooldown rate', description: 'Mang trứng, ấp trứng và thời gian hồi (cooldown) nhanh hơn.', diet: 'all', femaleOnly: true, kind: 'lifecycle', stat: 'tốc độ mang trứng / ấp / hồi', tiers: '50% / 75% / 1 / 1', status: 'active', sources: BOTH },

  // --- lifecycle, herbivores -------------------------------------------------
  { name: 'Barometric Sensitivity', en: 'Receive an indication prior to storms or droughts', description: 'Được báo trước khi sắp có bão hoặc hạn hán.', diet: 'herbivore', kind: 'lifecycle', status: 'active', sources: BOTH },
  { name: 'Hypervigilance', en: 'Increases camera angles when eating and drinking. Increases footsteps audio from others', description: 'Góc camera rộng hơn khi đang ăn và uống. Nghe tiếng bước chân của con khác to hơn.', diet: 'herbivore', kind: 'lifecycle', stat: 'góc camera khi ăn uống, tiếng bước chân', tiers: '50% / 60% / 70% / 70%', status: 'active', sources: BOTH },
  { name: 'Photosynthetic Regeneration', en: 'Regenerate stamina faster during the day', description: 'Ban ngày hồi stamina nhanh hơn.', diet: 'herbivore', kind: 'lifecycle', stat: 'tốc độ hồi stamina ban ngày', tiers: '10%', status: 'active', sources: BOTH },
  { name: 'Social Behavior', en: 'Increased group size. Group Leader Only', description: 'Tăng giới hạn số thành viên trong nhóm. Chỉ có tác dụng với trưởng nhóm.', diet: 'herbivore_omnivore', groupLeaderOnly: true, kind: 'lifecycle', stat: 'hệ số số thành viên nhóm', tiers: '1.5 / 2 / 3 / 3', status: 'active', sources: BOTH },
  { name: 'Truculency', en: 'Bucking has a higher chance to dismount latched animals', description: 'Khi hất lưng (buck) có tỉ lệ cao hơn làm rơi con đang bám trên người.', diet: 'herbivore', kind: 'lifecycle', stat: 'tỉ lệ hất rơi con đang bám', tiers: '5% / 10% / 15% / 15%', status: 'active', sources: BOTH },
  { name: 'Xerocole Adaptation', en: 'Gain some water when eating plants', description: 'Nhận thêm một ít nước khi ăn cây.', diet: 'herbivore', kind: 'lifecycle', stat: 'nước nhận khi ăn cây', tiers: '15% / 20% / 25% / 25%', status: 'active', sources: BOTH },

  // --- lifecycle, carnivores -------------------------------------------------
  { name: 'Accelerated Prey Drive', en: 'Deal more damage to animals below 35% health', description: 'Gây thêm sát thương lên con vật còn dưới 35% máu.', diet: 'carnivore', kind: 'lifecycle', stat: 'sát thương lên con dưới 35% máu', tiers: '10% / 15% / 20% / 20%', status: 'active', sources: BOTH },
  { name: 'Hematophagy', en: 'Restore some thirst while eating corpses', description: 'Hồi một phần thanh khát khi ăn xác.', diet: 'carnivore', kind: 'lifecycle', stat: 'khát hồi khi ăn xác', tiers: '15% / 25% / 35% / 35%', status: 'active', sources: BOTH },
  { name: 'Hemomania', en: 'Do extra damage on bleeding target', description: 'Gây thêm sát thương lên mục tiêu đang chảy máu.', diet: 'carnivore', kind: 'lifecycle', stat: 'sát thương lên mục tiêu đang chảy máu', tiers: '5% / 7% / 10% / 10%', status: 'active', sources: BOTH },

  // --- slot 2 (and 4) only ---------------------------------------------------
  { name: 'Gastronomic Regeneration', en: 'Eating restores a small amount of health', description: 'Ăn hồi lại một ít máu.', diet: 'all', kind: 'slot2', stat: 'máu hồi khi ăn', tiers: '5% / 10% / 15% / 15%', status: 'active', sources: BOTH },
  { name: 'Tactile Endurance', en: 'Convert incoming damage to stamina', description: 'Chuyển sát thương nhận vào thành stamina.', diet: 'herbivore', kind: 'slot2', stat: 'sát thương chuyển thành stamina', tiers: '25% / 35% / 50% / 50%', status: 'active', sources: BOTH },
  { name: 'Cannibalistic', en: 'For species that are not, by default, cannibals. Adds their own species as a preferred prey for nutrients.', description: 'Dành cho loài vốn không ăn đồng loại: thêm chính loài mình vào danh sách con mồi ưa thích để lấy dinh dưỡng.', diet: 'carnivore', kind: 'slot2', status: 'active', sources: BOTH },
  { name: 'Hypermetabolic Inanition', en: 'The less hunger you have the more damage you deal.', description: 'Thanh đói càng thấp (càng đói) thì gây sát thương càng cao.', diet: 'carnivore', kind: 'slot2', stat: 'sát thương thêm khi đói', tiers: '15% / 20% / 25% / 25%', status: 'active', sources: BOTH },

  // --- unlocked by in-game tasks ---------------------------------------------
  { name: 'Augmented Tapetum', en: 'Increased vision at night', description: 'Nhìn rõ hơn vào ban đêm.', diet: 'carnivore', kind: 'unlock', unlock: 'Giết 5 người chơi vào ban đêm', unlockEn: 'Kill 5 Players at night. Unlocks on Slot 2.', slots: 'slot 2', stat: 'cấp nhìn đêm', tiers: '1 / 2 / 3', status: 'active', sources: BOTH },
  { name: 'Enhanced Digestion', en: 'Decrease nutrition decay rate', description: 'Các chỉ số dinh dưỡng giảm chậm hơn.', diet: 'all', kind: 'unlock', unlock: 'Duy trì dinh dưỡng trong 60 phút', unlockEn: 'Have nutrients for 60 minutes. Unlocks on Slot 2/3.', slots: 'slot 2 / 3', stat: 'dinh dưỡng giảm chậm hơn', tiers: '10% / 15% / 25% / 25%', status: 'active', sources: BOTH },
  { name: 'Heightened Ghrelin', en: 'Increased overeating capacity by a large amount.', description: 'Ăn quá no (overeat) được nhiều hơn hẳn.', diet: 'all', kind: 'unlock', unlock: 'Giữ thanh đói trên 80% trong 30 phút', unlockEn: 'Maintain current hunger above 80% for 30 minutes. Unlocks on Slot 2.', slots: 'slot 2', stat: 'sức chứa khi ăn quá no', tiers: '25% / 50% / 75% / 75%', status: 'active', sources: BOTH },
  { name: 'Multichambered Lungs', en: 'Increases stamina regeneration threshold', description: 'Tăng ngưỡng hồi stamina.', diet: 'all', kind: 'unlock', unlock: 'Tiêu 4.500 stamina bằng chạy nước rút hoặc bơi nhanh', unlockEn: 'Drain 4500 stamina by sprinting or fast swimming. Unlocks on Slot 2/3.', slots: 'slot 2 / 3', stat: 'ngưỡng hồi stamina', tiers: '5% / 10% / 15% / 15%', status: 'active', sources: BOTH },
  { name: 'Osteophagic', en: 'Able to consume bones to regenerate fractures faster', description: 'Ăn được xương để lành gãy xương nhanh hơn.', diet: 'carnivore', kind: 'unlock', unlock: 'Ăn xương trong lúc đang bị gãy xương', unlockEn: 'Unlock by eating bones while you have a broken bone.', status: 'active', sources: BOTH },
  { name: 'Parthenogenesis', en: 'Lets you nest without a mate. Mutation not passed onto children.', description: 'Làm tổ được mà không cần bạn đời. Mutation này không di truyền cho con.', diet: 'all', femaleOnly: true, kind: 'unlock', unlockEn: 'Unlocks on slot 2', slots: 'slot 2', status: 'active', sources: BOTH },
  { name: 'Prolific Reproduction', en: 'Your babies have increased health and stamina regen. Your babies require less food and they grow faster.', description: 'Con non của bạn hồi máu và stamina nhanh hơn, cần ít thức ăn hơn và lớn nhanh hơn.', diet: 'all', femaleOnly: true, kind: 'unlock', unlockEn: 'Unlocks on slot 2', slots: 'slot 2', status: 'active', sources: BOTH },
  { name: 'Reinforced Tendons', en: 'Jumping costs less stamina. Reduces take off stamina for Ptera', description: 'Nhảy tốn ít stamina hơn; với Pteranodon thì cất cánh tốn ít stamina hơn.', diet: 'all', kind: 'unlock', unlock: 'Nhảy 50 lần', unlockEn: 'Unlock by Jumping 50 times.', stat: 'giảm stamina khi nhảy / cất cánh', tiers: '25% / 35% / 50% / 50%', status: 'active', sources: ['theisleInfo', 'quickGuide', 'devKnowledge'] },
  { name: 'Reniculate Kidneys', aliases: ['Reniculate Kidney'], en: 'Can drink saltwater. Thirst Pool: 1000. Thirst intake value while drinking saltwater: -2.5%', description: 'Uống được nước mặn. Thanh khát 1.000; lượng nước nhận được khi uống nước mặn: −2,5%.', diet: 'all', kind: 'unlock', unlock: 'Mất 1.250 thanh khát vì uống nước mặn (mất 50 sẽ bị debuff "Fluid Deficient", đủ 1.200 thì hết debuff)', unlockEn: 'Lose 1250 thirst by drinking saltwater. 50 thirst grants the "Fluid Deficient" debuff and 1200 thirst removes it. Unlocks on Slot 2/3.', slots: 'slot 2 / 3', status: 'active', sources: ['theisleInfo', 'quickGuide', 'devKnowledge'] },

  // --- test build only / removed ---------------------------------------------
  { name: 'Pit Organ', en: 'Can see sources of IR (infrared) light.', description: 'Nhìn thấy các nguồn phát ánh sáng hồng ngoại (IR).', diet: 'all', kind: 'lifecycle', status: 'test', statusNote: 'Chỉ có trên bản thử nghiệm (Horde test); Evrima Quick Guide không liệt kê.', sources: ['theisleInfo'] },
  { name: 'Paratrepsis', en: 'Able to fake fractures.', description: 'Giả vờ bị gãy xương được.', diet: 'all', kind: 'lifecycle', status: 'test', statusNote: 'Chỉ có trên bản thử nghiệm (Horde test); Evrima Quick Guide không liệt kê.', sources: ['theisleInfo'] },
  { name: 'Cochlear Sensitivity', en: 'Indication of sound traps from a distance.', description: 'Nhận biết bẫy âm thanh từ xa.', diet: 'all', kind: 'lifecycle', status: 'test', statusNote: 'Chỉ có trên bản thử nghiệm (Horde test); Evrima Quick Guide không liệt kê.', sources: ['theisleInfo'] },
  { name: 'Intraspecific Aggression', en: 'Deal more damage to animals of your own species', description: 'Gây thêm sát thương lên con cùng loài.', diet: 'all', kind: 'lifecycle', status: 'removed', statusNote: 'Đã bị gỡ ở v0.15.116.', sources: BOTH },
  { name: 'Traumatic Thrombosis', en: 'Prevent death from blood loss if resting', description: 'Không chết vì mất máu khi đang nằm nghỉ.', diet: 'all', kind: 'slot2', status: 'removed', statusNote: 'Đã bị gỡ ở v0.21.720 (Evrima Quick Guide, cập nhật 4/9/2026).', sources: ['theisleInfo', 'quickGuide', 'devKnowledge'] },
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
