/** "45%" of a growth (0–1), "0%" when unknown (app.js pct). */
export const pct = (g: number | null | undefined): string => (typeof g === 'number' ? `${Math.round(g * 100)}%` : '0%');

/** A bar's width for a growth: 0–100 %. */
export const growthWidth = (g: number | null | undefined): string => `${Math.min(100, Math.max(0, (g ?? 0) * 100))}%`;

/**
 * The growth stage beside a growth %: the marks where the game opens the mutation slots (25 / 50 / 75 %,
 * measured on this server) and the full grown. The launcher's overlay has the same table.
 */
const GROWTH_STAGES: ReadonlyArray<readonly [number, string, string]> = [[1, '🦖', 'Trưởng thành'], [0.75, '🦕', 'Cận lớn'], [0.5, '🦎', 'Thiếu niên'], [0.25, '🐣', 'Con non'], [0, '🥚', 'Sơ sinh']];
export function growthStage(g: number | null | undefined): { icon: string; name: string } {
  const v = typeof g === 'number' ? g : 0;
  const [, icon, name] = GROWTH_STAGES.find(([min]) => v + 1e-6 >= min) ?? GROWTH_STAGES[GROWTH_STAGES.length - 1] as readonly [number, string, string];
  return { icon, name };
}

/** The five tiers of a dino: F0 (not prime) … F4 (prime đời 4), with their card classes. */
export interface DinoTier { level: number; key: 'fossil' | 'amber' | 'dna' | 'rex' | 'apex'; className: string }
export const DINO_TIERS: Record<DinoTier['key'], DinoTier> = {
  fossil: { level: 0, key: 'fossil', className: 'tier-fossil' },
  amber: { level: 1, key: 'amber', className: 'tier-amber prime' },
  dna: { level: 2, key: 'dna', className: 'tier-dna' },
  rex: { level: 3, key: 'rex', className: 'tier-rex' },
  apex: { level: 4, key: 'apex', className: 'tier-apex' },
};
export const TIER_NAME = ['Cơ bản', 'Prime', 'Prime đời 2', 'Prime đời 3', 'Prime đời 4'];

/** The tier of the dino played now (its prime board's elder stacks, or prime). */
export function heroTier(dino: { prime?: unknown; elderStacks?: number | null; generation?: number } | null | undefined): DinoTier {
  if (!dino) return DINO_TIERS.fossil;
  const prime = dino.prime as { elderStacks?: unknown; prime?: unknown } | boolean | null | undefined;
  const pe = typeof prime === 'object' && prime !== null ? prime.elderStacks : undefined;
  const stacks = typeof pe === 'number' ? pe
    : typeof dino.elderStacks === 'number' ? dino.elderStacks
      : typeof dino.generation === 'number' ? Math.max(0, dino.generation - 1) : 0;
  if (stacks >= 3) return DINO_TIERS.apex;
  if (stacks === 2) return DINO_TIERS.rex;
  if (stacks === 1) return DINO_TIERS.dna;
  const isPrime = (typeof prime === 'object' && prime !== null && prime.prime === true) || prime === true;
  return isPrime ? DINO_TIERS.amber : DINO_TIERS.fossil;
}

/** The card's tier classes, as app.js puts them (amber: just tier-amber; any prime: + prime). */
export const tierClasses = (t: DinoTier): string => `${t.key === 'amber' ? 'tier-amber' : t.className}${t.level > 0 ? ' prime' : ''}`;

/** A slot's tier: the bridge's own when it says one, else from its elder stacks and prime (app.js getDinoTier). */
export function slotTier(g: { tier?: string | number; elderStacks?: number | null; generation?: number; prime?: boolean }): DinoTier {
  if (g.tier === 'apex' || g.tier === 4) return DINO_TIERS.apex;
  if (g.tier === 'rex' || g.tier === 3) return DINO_TIERS.rex;
  if (g.tier === 'dna' || g.tier === 2) return DINO_TIERS.dna;
  if (g.tier === 'amber' || g.tier === 1) return DINO_TIERS.amber;
  if (g.tier === 'fossil' || g.tier === 0) return DINO_TIERS.fossil;
  const stacks = typeof g.elderStacks === 'number' ? g.elderStacks : typeof g.generation === 'number' ? Math.max(0, g.generation - 1) : 0;
  if (stacks >= 3) return DINO_TIERS.apex;
  if (stacks === 2) return DINO_TIERS.rex;
  if (stacks === 1) return DINO_TIERS.dna;
  return g.prime ? DINO_TIERS.amber : DINO_TIERS.fossil;
}

/** "6/10/2026, 14:05:09" (vi-VN, 24 h), a unix time; '' without one (app.js when). */
export const when = (t: number | null | undefined): string => (t ? new Date(t * 1000).toLocaleString('vi-VN', { hour12: false }) : '');
