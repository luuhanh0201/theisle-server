import type { JSX } from 'react';
import { PageHead, SubTabs } from '@isle/ui';
import { useDrafts } from '../features/settings-form/drafts';
import { LegacyPage } from './LegacyPage';
import { HEADS, SUBS, subAllowed, type TabId } from './nav';
import { hrefOf } from './router';
import { useSession } from './session';

/** A block's pages in React, by sub-page id ('' for a block without sub-pages). */
export type BlockPages = Readonly<Record<string, () => JSX.Element>>;

/**
 * One block of the panel: its heading, its sub-pages (a dot on those with unsaved changes), and
 * the page asked for. A page not moved to React yet: a link to it in the panel before React.
 */
export function Block({ tab, sub, pages }: { tab: TabId; sub: string | null; pages: BlockPages }) {
  const { access } = useSession();
  const drafts = useDrafts();
  const [title, line] = HEADS[tab];
  const subs = (SUBS[tab] ?? []).filter(([id]) => subAllowed(access, tab, id));
  const Page = pages[sub ?? ''];
  const subLabel = subs.find(([id]) => id === sub)?.[1];
  return (
    <div>
      <PageHead title={title} sub={line} />
      {subs.length > 0 && sub !== null && (
        <SubTabs label={`Mục của ${title}`} active={sub}
          tabs={subs.map(([id, l]) => ({ id, label: l, href: hrefOf(tab, id), dot: drafts.some(([, d]) => d.href === hrefOf(tab, id)) }))} />
      )}
      {Page ? <Page /> : <LegacyPage title={subLabel ? `${title} · ${subLabel}` : title} hash={hrefOf(tab, sub)} />}
    </div>
  );
}
