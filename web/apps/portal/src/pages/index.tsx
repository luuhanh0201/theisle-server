import type { ReactNode } from 'react';
import type { Tab } from '../app/router';
import { BagPage } from './bag/BagPage';
import { GamePage } from './game/GamePage';
import { GaraPage } from './gara/GaraPage';
import { HomePage } from './home/HomePage';
import { MapPage } from './map/MapPage';
import { OverlayPage } from './overlay/OverlayPage';
import { RankingPage } from './ranking/RankingPage';
import { ShopPage } from './shop/ShopPage';
import { SkinPage } from './skin/SkinPage';
import { VoicePage } from './voice/VoicePage';

/** Every page of the site (the site before React is gone since 2026-10-07, git tag old-sites-20261007). */
const PAGES: Record<Tab, () => ReactNode> = {
  home: () => <HomePage />,
  game: () => <GamePage />,
  gara: () => <GaraPage />,
  ranking: () => <RankingPage />,
  map: () => <MapPage />,
  skin: () => <SkinPage />,
  voice: () => <VoicePage />,
  bag: () => <BagPage />,
  shop: () => <ShopPage />,
  overlay: () => <OverlayPage />,
};

export function Page({ tab }: { tab: Tab }) {
  return <>{PAGES[tab]()}</>;
}
