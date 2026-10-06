import type { PanelAccess as Access } from '@isle/api';
import { Button, Field, Hint, Mono, SectionTitle, TextArea } from '@isle/ui';
import { SettingsPage } from '../settings-form/SettingsPage';
import { useSettingsForm } from '../settings-form/useSettingsForm';

/** One IP or range a line (spaces and commas also split). */
export const ipsOf = (text: string): string[] => text.split(/[\s,]+/).map((l) => l.trim()).filter(Boolean);

/** Quản trị → Truy cập panel: the IP addresses that may open the panel through the web. */
export function PanelAccess() {
  const form = useSettingsForm<Access, { ips: string }>('/api/panel-access', {
    label: 'Truy cập panel', href: '#admin/access', saved: 'Đã lưu danh sách IP, có hiệu lực ngay.',
    select: (r) => ({ ips: r.ips.join('\n') }), toBody: (d) => ({ ips: ipsOf(d.ips) }),
  });
  const pa = form.latest;
  const lines = form.draft ? ipsOf(form.draft.ips) : [];
  const rule = pa?.yourRule ?? null;
  return (
    <>
      <SectionTitle first icon="🔒" title="Truy cập admin panel" sub="có hiệu lực ngay" />
      <SettingsPage form={form} saveLabel="Lưu danh sách">
        {pa && (
          <Hint>
            <div>Vào panel phải qua <b>2 lượt</b>: (1) địa chỉ IP nằm trong danh sách dưới đây, vào qua SSH tunnel thì luôn qua lượt này; (2) đăng nhập Steam bằng tài khoản có trong danh sách Admin (Cấu hình → Máy chủ → Admin).</div>
            <div>{pa.webEnabled ? 'Panel đang mở qua web.' : 'Panel chưa mở qua web (chưa đặt PANEL_BASE_URL), hiện chỉ vào được qua SSH tunnel; danh sách này dùng khi mở.'}</div>
            <div>Đang cho phép: {pa.ips.length ? pa.ips.map((ip, i) => <span key={ip}>{i > 0 && ', '}<Mono>{ip}</Mono></span>) : <b>(trống)</b>}{pa.saved ? '' : ' (từ PANEL_ALLOWED_IPS trong .env, chưa lưu trên panel)'}.</div>
            <div>{pa.yourIp ? <>Bạn đang vào từ <Mono>{pa.yourIp}</Mono>, không thể bỏ địa chỉ này khỏi danh sách. Mạng nhà dùng IPv6 thì phần cuối địa chỉ đổi vài giờ một lần: hãy cho cả dải /64 (nút bên dưới).</> : 'Bạn đang vào qua SSH tunnel.'}</div>
          </Hint>
        )}
        {form.draft && (
          <>
            <Field label="Địa chỉ IP được vào panel qua web" keyName="mỗi dòng một IP, hoặc một dải: 1.2.3.0/24, 2405:4802:1d32:eec0::/64" htmlFor="pa-ips">
              <TextArea id="pa-ips" rows={5} spellCheck={false} style={{ fontFamily: 'var(--font-mono)' }} value={form.draft.ips} onChange={(e) => form.set('ips', e.target.value)} />
            </Field>
            {rule && !lines.includes(rule) && (
              <div><Button variant="ghost" onClick={() => form.set('ips', [...lines, rule].join('\n'))}>{rule.includes('/') ? `Thêm mạng của tôi (${rule})` : 'Thêm IP của tôi'}</Button></div>
            )}
          </>
        )}
      </SettingsPage>
    </>
  );
}
