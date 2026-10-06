import { useSyncExternalStore } from 'react';

/**
 * Unsaved settings, by page, kept while the admin moves between pages (as the panel before React
 * did): a page's draft comes back when it is opened again, and the unsaved bar names the others.
 */
interface Draft { label: string; href: string; value: unknown; save: () => void }
const drafts = new Map<string, Draft>();
const listeners = new Set<() => void>();
let version = 0;
const emit = (): void => { version++; for (const l of listeners) l(); };

export function setDraft(key: string, d: Draft | null): void {
  if (d === null) { if (drafts.delete(key)) emit(); return; }
  drafts.set(key, d);
  emit();
}
export const getDraft = (key: string): unknown => drafts.get(key)?.value;

/** Every page with unsaved changes, redrawn when one changes. */
export function useDrafts(): ReadonlyArray<[string, Draft]> {
  useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => version);
  return [...drafts.entries()];
}

/** For tests: forget every draft. */
export function clearDrafts(): void { drafts.clear(); emit(); }
