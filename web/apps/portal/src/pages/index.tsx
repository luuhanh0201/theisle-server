import type { ReactNode } from 'react';
import type { Tab } from '../app/router';
import { GamePage } from './game/GamePage';
import { GaraPage } from './gara/GaraPage';
import { HomePage } from './home/HomePage';
import { LegacyPage } from './LegacyPage';

/** Each page's title (the menu's), for the pages not moved yet. */
export const TITLES: Record<Tab, string> = {
  home: 'Trang chủ', game: 'Dino Live Monitor', gara: 'Gara Khủng Long', map: 'Bản đồ Gateway', ranking: 'Bảng Xếp Hạng',
  skin: 'Skin Studio', bag: 'Túi đồ', shop: 'Cửa hàng', voice: 'Voice 3D', overlay: 'Game Overlay HUD',
};

/** The pages moved to React so far (PORTAL-MIGRATION.md); the rest link to the site before React. */
const MOVED: Partial<Record<Tab, () => ReactNode>> = {
  home: () => <HomePage />,
  game: () => <GamePage />,
  gara: () => <GaraPage />,
};

export function Page({ tab }: { tab: Tab }) {
  const moved = MOVED[tab];
  return moved ? <>{moved()}</> : <LegacyPage tab={tab} title={TITLES[tab]} />;
}
