import type { NewsItem, NewsSettings as Settings } from '@isle/api';
import { Button, Hint, Switch, TextArea, TextInput } from '@isle/ui';
import { SettingsPage } from '../../settings-form/SettingsPage';
import { useSettingsForm } from '../../settings-form/useSettingsForm';
import { dateTime } from '../../../lib/format';
import styles from './NewsSettings.module.css';

const LIMITS = { items: 50, title: 120, body: 3000 };

/**
 * Tính năng mod → Tin cập nhật (bridge/src/news.ts): the server's update notes on the launcher's Trang chủ, newest
 * first. A note switched off stays here only. Saved all at once; a new note gets its date when saved.
 */
export function NewsSettings() {
  const form = useSettingsForm<Settings, { items: NewsItem[] }>('/api/news', {
    label: 'Tin cập nhật', href: '#mods/news', saved: 'Đã lưu tin cập nhật, Trang chủ của launcher hiện ngay.',
    select: (r) => ({ items: r.items }),
    toBody: (d) => ({ items: d.items }),
  });
  const d = form.draft;
  const lim = form.latest?.limits ?? LIMITS;
  const set = (i: number, patch: Partial<NewsItem>): void => form.update((x) => ({ items: x.items.map((n, j) => (j === i ? { ...n, ...patch } : n)) }));
  const shownCount = d ? d.items.filter((n) => n.shown && n.title.trim()).length : 0;
  return (
    <SettingsPage form={form} saveLabel="Lưu tin cập nhật"
      intro={<>Các bản cập nhật của server, hiện ở <b>Trang chủ của launcher</b>, tin mới nhất ở trên (người chơi thấy 10 tin mới nhất đang bật). Viết ngắn: tiêu đề và vài dòng nội dung, xuống dòng được giữ nguyên.</>}>
      {d && <>
        <div className={styles.bar}>
          <Button variant="soft" small disabled={d.items.length >= lim.items}
            onClick={() => form.update((x) => ({ items: [{ title: '', body: '', shown: true }, ...x.items] }))}>+ Viết tin mới</Button>
          <Hint>{d.items.length === 0 ? 'Chưa có tin nào.' : `${d.items.length} tin · ${shownCount} đang hiện`}</Hint>
        </div>
        <ul className={styles.list}>
          {d.items.map((n, i) => (
            <li key={n.id ?? `new-${i}`} className={n.shown ? '' : styles.off}>
              <div className={styles.head}>
                <Switch checked={n.shown} onChange={(v) => set(i, { shown: v })} label="Hiện" />
                <TextInput className={styles.title} maxLength={lim.title} value={n.title} placeholder="Tiêu đề, ví dụ: Cập nhật 07/10: kênh tin, voice mới"
                  aria-label="Tiêu đề tin" autoFocus={n.id === undefined && n.title === '' && i === 0} onChange={(e) => set(i, { title: e.target.value })} />
                <Button variant="ghost" small className={styles.del} onClick={() => form.update((x) => ({ items: x.items.filter((_, j) => j !== i) }))}>Xoá</Button>
              </div>
              <TextArea className={styles.body} rows={4} maxLength={lim.body} value={n.body} placeholder="Nội dung: có gì mới, sửa gì…"
                aria-label="Nội dung tin" onChange={(e) => set(i, { body: e.target.value })} />
              <Hint>{n.at ? `Đăng lúc ${dateTime(n.at)}` : 'Tin mới: ngày đăng là lúc bấm Lưu'}{n.title.trim() ? '' : ' · cần tiêu đề'}</Hint>
            </li>
          ))}
        </ul>
      </>}
    </SettingsPage>
  );
}
