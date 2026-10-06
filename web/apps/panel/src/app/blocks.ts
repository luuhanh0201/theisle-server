import type { BlockPages } from './Block';
import type { TabId } from './nav';
import { MODS_PAGES } from '../pages/mods';
import { WORLD_PAGES } from '../pages/world';

/**
 * The pages moved to React, by block (pages/<tab>/index.ts). A block or sub-page not listed is a
 * link to the panel before React. Progress and next steps: web/MIGRATION.md.
 */
export const BLOCKS: Partial<Record<TabId, BlockPages>> = {
  mods: MODS_PAGES,
  world: WORLD_PAGES,
};
