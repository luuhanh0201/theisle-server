import { useQuery } from '@tanstack/react-query';
import { getJson, type CatalogSpecies, type MutationsData } from '@isle/api';

/** The mutation reference and notes (/api/mutations) and the species catalog (/api/catalog), shared by every page. */
export function useMutationData() {
  const ref = useQuery({ queryKey: ['/api/mutations'], queryFn: () => getJson<MutationsData>('/api/mutations'), staleTime: 30_000 });
  const cat = useQuery({ queryKey: ['/api/catalog'], queryFn: () => getJson<{ species: CatalogSpecies[] }>('/api/catalog'), staleTime: 30_000 });
  return { data: ref.data ?? null, catalog: cat.data?.species ?? [], refetch: () => { void ref.refetch(); void cat.refetch(); } };
}
