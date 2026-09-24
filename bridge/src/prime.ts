/**
 * The ten prime-elder conditions (pawn.EligiblePrimeElderData.bPrimeCondition1..10).
 *
 * The game names them only by number. Meanings below come from community
 * guides (theisle.info "Prime & Prime Elder", Afterthought's elder-system
 * guide), which disagree on count and order — so each is marked verified:
 * false until a flip is observed in play (StatsLogger sends a "prime" event
 * whenever a condition changes). The order here is the one that fits the live
 * reading of 2026-09-24: a fresh Tyrannosaurus with conditions 3, 8, 9 met —
 * perfect diet (all three nutrients present) and the two "never" conditions,
 * which start met — and 10 (small species) not met.
 */
export interface PrimeCondition { n: number; label: string; passive: boolean; verified: boolean }

export const PRIME_CONDITIONS: PrimeCondition[] = [
  { n: 1, label: 'Vào Sanctuary khi còn juvenile', passive: false, verified: false },
  { n: 2, label: 'Được nở từ tổ của người chơi khác (nested in)', passive: false, verified: false },
  { n: 3, label: 'Chế độ ăn hoàn hảo (≥1% cả ba chất cùng lúc)', passive: false, verified: false },
  { n: 4, label: 'Vào vùng Mass Migration', passive: false, verified: false },
  { n: 5, label: 'Đi qua 2 vùng di cư khác nhau', passive: false, verified: false },
  { n: 6, label: 'Đi qua 4 vùng tuần tra khác nhau', passive: false, verified: false },
  { n: 7, label: 'Nuôi con từ tổ lên subadult', passive: false, verified: false },
  { n: 8, label: 'Không bao giờ bị vô sinh', passive: true, verified: false },
  { n: 9, label: 'Không bao giờ bị co giật cơ', passive: true, verified: false },
  { n: 10, label: 'Là loài nhỏ (Hypsi / Troodon / Beipi / Dryo…)', passive: true, verified: false },
];

/** Guides agree on this: prime is decided by 75 % growth. */
export const PRIME_DEADLINE = 0.75;

export interface PrimeBoard {
  isPrime: boolean | null;
  /** The game's own verdict (GetIsEligiblePrimeElder). */
  eligible: boolean | null;
  elder: boolean | null;
  met: number;
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
    conditions,
    growth,
    deadline: PRIME_DEADLINE,
    locked: typeof growth === 'number' && growth >= PRIME_DEADLINE,
  };
}
