import type { GarageSettings as Settings, GarageSettingsState } from '@isle/api';
import { Button, Card, CardBody, CardHead, Field, FieldGrid, Hint, Icon, NumberInput, Select } from '@isle/ui';
import { SectionTitle } from '@isle/ui';
import { FreshBar } from '../../settings-form/FreshBar';
import { useSettingsForm } from '../../settings-form/useSettingsForm';
import s from './GarageSettings.module.css';

const REDEEM: ReadonlyArray<{ value: Settings['redeemAt']; label: string; help: string }> = [
  { value: 'current', label: 'Chỗ người chơi đang đứng', help: 'Người chơi respawn đúng loài đã cất rồi bấm Lấy ra trên web, dino được khôi phục ngay tại chỗ đang đứng.' },
  { value: 'stored', label: 'Điểm đã cất (vị trí lúc bắt đầu cất)', help: 'Người chơi respawn đúng loài rồi bấm Lấy ra trên web, dino được đưa về đúng chỗ lúc bắt đầu cất. Slot tạo từ panel không có điểm cất nên khôi phục tại chỗ.' },
  { value: 'choice', label: 'Người chơi tự chọn trên web', help: 'Trên web người chơi chọn "chỗ đang đứng" hoặc "chỗ đã cất" trước khi bấm Lấy ra.' },
];

