import type { FishSettings as Settings, FishState } from '@isle/api';
import { CheckGrid, Checkbox, Field, FieldGrid, Hint, Mono, NumberInput, SectionTitle, Switch } from '@isle/ui';
import { ago } from '../../../lib/time';
import { SettingsPage } from '../../settings-form/SettingsPage';
import { useSettingsForm } from '../../settings-form/useSettingsForm';
import styles from './FishSettings.module.css';

/** What the save did to the game's species list (the bridge's RCON answer). */
export function savedText(answer: unknown): string {
  const rcon = String((answer as { rcon?: unknown } | null)?.rcon ?? '');
  if (rcon === 'restart needed') return 'Đã lưu, loài vừa mở lại sẽ có sau lần restart tới.';
  if (rcon.startsWith('failed')) return `Đã lưu, nhưng RCON lỗi (${rcon}), loài áp dụng ở lần restart tới.`;
  return 'Đã lưu, mật độ áp dụng trong ~30 giây.';
}

/** Thế giới → Cá (mods/FishControl, bridge/src/fish-settings.ts). */
export function FishSettings() {
  const form = useSettingsForm<FishState, Settings>('/api/fish-settings', { label: 'Cá', href: '#world/fish', select: (r) => r.settings, saved: savedText });
  const d = form.draft;
  const live = form.latest;
  const label = Object.fromEntries((live?.species ?? []).map((f) => [f.cls, f.label]));
  const c = live?.census ?? null;
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
              <Field label="Tối đa cá quanh mỗi người chơi" keyName="perPlayer" hint="Game: 12. 0 = không có cá." htmlFor="fs-perPlayer">
                <NumberInput id="fs-perPlayer" value={d.perPlayer} min={0} max={60} step={1} onChange={(v) => form.set('perPlayer', v)} />
              </Field>
              <Field label="Tối đa cá mỗi vùng nước" keyName="perWater" hint="Game: 28." htmlFor="fs-perWater">
                <NumberInput id="fs-perWater" value={d.perWater} min={0} max={200} step={1} onChange={(v) => form.set('perWater', v)} />
              </Field>
              <Field label="Giây giữa hai lần sinh" keyName="cooldownSec" hint="Game: 0,5. Lớn hơn = cá về chậm hơn sau khi bị ăn." htmlFor="fs-cooldownSec">
                <NumberInput id="fs-cooldownSec" value={d.cooldownSec} min={0.1} max={30} step={0.1} onChange={(v) => form.set('cooldownSec', v)} />
              </Field>
            </FieldGrid>
            <div>
              <div className={styles.label}>Loài cá được có</div>
              <CheckGrid>
                {(live?.species ?? []).map((f) => (
                  <Checkbox key={f.key} label={f.label} checked={d.species.includes(f.key)}
                    // In the bridge's order (FISH_SPECIES), as the panel before React sent them.
                    onChange={(on) => form.set('species', (live?.species ?? []).map((x) => x.key).filter((k) => (k === f.key ? on : d.species.includes(k))))} />
                ))}
              </CheckGrid>
              <Hint className={styles.after}>Loài bỏ chọn được thêm vào danh sách cấm AI của game (<Mono>DisallowedAIClasses</Mono>),
                giữ nguyên các loài khác đang cấm. Cá đang bơi không mất ngay; chọn lại một loài đã cấm có thể cần restart.</Hint>
            </div>
            <Hint>{c
              ? <>Đếm lúc {ago(c.t)} ({c.online} người online): <b>{c.total}</b> cá,{' '}
                {Object.entries(c.species).map(([k, n]) => `${label[k] ?? k} ${n}`).join(' · ') || 'không có con nào gần người chơi'}
                {' '}· game đang đặt {c.perPlayer ?? '?'} / người, {c.perWater ?? '?'} / vùng nước, {c.cooldownSec ?? '?'} s.
                <br />Đang cấm: {live?.disallowed.join(', ') || '(không)'}</>
              : 'Chưa có lượt đếm cá (cần có người chơi online).'}</Hint>
          </>
        )}
      </SettingsPage>
    </>
  );
}
