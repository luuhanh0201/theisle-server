import type { ReactNode } from 'react';
import type { CommandsSettings as Settings, PlayerCommand } from '@isle/api';
import { Field, FieldGrid, Hint, Mono, NumberInput, SectionTitle, Switch } from '@isle/ui';
import { SettingsPage } from '../../settings-form/SettingsPage';
import { useSettingsForm } from '../../settings-form/useSettingsForm';
import styles from './CommandsSettings.module.css';

const NAMES: Record<PlayerCommand, string> = { slay: '!slay', unstuck: '!unstuck', prime: '!prime', status: '!status', food: '!food' };
type CdKey = 'slayCooldown' | 'unstuckCooldown' | 'foodCooldown';
const COOLDOWNS: ReadonlyArray<{ key: CdKey; label: string; hint: ReactNode }> = [
  { key: 'slayCooldown', label: 'Chờ giữa hai lần !slay (giây)', hint: <><Mono>!slay</Mono>, chết ngay dino đang chơi. Mặc định 300.</> },
  { key: 'unstuckCooldown', label: 'Chờ giữa hai lần !unstuck (giây)', hint: <><Mono>!unstuck</Mono>, về điểm gần nhất dino vừa đứng trên mặt đất (cách ≥ 3 m, nâng 0,5 m, không thả từ trên cao). Mặc định 600.</> },
  { key: 'foodCooldown', label: 'Chờ giữa hai lần !food (giây)', hint: <><Mono>!food</Mono>, nhả thứ đang kẹt trong mồm (con mồi đang gắp, miếng thịt / quả đang ngậm hay kéo). Mặc định 30.</> },
];

/** Mods → Lệnh chat: the cooldowns and which commands are on (mods/PlayerCommands). */
export function CommandsSettings() {
  const form = useSettingsForm<Settings>('/api/commands-settings', { label: 'Lệnh chat', href: '#mods/commands', saved: 'Đã lưu, có hiệu lực ngay.' });
  const d = form.draft;
  return (
    <>
      <SectionTitle first icon="⌨" title="Cấu hình · Lệnh người chơi" sub="lưu riêng, có hiệu lực ngay, không cần khởi động lại" />
      <SettingsPage form={form}>
        {d && (
          <>
            <FieldGrid>
              {COOLDOWNS.map((c) => (
                <Field key={c.key} label={c.label} keyName={c.key} hint={c.hint} htmlFor={`pc-${c.key}`}>
                  <NumberInput id={`pc-${c.key}`} value={d[c.key]} min={0} max={86400} step={1} onChange={(v) => form.set(c.key, v)} />
                </Field>
              ))}
            </FieldGrid>
            <div>
              <div className={styles.label}>Lệnh đang bật</div>
              <div className={styles.grid}>
                {(Object.keys(NAMES) as PlayerCommand[]).map((k) => (
                  <div key={k} className={styles.item}>
                    <Switch checked={d.enabled[k] === true} label={NAMES[k]}
                      onChange={(v) => form.set('enabled', { ...d.enabled, [k]: v })} />
                  </div>
                ))}
              </div>
              <Hint className={styles.after}><Mono>!prime</Mono>, dino có phải prime elder / đủ điều kiện prime không · <Mono>!status</Mono>, loài, growth, máu, stamina, đói, khát, huyết, oxy.</Hint>
            </div>
          </>
        )}
      </SettingsPage>
    </>
  );
}
