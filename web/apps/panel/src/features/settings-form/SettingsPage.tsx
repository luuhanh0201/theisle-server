import type { ReactNode } from 'react';
import { Button, Card, CardBody, Hint } from '@isle/ui';
import { FreshBar } from './FreshBar';

/**
 * The frame of one settings form: the card, its Lưu button, the "Có thay đổi mới" bar, and a
 * load error. `form` is what useSettingsForm returned.
 */
export function SettingsPage({ form, intro, saveLabel = 'Lưu cài đặt', children }: {
  form: { draft: unknown; dirty: boolean; saving: boolean; save: () => Promise<boolean>; serverChanged: boolean; reload: () => void; error: Error | null };
  intro?: ReactNode; saveLabel?: string; children: ReactNode;
}) {
  return (
    <Card>
      <CardBody stack>
        {intro !== undefined && <Hint>{intro}</Hint>}
        {form.error ? <Hint>Không tải được cài đặt: {form.error.message}</Hint>
          : form.draft === null ? <Hint>Đang tải…</Hint>
            : <>
              {children}
              <div><Button onClick={() => void form.save()} disabled={!form.dirty || form.saving}>{form.saving ? 'Đang lưu…' : saveLabel}</Button></div>
            </>}
      </CardBody>
      <FreshBar show={form.serverChanged} dirty={form.dirty} onReload={form.reload} />
    </Card>
  );
}
