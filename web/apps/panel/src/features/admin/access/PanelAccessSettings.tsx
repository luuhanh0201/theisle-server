import type { PanelAccess } from '@isle/api';
import { Button, Field, Hint, Mono, SectionTitle, TextArea, useToast } from '@isle/ui';
import { SettingsPage } from '../../settings-form/SettingsPage';
import { useSettingsForm } from '../../settings-form/useSettingsForm';

/** The list as typed: one IP or range a line (spaces and commas split too, as the bridge's old form did). */
export const linesOf = (text: string): string[] => text.split(/[\s,]+/).map((l) => l.trim()).filter(Boolean);

/** Quản trị → Truy cập panel: which IPs may open the panel on the web (bridge/src/panel-access.ts). */
export function PanelAccessSettings() {
  const toast = useToast();
  const form = useSettingsForm<{ text: string }, PanelAccess>('/api/panel-access', {
    label: 'Truy cập panel', href: '#admin/access',
    select: (r) => ({ text: r.ips.join('\n') }), toBody: (d) => ({ ips: linesOf(d.text) }),
    onSaved: () => toast('Đã lưu danh sách IP, có hiệu lực ngay.'),
  });
  const pa = form.raw;
  const d = form.draft;
  const mine = pa?.yourRule ?? null;
  const showAddMe = d !== null && mine !== null && !linesOf(d.text).includes(mine);
  return (
    <>
      <SectionTitle first icon="🔒" title="Truy cập admin panel" sub="có hiệu lực ngay" />
      <SettingsPage form={form} saveLabel="Lưu danh sách" intro={pa && (
        <>
          <div>Vào panel phải qua <b>2 lượt</b>: (1) địa chỉ IP nằm trong danh sách dưới đây, vào qua SSH tunnel thì luôn qua lượt này;
            (2) đăng nhập Steam bằng tài khoản có trong danh sách Admin (Thành viên → Admin).</div>
          <div>{pa.webEnabled ? 'Panel đang mở qua web.' : 'Panel chưa mở qua web (chưa đặt PANEL_BASE_URL), hiện chỉ vào được qua SSH tunnel; danh sách này dùng khi mở.'}</div>
          <div>Đang cho phép: {pa.ips.length ? pa.ips.map((ip, i) => <span key={ip}>{i > 0 && ', '}<Mono>{ip}</Mono></span>) : <b>(trống)</b>}
            {pa.saved ? '' : ' (từ PANEL_ALLOWED_IPS trong .env, chưa lưu trên panel)'}.</div>
          <div>{pa.yourIp
            ? <>Bạn đang vào từ <Mono>{pa.yourIp}</Mono>, không thể bỏ địa chỉ này khỏi danh sách. Mạng nhà dùng IPv6 thì phần cuối địa chỉ đổi vài giờ một lần: hãy cho cả dải /64 (nút bên dưới).</>
            : 'Bạn đang vào qua SSH tunnel.'}</div>
        </>
      )}>
        {d && (
          <>
            <Field label="Địa chỉ IP được vào panel qua web" keyName="mỗi dòng một IP, hoặc một dải: 1.2.3.0/24, 2405:4802:1d32:eec0::/64" htmlFor="pa-ips">
              <TextArea id="pa-ips" rows={5} spellCheck={false} style={{ fontFamily: 'var(--font-mono)', minHeight: 120 }}
                value={d.text} onChange={(e) => form.set('text', e.target.value)} />
            </Field>
            {showAddMe && (
              <div><Button variant="ghost" onClick={() => form.set('text', [...linesOf(d.text), mine].join('\n'))}>
                {mine.includes('/') ? `Thêm mạng của tôi (${mine})` : 'Thêm IP của tôi'}
              </Button></div>
            )}
            <Hint>Lưu xong có hiệu lực ngay cho lượt mở panel kế tiếp.</Hint>
          </>
        )}
      </SettingsPage>
    </>
  );
}