/** Gara → Cài đặt gara: where a dino comes back, the limits by member tier, the store rules. */
export function GarageSettings() {
  const form = useSettingsForm<GarageSettingsState, Settings>('/api/garage-settings', {
    label: 'Cài đặt gara', href: '#garage/settings', saved: 'Đã lưu, áp dụng ngay cho lần cất / lấy ra kế tiếp.',
    select: ({ redeemAt, maxSlots, storeCountdown, cooldown, minHealthPct, minGrowthPct, tiers }) =>
      ({ redeemAt, maxSlots, storeCountdown, cooldown, minHealthPct: minHealthPct ?? 0, minGrowthPct: minGrowthPct ?? 0,
        tiers: { vip: { maxSlots: tiers?.vip?.maxSlots ?? 5, cooldown: tiers?.vip?.cooldown ?? 120 }, svip: { maxSlots: tiers?.svip?.maxSlots ?? 0, cooldown: tiers?.svip?.cooldown ?? 60 } } }),
  });
  const d = form.draft;
  const n = form.latest?.memberCounts ?? {};
  const tier = (t: 'vip' | 'svip', k: 'maxSlots' | 'cooldown', v: number): void =>
    form.update((x) => ({ ...x, tiers: { ...x.tiers, [t]: { ...x.tiers[t], [k]: v } } }));
  return (
    <>
      <SectionTitle first icon="🦖" tone="gar" title="Cấu hình · Gara" sub="Lưu riêng độc lập, áp dụng ngay tức thì không cần khởi động lại server" />
      <Card>
        <CardHead title="Cài đặt gara" sub="Áp dụng cho mọi người chơi khi cất / lấy dino trên web (Gara)">
          <Button small className={s.save} onClick={() => void form.save()} disabled={!form.dirty || form.saving}><Icon name="save" /> {form.saving ? 'Đang lưu…' : 'Lưu cài đặt'}</Button>
        </CardHead>
        <CardBody className={s.body}>
          {form.error ? <Hint>Không tải được cài đặt: {form.error.message}</Hint> : !d ? <Hint>Đang tải…</Hint> : (
            <>
              <div className={s.redeemCard}>
                <label htmlFor="gs-redeem-at" className={s.lbl}>Vị trí xuất hiện khi lấy dino ra khỏi gara</label>
                <Select id="gs-redeem-at" value={d.redeemAt} options={REDEEM} onChange={(v) => form.set('redeemAt', v)} />
                <Hint className={s.gap}>{REDEEM.find((r) => r.value === d.redeemAt)?.help}</Hint>
              </div>
              <div className={s.tierBlock}>
                <div className={s.tierHead}><h3>Theo mức thành viên</h3>
                  <Hint>VIP: Thành viên → VIP · SVip: Thành viên → SVip · mức cao nhất được áp dụng · 0 ô = không giới hạn</Hint></div>
                <Hint>Hiện có: {n.vip ?? 0} VIP · {n.svip ?? 0} SVip · {n.admin ?? 0} admin; mọi người còn lại là người thường.</Hint>
                <div className={s.tierWrap}>
                  <table className={s.tierTable}>
                    <thead><tr><th scope="col" />
                      <th scope="col"><span className={s.tierChip}>👤 Người thường</span><small>mọi người còn lại</small></th>
                      <th scope="col"><span className={`${s.tierChip} ${s.tVip}`}>⭐ VIP</span><small>{n.vip ?? 0} người</small></th>
                      <th scope="col"><span className={`${s.tierChip} ${s.tSvip}`}>💎 SVip</span><small>{n.svip ?? 0} người</small></th>
                      <th scope="col"><span className={`${s.tierChip} ${s.tAdmin}`}>🛡️ Admin</span><small>{n.admin ?? 0} người</small></th></tr></thead>
                    <tbody>
                      <tr><th scope="row">Số ô gara tối đa<small>kể cả slot admin tặng; ai đang có nhiều hơn vẫn giữ, chỉ không cất thêm</small></th>
                        <td data-label="👤 Người thường"><NumberInput aria-label="Người thường: số ô gara" value={d.maxSlots} min={1} max={20} onChange={(v) => form.set('maxSlots', v)} /></td>
                        <td data-label="⭐ VIP"><NumberInput aria-label="VIP: số ô gara" value={d.tiers.vip.maxSlots} min={0} max={50} onChange={(v) => tier('vip', 'maxSlots', v)} /></td>
                        <td data-label="💎 SVip"><NumberInput aria-label="SVip: số ô gara" value={d.tiers.svip.maxSlots} min={0} max={50} onChange={(v) => tier('svip', 'maxSlots', v)} /></td>
                        <td data-label="🛡️ Admin" className={s.fixed}>Không giới hạn</td></tr>
                      <tr><th scope="row">Chờ giữa 2 lần dùng (giây)<small>sau mỗi lần cất hoặc lấy ra thành công</small></th>
                        <td data-label="👤 Người thường"><NumberInput aria-label="Người thường: thời gian chờ" value={d.cooldown} min={0} max={86400} onChange={(v) => form.set('cooldown', v)} /></td>
                        <td data-label="⭐ VIP"><NumberInput aria-label="VIP: thời gian chờ" value={d.tiers.vip.cooldown} min={0} max={86400} onChange={(v) => tier('vip', 'cooldown', v)} /></td>
                        <td data-label="💎 SVip"><NumberInput aria-label="SVip: thời gian chờ" value={d.tiers.svip.cooldown} min={0} max={86400} onChange={(v) => tier('svip', 'cooldown', v)} /></td>
                        <td data-label="🛡️ Admin" className={s.fixed}>0</td></tr>
                      <tr><th scope="row">Ưu tiên vào khi server đầy<small>danh sách VIP của game; SVip được thêm lúc server khởi động</small></th>
                        <td data-label="👤 Người thường" className={s.fixed}>Không</td><td data-label="⭐ VIP" className={`${s.fixed} ${s.yes}`}>Có</td>
                        <td data-label="💎 SVip" className={`${s.fixed} ${s.yes}`}>Có</td><td data-label="🛡️ Admin" className={s.fixed}>Theo danh sách VIP</td></tr>
                      <tr><th scope="row">Dùng trước tính năng thử nghiệm<small>Thành viên → SVip → Mức phát hành chức năng</small></th>
                        <td data-label="👤 Người thường" className={s.fixed}>Không</td><td data-label="⭐ VIP" className={s.fixed}>Không</td>
                        <td data-label="💎 SVip" className={`${s.fixed} ${s.yes}`}>Có</td><td data-label="🛡️ Admin" className={`${s.fixed} ${s.yes}`}>Có</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div className={s.tierHead}><h3>Chung cho mọi người</h3></div>
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
        </CardBody>
      </Card>
      <FreshBar show={form.serverChanged} dirty={form.dirty} onReload={form.reload} />
    </>
  );
}
