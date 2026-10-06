import type { FishSaved, FishSettings as Settings, FishSettingsStatus } from '@isle/api';
import { CheckGrid, Checkbox, Field, FieldGrid, Hint, Mono, NumberInput, SectionTitle, Switch, useToast } from '@isle/ui';
import { ago } from '../../../lib/time';
import { SettingsPage } from '../../settings-form/SettingsPage';
import { useSettingsForm } from '../../settings-form/useSettingsForm';

/** The toast after a save: the species go to the game through RCON, which may need a restart. */
export function savedText(rcon: string): string {
  if (rcon === 'restart needed') return 'Đã lưu, loài vừa mở lại sẽ có sau lần restart tới.';
  if (rcon.startsWith('failed')) return `Đã lưu, nhưng RCON lỗi (${rcon}), loài áp dụng ở lần restart tới.`;
  return 'Đã lưu, mật độ áp dụng trong ~30 giây.';
}

/** The last count of fish near players, and what the game disallows now. */
function Census({ st }: { st: FishSettingsStatus }) {
  const c = st.census;
  const label = Object.fromEntries(st.species.map((f) => [f.cls, f.label]));
  if (!c) return <Hint>Chưa có lượt đếm cá (cần có người chơi online).</Hint>;
  const kinds = Object.entries(c.species).map(([k, n]) => `${label[k] ?? k} ${n}`).join(' · ') || 'không có con nào gần người chơi';
  return (
    <Hint>
      Đếm lúc {ago(c.t)} ({c.online} người online): <b>{c.total}</b> cá, {kinds} · game đang đặt {c.perPlayer ?? '?'} / người,
      {' '}{c.perWater ?? '?'} / vùng nước, {c.cooldownSec ?? '?'} s.
      <br />Đang cấm: {st.disallowed.join(', ') || '(không)'}
    </Hint>
  );
}

/** Thế giới → Cá: density and species of the fish (bridge/src/fish-settings.ts, mods/FishControl). */
export function FishSettings() {
  const toast = useToast();
  const form = useSettingsForm<Settings, FishSettingsStatus>('/api/fish-settings', {
    label: 'Cá', href: '#world/fish', select: (r) => r.settings, fromSave: (a: FishSaved) => a.settings,
    onSaved: (a: FishSaved) => toast(savedText(a.rcon)),
  });
  const d = form.draft;
  const species = form.raw?.species ?? [];
  return (
    <>
      <SectionTitle first icon="🐟" title="Cấu hình · Cá" sub="mod FishControl · mật độ có hiệu lực trong ~30 giây" />
      <SettingsPage form={form} intro={<>
        Cá sinh quanh người chơi ở sông, hồ, biển (như game). Mục này đặt <b>mật độ chung</b> cho mọi nơi và
        {' '}<b>loài nào được có</b>. Tắt thì mọi thứ về như game (12 cá quanh mỗi người, 28 mỗi vùng nước, đủ 6 loài).
      </>}>
        {d && (
          <>
            <Switch id="fs-control" checked={d.control} onChange={(v) => form.set('control', v)} label={<b>Bật điều khiển cá</b>} />
            <FieldGrid>
              <Field label="Tối đa cá quanh mỗi người chơi" keyName="perPlayer" hint="Game: 12. 0 = không có cá." htmlFor="fs-player">
                <NumberInput id="fs-player" value={d.perPlayer} min={0} max={60} step={1} onChange={(v) => form.set('perPlayer', v)} />
              </Field>
              <Field label="Tối đa cá mỗi vùng nước" keyName="perWater" hint="Game: 28." htmlFor="fs-water">
                <NumberInput id="fs-water" value={d.perWater} min={0} max={200} step={1} onChange={(v) => form.set('perWater', v)} />
              </Field>
              <Field label="Giây giữa hai lần sinh" keyName="cooldownSec" hint="Game: 0,5. Lớn hơn = cá về chậm hơn sau khi bị ăn." htmlFor="fs-cool">
                <NumberInput id="fs-cool" value={d.cooldownSec} min={0.1} max={30} step={0.1} onChange={(v) => form.set('cooldownSec', v)} />
              </Field>
            </FieldGrid>
            <div>
              <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Loài cá được có</div>
              <CheckGrid>
                {species.map((f) => (
                  <Checkbox key={f.key} checked={d.species.includes(f.key)} label={f.label}
                    // Kept in the bridge's order (FISH_SPECIES), as it saves them.
                    onChange={(on) => form.set('species', species.map((x) => x.key).filter((k) => (k === f.key ? on : d.species.includes(k))))} />
                ))}
              </CheckGrid>
              <Hint style={{ marginTop: 6 }}>Loài bỏ chọn được thêm vào danh sách cấm AI của game (<Mono>DisallowedAIClasses</Mono>),
                giữ nguyên các loài khác đang cấm. Cá đang bơi không mất ngay; chọn lại một loài đã cấm có thể cần restart.</Hint>
            </div>
            {form.raw && <Census st={form.raw} />}
          </>
        )}
      </SettingsPage>
    </>
  );
}
