import type { JSX, ReactNode } from 'react';
import { PageHead, SubTabs } from '@isle/ui';
import { useDrafts } from '../features/settings-form/drafts';
import { MissingPage } from './MissingPage';
import { SUBS, subAllowed, type TabId } from './nav';
import { hrefOf } from './router';
import { useSession } from './session';

/**
 * A block with sub-pages: its title, the sub-page row (a dot on one with unsaved changes), and the
 * sub-page shown. A sub-page not in `pages` yet: a link to the panel before React.
 */
export function BlockPage({ tab, sub, title, intro, pages }:
  { tab: TabId; sub: string; title: string; intro: ReactNode; pages: Record<string, () => JSX.Element> }) {
  const { access } = useSession();
  const drafts = useDrafts();
  const subs = (SUBS[tab] ?? []).filter(([id]) => subAllowed(access, tab, id));
  // "cfg:spawn" is the sub-page "cfg" (its page reads the rest from the address).
  const id = sub.split(':')[0] ?? sub;
  const Page = pages[id];
  const label = subs.find(([x]) => x === id)?.[1] ?? id;
  return (
    <div>
      <PageHead title={title} sub={intro} />
      <SubTabs label={`Mục của ${title}`} active={id}
        tabs={subs.map(([id, l]) => ({ id, label: l, href: hrefOf(tab, id), dot: drafts.some(([, d]) => d.href === hrefOf(tab, id)) }))} />
      {Page ? <Page /> : <MissingPage title={`${title} · ${label}`} />}
    </div>
  );
}
