import type { MessagesSettings as Settings, MessagesWithCatalog } from '@isle/api';
import { Button, Hint } from '@isle/ui';
import { FreshBar } from '../../settings-form/FreshBar';
import { useSettingsForm } from '../../settings-form/useSettingsForm';
import { TextsCard } from './TextsCard';
import { TimingCard } from './TimingCard';
import { withText } from './texts';
import styles from './Messages.module.css';

/** Mods → Thông báo: every in-game text, the restart countdown, corpse wipe and periodic announcements (bridge/src/messages.ts). */
export function MessagesSettings() {
  const form = useSettingsForm<Settings, MessagesWithCatalog>('/api/messages', {
    label: 'Thông báo', href: '#mods/messages',
    select: (r) => ({ texts: r.texts, countdownMarks: r.countdownMarks, periodic: r.periodic, corpseWipe: r.corpseWipe }),
  });
  const d = form.draft;
  const catalog = form.raw?.catalog;
  if (form.error) return <Hint>Không tải được thông báo: {form.error.message}</Hint>;
  if (d === null || catalog === undefined) return <Hint>Đang tải…</Hint>;
  return (
    <div className={styles.page}>
      <TimingCard draft={d} update={form.update} />
      <TextsCard catalog={catalog} texts={d.texts} setText={(key, own) => form.update((s) => ({ ...s, texts: withText(s.texts, key, own) }))} />
      <div className={styles.savebar}>
        {form.dirty && <b className={styles.dirty}>Có thay đổi chưa lưu.</b>}
        <Button onClick={() => void form.save()} disabled={!form.dirty || form.saving}>{form.saving ? 'Đang lưu…' : 'Lưu thông báo'}</Button>
      </div>
      <FreshBar show={form.serverChanged} dirty={form.dirty} onReload={form.reload} />
    </div>
  );
}
