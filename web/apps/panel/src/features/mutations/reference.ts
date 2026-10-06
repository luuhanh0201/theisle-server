import type { CatalogSpecies, MutationRef, MutationsData } from '@isle/api';

/** "MUT_Cellular_Regeneration" and "cellular regeneration" are the same mutation. */
export const normMut = (n: string): string => String(n).replace(/^MUT_/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const mutSlug = (n: string): string => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The reference entry for an in-game name: the bridge's match, else the exact name or an alias. */
export function refFor(data: MutationsData | null | undefined, name: string): MutationRef | null {
  if (!data) return null;
  const matched = data.matches[name];
  if (matched) return data.reference.find((r) => r.name === matched) ?? null;
  return data.reference.find((r) => [r.name, ...(r.aliases ?? [])].some((n) => normMut(n) === normMut(name))) ?? null;
}

export const DIET_VN: Record<string, string> = { all: 'Mọi loài', carnivore: 'Chỉ ăn thịt', herbivore: 'Chỉ ăn cỏ', herbivore_omnivore: 'Ăn cỏ / ăn tạp' };
export const STATUS_VN: Record<string, string> = {
  removed: '⚠ Theo wiki: đã bị gỡ khỏi game',
  test: '⚠ Theo wiki: chỉ có trên bản thử nghiệm',
  disputed: '⚠ Các nguồn không thống nhất',
};
/** A short warning when the reference flags the mutation ('' when it does not). */
export const refAlert = (r: MutationRef | null): string => (r && r.status !== 'active' ? STATUS_VN[r.status] ?? '' : '');

// One level for the whole dino: đời 1 (never entombed), then +1 per entombment (ElderReplicationStacks);
// past the source's list the last value holds.
export const GEN_LABEL = ['Đời 1', 'Đời 2', 'Đời 3', 'Đời 4+'];
export const tierList = (r: MutationRef): string[] => (r.tiers ? r.tiers.split('/').map((v) => v.trim()) : []);
export const genIndex = (r: MutationRef, stacks: number): number => Math.min(Math.max(0, stacks), tierList(r).length - 1);

/** Where a mutation has been seen: on this species (in which slots), else on which other species. */
export function evidenceOf(catalog: CatalogSpecies[], species: string | null, name: string) {
  const entry = species ? catalog.find((c) => c.species === species) ?? null : null;
  const ev = entry?.evidence?.[name] ?? null;
  const elsewhere = catalog.filter((c) => c.species !== species && c.evidence?.[name]).map((c) => c.species);
  return { ev, elsewhere };
}
