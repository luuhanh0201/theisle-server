import type { TeleSettings as Settings } from '@isle/api';
import { Field, FieldGrid, NumberInput, SectionTitle } from '@isle/ui';
import { SettingsPage } from '../../settings-form/SettingsPage';
import { useSettingsForm } from '../../settings-form/useSettingsForm';

/** The numbers, as the bridge allows them (bridge/src/tele.ts LIMITS). */
const FIELDS: ReadonlyArray<{ key: keyof Settings; label: string; min: number; max: number; step: number; hint?: string }> = [
  { key: 'maxGrowthPct', label: 'Tăng trưởng tối đa của người dịch chuyển (%)', min: 1, max: 100, step: 1, hint: 'Người nhập mã (B). Bằng mức này vẫn được (40 = tới 40%).' },
  { key: 'targetMaxGrowthPct', label: 'Tăng trưởng tối đa của người đưa mã (%)', min: 1, max: 100, step: 1, hint: 'Người lấy mã (A), chỗ B được đưa tới.' },
  { key: 'codeMinutes', label: 'Mã dùng được (phút)', min: 1, max: 60, step: 1, hint: 'Mỗi mã dùng 1 lần; lấy mã mới thì mã cũ bỏ.' },
  { key: 'cooldownS', label: 'Hồi sau mỗi lần tele (giây)', min: 0, max: 3600, step: 5 },
  { key: 'combatS', label: 'Không giao tranh trong (giây) trước khi tele', min: 0, max: 600, step: 5, hint: 'Đánh hoặc bị người chơi đánh, hay mất máu (AI cắn, rơi, chảy máu). 0 = không xét.' },
  { key: 'countdownS', label: 'Đứng yên trước khi dịch chuyển (giây)', min: 0, max: 60, step: 1, hint: 'Trong bán kính 5 m, không đánh và không bị đánh, như khi cất gara.' },
];

/** Mods → Tele con non: the limits of the players' tele (Dino Live page; mods/DinoGarage garage/tele.lua). */
export function TeleSettings() {
  const form = useSettingsForm<Settings>('/api/tele-settings', { label: 'Tele con non', href: '#mods/tele', saved: 'Đã lưu, có hiệu lực ngay.' });
  return (
    <>
      <SectionTitle first icon="🌀" title="Cấu hình · Tele con non" sub="trang Dino Live của người chơi · lưu riêng, có hiệu lực ngay" />
      <SettingsPage form={form} intro={<>
        Người A bấm <b>Lấy mã</b> trên trang Dino Live, đưa mã cho người B; B nhập mã → dino của B được đưa tới chỗ A
        sau khi đứng yên vài giây. Cả hai dino phải nhỏ (tăng trưởng không quá mức bên dưới), B không giao tranh (đánh, bị đánh, mất máu)
        trong khoảng thời gian bên dưới. A phải đứng trên mặt đất (không bay, bơi, rơi). Bật cho ai dùng ở <a href="#members/svip">Thành viên → SVip</a>
        {' '}(mục phát hành "Tele con non"). Nội dung tin nhắn trong game sửa ở <a href="#mods/messages">Thông báo → Tele con non</a>.
      </>}>
        {form.draft && (
          <FieldGrid>
            {FIELDS.map((f) => (
              <Field key={f.key} label={f.label} keyName={f.key} hint={f.hint} htmlFor={`tl-${f.key}`}>
                <NumberInput id={`tl-${f.key}`} value={form.draft![f.key]} min={f.min} max={f.max} step={f.step} onChange={(v) => form.set(f.key, v)} />
              </Field>
            ))}
          </FieldGrid>
        )}
      </SettingsPage>
    </>
  );
}
