import type { BlockPages } from '../../app/Block';
import { FishSettings } from '../../features/world/fish/FishSettings';
import { FloraSettings } from '../../features/world/flora/FloraSettings';

/** Thế giới: Thực vật and Cá in React; Tổng quan (a live page) not yet. */
export const WORLD_PAGES: BlockPages = { flora: FloraSettings, fish: FishSettings };
