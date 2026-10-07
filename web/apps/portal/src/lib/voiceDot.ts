import { useSyncExternalStore } from 'react';

/**
 * The dot beside Voice in the menu (voice.js renderNav before React): green = working, amber =
 * needs you, red = dropped; null = none. Set by the voice page, read by the menu.
 */
export interface VoiceDot { kind: 'ok' | 'warn' | 'bad'; text: string }
let dot: VoiceDot | null = null;
const subs = new Set<() => void>();
export function setVoiceDot(d: VoiceDot | null): void {
  if (d?.kind === dot?.kind && d?.text === dot?.text) return;
  dot = d;
  for (const s of subs) s();
}
export const useVoiceDot = (): VoiceDot | null =>
  useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => dot, () => dot);
