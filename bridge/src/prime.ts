/**
 * The ten prime-elder conditions (pawn.EligiblePrimeElderData.bPrimeCondition1..10).
 *
 * The game names them only by number. Labels checked against this server's
 * own readings (StatsLogger "prime" events, 2026-09-26/27, ~170 readings,
 * set against where each dino stood on the map when a condition turned on):
 *   1 on inside a Sanctuary, young · 3 on anywhere (diet) · 5 on for several
 *   players in the same second (a Mass Migration starting) · 7, 8 on from the
 *   start (7 lost after a long starvation) · 10 on from the start for a few
 *   species · 2, 4 never seen on · 6 and 9 seen too rarely to be sure.
 * `verified: false` = the label is the community guides' guess.
 */
export interface PrimeCondition { n: number; label: string; passive: boolean; verified: boolean }

export const PRIME_CONDITIONS: PrimeCondition[] = [
  { n: 1, label: 'Vào Sanctuary khi còn nhỏ', passive: false, verified: true },
  { n: 2, label: 'Chưa rõ — chưa từng thấy đạt trên server (theo hướng dẫn: nở từ tổ của người chơi khác)', passive: false, verified: false },
  { n: 3, label: 'Ăn đủ cả ba chất (carb, protein, lipid)', passive: false, verified: true },
  { n: 4, label: 'Chưa rõ — chưa từng thấy đạt trên server (theo hướng dẫn: đi qua 2 vùng di cư khác nhau)', passive: false, verified: false },
  { n: 5, label: 'Có mặt trong vùng Mass Migration khi đợt di cư đang diễn ra', passive: false, verified: true },
  { n: 6, label: 'Vùng tuần tra (Patrol Zone) — đã có người đạt, quy tắc chính xác chưa rõ', passive: false, verified: false },
  { n: 7, label: 'Chưa từng bị vô sinh — có sẵn, mất nếu để dino thiếu chất lâu', passive: true, verified: true },
  { n: 8, label: 'Chưa từng bị co giật cơ — có sẵn', passive: true, verified: true },
  { n: 9, label: 'Chưa rõ — mới thấy ở Deinosuchus trưởng thành (theo hướng dẫn: nuôi con từ tổ lên subadult)', passive: false, verified: false },
  { n: 10, label: 'Loài được tặng sẵn (Beipiaosaurus, Deinosuchus…)', passive: true, verified: true },
];

/** How many conditions make a dino eligible: every reading with 5+ was, every one with 4 or fewer was not. */
export const PRIME_NEEDED = 5;

/** Guides agree on this: prime is decided by 75 % growth. */
export const PRIME_DEADLINE = 0.75;

export interface PrimeBoard {
  isPrime: boolean | null;
  /** The game's own verdict (GetIsEligiblePrimeElder). */
  eligible: boolean | null;
  elder: boolean | null;
  met: number;
  /** Conditions needed to be eligible (PRIME_NEEDED). */
  needed: number;
  conditions: Array<PrimeCondition & { met: boolean | null }>;
  growth: number | null;
  deadline: number;
  /** Past the deadline, nothing can change any more. */
  locked: boolean;
}

export function primeBoard(
  p: { elder: boolean | null; prime: boolean | null; eligible: boolean | null; conditions: Record<string, boolean> | null } | null,
  growth: number | null,
): PrimeBoard | null {
  if (p === null) return null;
  const conditions = PRIME_CONDITIONS.map((c) => {
    const v = p.conditions?.[String(c.n)];
    return { ...c, met: typeof v === 'boolean' ? v : null };
  });
  return {
    isPrime: p.prime,
    eligible: p.eligible,
    elder: p.elder,
    met: conditions.filter((c) => c.met === true).length,
    needed: PRIME_NEEDED,
    conditions,
    growth,
    deadline: PRIME_DEADLINE,
    locked: typeof growth === 'number' && growth >= PRIME_DEADLINE,
  };
}
