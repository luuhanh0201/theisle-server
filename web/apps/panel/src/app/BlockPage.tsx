import type { JSX } from 'react';
import { PageHead, SubTabs } from '@isle/ui';
import { useDrafts } from '../features/settings-form/drafts';
import { LegacyPage } from './LegacyPage';
import { SUBS, subAllowed, type TabId } from './nav';
import { hrefOf } from './router';
import { useSession } from './session';

/**
 * A block with sub-pages: its title, the sub-page row (a dot on one with unsaved changes), and the
 * sub-page shown. A sub-page not in `pages` yet: a link to the panel before React.
 */
export function BlockPage({ tab, sub, title, intro, pages }:
  { tab: TabId; sub: string; title: string; intro: string; pages: Record<string, () => JSX.Element> }) {
  const { access } = useSession();
  const drafts = useDrafts();
  const subs = (SUBS[tab] ?? []).filter(([id]) => subAllowed(access, tab, id));
  const Page = pages[sub];
  const label = subs.find(([id]) => id === sub)?.[1] ?? sub;
  return (
    <div>
      <PageHead title={title} sub={intro} />
      <SubTabs label={`Mục của ${title}`} active={sub}
        tabs={subs.map(([id, l]) => ({ id, label: l, href: hrefOf(tab, id), dot: drafts.some(([, d]) => d.href === hrefOf(tab, id)) }))} />
      {Page ? <Page /> : <LegacyPage title={`${title} · ${label}`} hash={hrefOf(tab, sub)} />}
    </div>
  );
}
