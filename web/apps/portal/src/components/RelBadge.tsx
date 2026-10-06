import { REL_BADGE } from '../lib/releases';

/** The mark beside a feature (Đang phát triển / Ưu tiên / NEW), nothing without one. */
export function RelBadge({ b, nav = false }: { b: string | undefined; nav?: boolean }) {
  const r = b ? REL_BADGE[b] : undefined;
  if (!r) return null;
  return <span className={`${nav ? 'nav-rel ' : ''}rel-badge rel-${b}`} title={r[1]}>{r[0]}</span>;
}
