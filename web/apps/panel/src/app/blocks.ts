import type { BlockPages } from './Block';
import type { TabId } from './nav';
import { ADMIN_PAGES } from '../pages/admin';
import { GARAGE_PAGES } from '../pages/garage';
import { MODS_PAGES } from '../pages/mods';
import { WORLD_PAGES } from '../pages/world';

/**
 * The pages moved to React, by block (pages/<tab>/index.ts). A block or sub-page not listed is a
 * link to the panel before React. Progress and next steps: web/MIGRATION.md.
 */
export const BLOCKS: Partial<Record<TabId, BlockPages>> = {
  admin: ADMIN_PAGES,
  garage: GARAGE_PAGES,
  mods: MODS_PAGES,
  world: WORLD_PAGES,
};
