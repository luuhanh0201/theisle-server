import type { JSX } from 'react';
import { PageHead, SubTabs } from '@isle/ui';
import { SUBS, subAllowed } from '../../app/nav';
import { hrefOf } from '../../app/router';
import { useSession } from '../../app/session';
import { LegacyPage } from '../../app/LegacyPage';
import { useDrafts } from '../../features/settings-form/drafts';
import { PteraSettings } from '../../features/mods/ptera/PteraSettings';
import { TeleSettings } from '../../features/mods/tele/TeleSettings';

/** Tính năng mod: the mods' settings, one sub-page each. Not moved yet: a link to the panel before React. */
const PAGES: Record<string, () => JSX.Element> = { ptera: PteraSettings, tele: TeleSettings };

export function ModsPage({ sub }: { sub: string }) {
  const { access } = useSession();
  const drafts = useDrafts();
  const subs = (SUBS.mods ?? []).filter(([id]) => subAllowed(access, 'mods', id));
  const Page = PAGES[sub];
  const label = subs.find(([id]) => id === sub)?.[1] ?? sub;
  return (
    <div>
      <PageHead title="Tính năng mod" sub="Những gì các mod của server thêm cho người chơi: lệnh chat, Ptera gắp, tele con non, voice gần, và nội dung mọi thông báo." />
      <SubTabs label="Mục của Tính năng mod" active={sub}
        tabs={subs.map(([id, l]) => ({ id, label: l, href: hrefOf('mods', id), dot: drafts.some(([, d]) => d.href === hrefOf('mods', id)) }))} />
      {Page ? <Page /> : <LegacyPage title={label} hash={hrefOf('mods', sub)} />}
    </div>
  );
}
