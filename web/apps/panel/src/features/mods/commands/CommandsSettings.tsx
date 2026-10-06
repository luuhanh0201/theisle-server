import type { CommandName, CommandsSettings as Settings } from '@isle/api';
import { Field, FieldGrid, Hint, Mono, NumberInput, SectionTitle, Switch } from '@isle/ui';
import { SettingsPage } from '../../settings-form/SettingsPage';
import { useSettingsForm } from '../../settings-form/useSettingsForm';
import styles from './CommandsSettings.module.css';

type CdKey = 'slayCooldown' | 'unstuckCooldown' | 'foodCooldown';
/** The waits, as the bridge allows them (bridge/src/commands-settings.ts MAX_COOLDOWN). */
const COOLDOWNS: ReadonlyArray<{ key: CdKey; cmd: string; hint: string }> = [
  { key: 'slayCooldown', cmd: '!slay', hint: 'chết ngay dino đang chơi. Mặc định 300.' },
  { key: 'unstuckCooldown', cmd: '!unstuck', hint: 'về điểm gần nhất dino vừa đứng trên mặt đất (cách ≥ 3 m, nâng 0,5 m, không thả từ trên cao). Mặc định 600.' },
  { key: 'foodCooldown', cmd: '!food', hint: 'nhả thứ đang kẹt trong mồm (con mồi đang gắp, miếng thịt / quả đang ngậm hay kéo). Mặc định 30.' },
];
const COMMANDS: ReadonlyArray<CommandName> = ['slay', 'unstuck', 'prime', 'status', 'food'];

/** Mods → Lệnh chat: the PlayerCommands mod's waits and which commands are on (bridge/src/commands-settings.ts). */
export function CommandsSettings() {
  const form = useSettingsForm<Settings>('/api/commands-settings', { label: 'Lệnh chat', href: '#mods/commands' });
  const d = form.draft;
  return (
    <>
      <SectionTitle first icon="⌨" title="Cấu hình · Lệnh người chơi" sub="lưu riêng, có hiệu lực ngay, không cần khởi động lại" />
      <SettingsPage form={form}>
        {d && (
          <>
            <FieldGrid>
              {COOLDOWNS.map((c) => (
                <Field key={c.key} label={`Chờ giữa hai lần ${c.cmd} (giây)`} keyName={c.key} htmlFor={`pc-${c.key}`}
                  hint={<><Mono>{c.cmd}</Mono>, {c.hint}</>}>
                  <NumberInput id={`pc-${c.key}`} value={d[c.key]} min={0} max={86400} step={1} onChange={(v) => form.set(c.key, v)} />
                </Field>
              ))}
            </FieldGrid>
            <div>
              <div className={styles.label}>Lệnh đang bật</div>
              <div className={styles.checks}>
                {COMMANDS.map((c) => (
                  <Switch key={c} id={`pc-on-${c}`} checked={d.enabled[c]} label={`!${c}`}
                    onChange={(v) => form.update((s) => ({ ...s, enabled: { ...s.enabled, [c]: v } }))} />
                ))}
              </div>
              <Hint className={styles.after}>
                <Mono>!prime</Mono>, dino có phải prime elder / đủ điều kiện prime không · <Mono>!status</Mono>, loài, growth, máu, stamina, đói, khát, huyết, oxy.
              </Hint>
            </div>
          </>
        )}
      </SettingsPage>
    </>
  );
}
