import type { GarageSettings as Settings, GarageSettingsStatus, RedeemAt, TierRule } from '@isle/api';
import { Field, FieldGrid, Hint, NumberInput, SectionTitle, Select, useToast } from '@isle/ui';
import { SettingsPage } from '../../settings-form/SettingsPage';
import { useSettingsForm } from '../../settings-form/useSettingsForm';
import styles from './GarageSettings.module.css';

const SPOTS: ReadonlyArray<{ value: RedeemAt; label: string; help: string }> = [
  { value: 'current', label: 'Chỗ người chơi đang đứng', help: 'Người chơi respawn đúng loài đã cất rồi bấm Lấy ra trên web, dino được khôi phục ngay tại chỗ đang đứng.' },
  { value: 'stored', label: 'Điểm đã cất (vị trí lúc bắt đầu cất)', help: 'Người chơi respawn đúng loài rồi bấm Lấy ra trên web, dino được đưa về đúng chỗ lúc bắt đầu cất. Slot tạo từ panel không có điểm cất nên khôi phục tại chỗ.' },
  { value: 'choice', label: 'Người chơi tự chọn trên web', help: 'Trên web người chơi chọn "chỗ đang đứng" hoặc "chỗ đã cất" trước khi bấm Lấy ra.' },
];

const TIERS = [
  { id: 'normal', chip: '👤 Người thường', cls: styles.tNormal },
  { id: 'vip', chip: '⭐ VIP', cls: styles.tVip },
  { id: 'svip', chip: '💎 SVip', cls: styles.tSvip },
  { id: 'admin', chip: '🛡️ Admin', cls: styles.tAdmin },
] as const;

