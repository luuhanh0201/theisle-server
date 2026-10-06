import { useEffect } from 'react';
import { PageHead, SubTabs } from '@isle/ui';
import { ModsPage } from '../pages/mods/ModsPage';
import { WorldPage } from '../pages/world/WorldPage';
import { GaragePage } from '../pages/garage/GaragePage';
import { MembersPage } from '../pages/members/MembersPage';
import { AdminPage } from '../pages/admin/AdminPage';
import { ServerPage } from '../pages/server/ServerPage';
import { PlayersPage } from '../pages/players/PlayersPage';
import { prefillCreator } from '../features/garage/creator/DinoCreator';
import { LegacyPage } from './LegacyPage';
import { SUBS, TABS, subAllowed, tabAllowed, type TabId } from './nav';
import { hrefOf, pickSub, useHashRoute } from './router';
import { useSession } from './session';

/**
 * The page for the address. A page moved to React is shown; the others are a link to the panel
 * before React, inside the same block frame, so every address of the old panel works here too.
 */
export function Routes() {
  const { access } = useSession();
  const route = useHashRoute();
  // #garage/<SteamID> (a player's page, "tạo dino cho người này"): the creator filled in for them.
  if (route.tab === 'garage' && route.sub !== null && /^\d{17}$/.test(route.sub)) prefillCreator(route.sub);
  const tab: TabId = tabAllowed(access, route.tab) ? route.tab : TABS.find(([id]) => tabAllowed(access, id))?.[0] ?? 'overview';
  const sub = pickSub(access, tab, route.sub);
  // The address says where the panel is (a bookmark, the back button): the sub-page picked goes into it.
  // Not while /api/me is pending: who may see what is not known yet (a deep link must not be lost).
  const known = access.perms !== null;
  useEffect(() => {
    const want = hrefOf(tab, sub);
    if (known && location.hash !== want) history.replaceState(null, '', want);
  }, [tab, sub, known]);
  if (tab === 'mods' && sub !== null) return <ModsPage sub={sub} />;
  if (tab === 'world' && sub !== null) return <WorldPage sub={sub} />;
  if (tab === 'garage' && sub !== null) return <GaragePage sub={sub} />;
  if (tab === 'members' && sub !== null) return <MembersPage sub={sub} />;
  if (tab === 'admin' && sub !== null) return <AdminPage sub={sub} />;
  if (tab === 'server' && sub !== null) return <ServerPage sub={sub} />;
  if (tab === 'players' && sub !== null) return <PlayersPage sub={sub} />;
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
