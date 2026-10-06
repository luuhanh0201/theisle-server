import { useEffect } from 'react';
import { PageHead, SubTabs } from '@isle/ui';
import { ModsPage } from '../pages/mods/ModsPage';
import { LegacyPage } from './LegacyPage';
import { SUBS, TABS, subAllowed, tabAllowed, type TabId } from './nav';
import { hrefOf, pickSub, useHashRoute } from './router';
import { useSession } from './session';

/**
 * The page for the address. A block moved to React gets its page; the others a link to the panel
 * before React, with their sub-pages listed, so every address of the old panel works here too.
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
  if (tab === 'mods' && sub !== null) return <ModsPage sub={sub} />;
  return <NotMoved tab={tab} sub={sub} />;
}

function NotMoved({ tab, sub }: { tab: TabId; sub: string | null }) {
  const { access } = useSession();
  const label = TABS.find(([id]) => id === tab)?.[1] ?? tab;
  const subs = (SUBS[tab] ?? []).filter(([id]) => subAllowed(access, tab, id));
  const subLabel = subs.find(([id]) => id === sub)?.[1];
  return (
    <div>
      <PageHead title={label} />
      {subs.length > 0 && sub !== null && (
        <SubTabs label={`Mục của ${label}`} active={sub} tabs={subs.map(([id, l]) => ({ id, label: l, href: hrefOf(tab, id) }))} />
      )}
      <LegacyPage title={subLabel ? `${label} · ${subLabel}` : label} hash={hrefOf(tab, sub)} />
    </div>
  );
}
