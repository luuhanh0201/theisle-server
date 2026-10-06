import type { PteraSettings as Settings } from '@isle/api';
import { Field, FieldGrid, NumberInput, SectionTitle, Switch } from '@isle/ui';
import { SettingsPage } from '../../settings-form/SettingsPage';
import { useSettingsForm } from '../../settings-form/useSettingsForm';

type NumKey = Exclude<keyof Settings, 'enabled'>;
/** The numbers, as the bridge allows them (bridge/src/ptera-settings.ts LIMITS). */
const FIELDS: ReadonlyArray<{ key: NumKey; label: string; min: number; max: number; step: number; hint?: string }> = [
  { key: 'maxKg', label: 'Cân nặng tối đa gắp được (kg)', min: 1, max: 20000, step: 5, hint: 'Theo cân nặng game báo cho con mồi. Ptera trưởng thành nặng 90 kg; Troodon trưởng thành ~40 kg.' },
  { key: 'maxSeconds', label: 'Mang tối đa (giây)', min: 3, max: 120, step: 1 },
  { key: 'cooldown', label: 'Chờ giữa hai lần gắp (giây)', min: 0, max: 3600, step: 5 },
  { key: 'hintMeters', label: 'Nhắc "có thể gắp" khi cách (m, 0 = tắt)', min: 0, max: 50, step: 1 },
  { key: 'grabMeters', label: 'Tầm gắp (m)', min: 2, max: 30, step: 1, hint: 'Bấm Z + chuột phải khi đang bay → gắp dino người chơi gần nhất trong tầm này (nếu đủ nhẹ).' },
];

/** Mods → Ptera gắp (mods/PteraCarry, bridge/src/ptera-settings.ts). */
export function PteraSettings() {
  const form = useSettingsForm<Settings>('/api/ptera-carry', { label: 'Ptera gắp', href: '#mods/ptera', saved: 'Đã lưu, mod đọc lại trong vài giây.' });
  return (
    <>
      <SectionTitle first icon="🦅" title="Cấu hình · Ptera gắp" sub="mod PteraCarry · lưu riêng, có hiệu lực trong vài giây" />
      <SettingsPage form={form} intro={<>
        Pteranodon đang bay, tới sát dino của người chơi khác và giữ <b>Z + chuột phải</b> (phím bám) → gắp và mang con đó
        ngay dưới mình. Thả khi <b>đáp xuống</b>, gõ <span style={{ fontFamily: 'var(--font-mono)' }}>!drop</span>, hết thời gian, hoặc một trong hai thoát / chết.
        Thả trên cao thì con mồi rơi và chịu sát thương rơi như game. Chỉ gắp dino người chơi (không gắp AI).
        Nội dung tin nhắn sửa ở tab <a href="#mods/messages">Thông báo → Ptera gắp</a>.
      </>}>
        {form.draft && (
          <>
            <Switch id="pt-enabled" checked={form.draft.enabled} onChange={(v) => form.set('enabled', v)} label={<b>Bật Ptera gắp</b>} />
            <FieldGrid>
              {FIELDS.map((f) => (
                <Field key={f.key} label={f.label} keyName={f.key} hint={f.hint} htmlFor={`pt-${f.key}`}>
                  <NumberInput id={`pt-${f.key}`} value={form.draft![f.key]} min={f.min} max={f.max} step={f.step} onChange={(v) => form.set(f.key, v)} />
                </Field>
              ))}
            </FieldGrid>
          </>
        )}
      </SettingsPage>
    </>
  );
}