/** Gara → Cài đặt gara: where a dino comes out, the rules by member tier, the rules for all (bridge/src/garage.ts). */
export function GarageSettings() {
  const toast = useToast();
  const form = useSettingsForm<Settings, GarageSettingsStatus>('/api/garage-settings', {
    label: 'Cài đặt gara', href: '#garage/settings',
    // The member counts are only shown (the panel before React left them out the same way).
    select: ({ memberCounts: _counts, ...s }) => s, fromSave: (a: Settings) => a,
    onSaved: () => toast('Đã lưu, áp dụng ngay cho lần cất / lấy ra kế tiếp.'),
  });
  const d = form.draft;
  const n = form.raw?.memberCounts ?? { vip: 0, svip: 0, admin: 0 };
  const setTier = (t: 'vip' | 'svip', p: Partial<TierRule>): void =>
    form.update((s) => ({ ...s, tiers: { ...s.tiers, [t]: { ...s.tiers[t], ...p } } }));
  const counts: Record<(typeof TIERS)[number]['id'], string> = { normal: 'mọi người còn lại', vip: `${n.vip} người`, svip: `${n.svip} người`, admin: `${n.admin} người` };
  return (
    <>
      <SectionTitle first tone="gar" icon="🦖" title="Cấu hình · Gara" sub="Lưu riêng độc lập, áp dụng ngay tức thì không cần khởi động lại server" />
      <SettingsPage form={form} intro="Áp dụng cho mọi người chơi khi cất / lấy dino trên web (Gara).">
        {d && (
          <>
            <div className={styles.spot}>
              <label htmlFor="gs-redeem-at" className={styles.spotLabel}>Vị trí xuất hiện khi lấy dino ra khỏi gara</label>
              <Select id="gs-redeem-at" value={d.redeemAt} options={SPOTS} onChange={(v) => form.set('redeemAt', v)} />
              <Hint>{SPOTS.find((s) => s.value === d.redeemAt)?.help}</Hint>
            </div>

            <div className={styles.block}>
              <div className={styles.blockHead}><h3>Theo mức thành viên</h3>
                <Hint>VIP: Thành viên → VIP · SVip: Thành viên → SVip · mức cao nhất được áp dụng · 0 ô = không giới hạn</Hint></div>
              <Hint>Hiện có: {n.vip} VIP · {n.svip} SVip · {n.admin} admin; mọi người còn lại là người thường.</Hint>
              <div className={styles.wrap}>
                <table className={styles.table}>
                  <thead><tr><th scope="col" />
                    {TIERS.map((t) => <th key={t.id} scope="col"><span className={`${styles.chip} ${t.cls}`}>{t.chip}</span><small>{counts[t.id]}</small></th>)}
                  </tr></thead>
                  <tbody>
                    <tr><th scope="row">Số ô gara tối đa<small>kể cả slot admin tặng; ai đang có nhiều hơn vẫn giữ, chỉ không cất thêm</small></th>
                      <td data-label={TIERS[0].chip}><NumberInput aria-label="Người thường: số ô gara" value={d.maxSlots} min={1} max={20} onChange={(v) => form.set('maxSlots', v)} /></td>
                      <td data-label={TIERS[1].chip}><NumberInput aria-label="VIP: số ô gara" value={d.tiers.vip.maxSlots} min={0} max={50} onChange={(v) => setTier('vip', { maxSlots: v })} /></td>
                      <td data-label={TIERS[2].chip}><NumberInput aria-label="SVip: số ô gara" value={d.tiers.svip.maxSlots} min={0} max={50} onChange={(v) => setTier('svip', { maxSlots: v })} /></td>
                      <td data-label={TIERS[3].chip} className={styles.fixed}>Không giới hạn</td></tr>
                    <tr><th scope="row">Chờ giữa 2 lần dùng (giây)<small>sau mỗi lần cất hoặc lấy ra thành công</small></th>
                      <td data-label={TIERS[0].chip}><NumberInput aria-label="Người thường: thời gian chờ" value={d.cooldown} min={0} max={86400} onChange={(v) => form.set('cooldown', v)} /></td>
                      <td data-label={TIERS[1].chip}><NumberInput aria-label="VIP: thời gian chờ" value={d.tiers.vip.cooldown} min={0} max={86400} onChange={(v) => setTier('vip', { cooldown: v })} /></td>
                      <td data-label={TIERS[2].chip}><NumberInput aria-label="SVip: thời gian chờ" value={d.tiers.svip.cooldown} min={0} max={86400} onChange={(v) => setTier('svip', { cooldown: v })} /></td>
                      <td data-label={TIERS[3].chip} className={styles.fixed}>0</td></tr>
                    <tr><th scope="row">Ưu tiên vào khi server đầy<small>danh sách VIP của game; SVip được thêm lúc server khởi động</small></th>
                      <td data-label={TIERS[0].chip} className={styles.fixed}>Không</td><td data-label={TIERS[1].chip} className={styles.yes}>Có</td>
                      <td data-label={TIERS[2].chip} className={styles.yes}>Có</td><td data-label={TIERS[3].chip} className={styles.fixed}>Theo danh sách VIP</td></tr>
                    <tr><th scope="row">Dùng trước tính năng thử nghiệm<small>Thành viên → SVip → Mức phát hành chức năng</small></th>
                      <td data-label={TIERS[0].chip} className={styles.fixed}>Không</td><td data-label={TIERS[1].chip} className={styles.fixed}>Không</td>
                      <td data-label={TIERS[2].chip} className={styles.yes}>Có</td><td data-label={TIERS[3].chip} className={styles.yes}>Có</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className={styles.blockHead}><h3>Chung cho mọi người</h3></div>
            <FieldGrid>
              <Field label="Thời gian đếm ngược khi cất (giây)" keyName="storeCountdown" htmlFor="gs-countdown"
                hint="Từ lúc bấm Cất tới khi dino vào gara. Người chơi phải đứng yên trong 5m, không nhận sát thương. Mặc định 30s.">
                <NumberInput id="gs-countdown" value={d.storeCountdown} min={0} max={300} onChange={(v) => form.set('storeCountdown', v)} />
              </Field>
              <Field label="Máu tối thiểu để được cất (%)" keyName="minHealthPct" htmlFor="gs-min-health"
                hint="Máu hiện tại so với máu tối đa. Thấp hơn sẽ bị từ chối cất. Đặt 0 = không giới hạn.">
                <NumberInput id="gs-min-health" value={d.minHealthPct} min={0} max={100} onChange={(v) => form.set('minHealthPct', v)} />
              </Field>
              <Field label="Tăng trưởng tối thiểu để cất (%)" keyName="minGrowthPct" htmlFor="gs-min-growth"
                hint="Dino bé hơn mức này sẽ không được cất. Đặt 0 = không giới hạn.">
                <NumberInput id="gs-min-growth" value={d.minGrowthPct} min={0} max={100} onChange={(v) => form.set('minGrowthPct', v)} />
              </Field>
            </FieldGrid>
          </>
        )}
      </SettingsPage>
    </>
  );
}
