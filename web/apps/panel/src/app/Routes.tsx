import { useEffect } from 'react';
import { Block } from './Block';
import { BLOCKS } from './blocks';
import { TABS, tabAllowed, type TabId } from './nav';
import { hrefOf, pickSub, useHashRoute } from './router';
import { useSession } from './session';

/**
 * The page for the address. A page moved to React is shown; the others are a link to the panel
 * before React, inside the same block frame, so every address of the old panel works here too.
 */
export function Routes() {
  const { access } = useSession();
  const route = useHashRoute();
  const tab: TabId = tabAllowed(access, route.tab) ? route.tab : TABS.find(([id]) => tabAllowed(access, id))?.[0] ?? 'overview';
  const sub = pickSub(access, tab, route.sub);
  // The address says where the panel is (a bookmark, the back button): the sub-page picked goes into it.
  useEffect(() => {
    const want = hrefOf(tab, sub);
    if (location.hash !== want) history.replaceState(null, '', want);
  }, [tab, sub]);
  return <Block tab={tab} sub={sub} pages={BLOCKS[tab] ?? {}} />;
}
