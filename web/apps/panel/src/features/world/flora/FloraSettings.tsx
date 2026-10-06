import type { ReactNode } from 'react';
import type { FloraSettings as Settings, FloraState } from '@isle/api';
import { Field, FieldGrid, Hint, NumberInput, SectionTitle, Switch } from '@isle/ui';
import { ago } from '../../../lib/time';
import { SettingsPage } from '../../settings-form/SettingsPage';
import { useSettingsForm } from '../../settings-form/useSettingsForm';

type NumKey = Exclude<keyof Settings, 'control'>;
/** The numbers, as the bridge allows them (bridge/src/flora-settings.ts). */
const FIELDS: ReadonlyArray<{ key: NumKey; label: string; min: number; max: number; step: number; hint?: string }> = [
  { key: 'migrationNutrientPct', label: 'Di cư: % cây có chất', min: 0, max: 100, step: 5 },
  { key: 'migrationMultiplier', label: 'Di cư: hệ số số cây', min: 1, max: 10, step: 1, hint: '1 = như game. Hệ số sinh cây của chính game cho vùng đó.' },
  { key: 'massNutrientPct', label: 'Đại di cư: % cây có chất', min: 0, max: 100, step: 5 },
  { key: 'massMultiplier', label: 'Đại di cư: hệ số số cây', min: 1, max: 20, step: 1 },
  { key: 'migrationMaxPerArea', label: 'Di cư: tối đa cây mỗi khóm', min: 1, max: 100, step: 1, hint: 'Một khóm rộng ~25 m. Game để 15–40 (có khóm 70). Cây thừa bị gỡ dần (60 cây mỗi lượt, cây không chất trước).' },
  { key: 'massMaxPerArea', label: 'Đại di cư: tối đa cây mỗi khóm', min: 1, max: 200, step: 1 },
  { key: 'outsideMaxPerArea', label: 'Ngoài vùng: tối đa cây mỗi khóm thường', min: 0, max: 50, step: 1, hint: 'Cây ngoài vùng di cư luôn không có chất (chỉ là lá).' },
  { key: 'outsideAmountPct', label: 'Ngoài vùng: % số quả trên cây ăn quả', min: 0, max: 100, step: 5 },
];

/** The mod's last round, live (the settings above stay as the admin edits them). */
function floraStats(state: FloraState | undefined): ReactNode {
  const c = state?.control;
  if (c) {
    return <>Lượt gần nhất ({ago(c.t)}): điều khiển <b>{c.on ? 'đang bật' : 'tắt'}</b> · {c.active} vùng đang di cư ·{' '}
      <b>{c.plantsNutri}/{c.plants}</b> cây và <b>{c.fruitsNutri}/{c.fruits}</b> quả đang có chất{c.trimmed ? ` · vừa gỡ ${c.trimmed} cây vượt mức` : ''}.</>;
  }
  return state?.t ? `Dữ liệu cây: ${ago(state.t)} · chưa có lượt điều khiển nào (đang tắt).` : 'Chưa có dữ liệu từ mod Flora.';
}

/** Thế giới → Thực vật (mods/Flora, bridge/src/flora-settings.ts). */
export function FloraSettings() {
  const form = useSettingsForm<FloraState, Settings>('/api/flora-settings', {
    label: 'Thực vật', href: '#world/flora', select: (r) => r.settings, saved: 'Đã lưu, mod áp dụng trong ~15 giây.',
  });
  const d = form.draft;
  return (
    <>
      <SectionTitle first icon="🌿" title="Cấu hình · Thực vật" sub="mod Flora · có hiệu lực trong ~15 giây, không cần restart" />
      <SettingsPage form={form} intro={<>
        Cây và quả chỉ <b>có chất (α β γ)</b> trong các vùng di cư <b>đang hoạt động</b>, ít ở di cư thường, nhiều ở
        {' '}<b>đại di cư</b>. Ngoài vùng: ít cây hơn và chỉ là lá, <b>không có chất</b>. Game tự chọn vùng nào di cư; tắt mục này thì mọi
        giá trị về như game gốc. Xem cây thật trên tab <a href="#map">Bản đồ</a> (lớp "Thực vật (live)").
      </>}>
        {d && (
          <>
            <Switch id="fl-control" checked={d.control} onChange={(v) => form.set('control', v)} label={<b>Bật điều khiển thực vật</b>} />
            <FieldGrid>
              {FIELDS.map((f) => (
                <Field key={f.key} label={f.label} keyName={f.key} hint={f.hint} htmlFor={`fl-${f.key}`}>
                  <NumberInput id={`fl-${f.key}`} value={d[f.key]} min={f.min} max={f.max} step={f.step} onChange={(v) => form.set(f.key, v)} />
                </Field>
              ))}
            </FieldGrid>
            <Hint>{floraStats(form.latest)}</Hint>
          </>
        )}
      </SettingsPage>
    </>
  );
}
