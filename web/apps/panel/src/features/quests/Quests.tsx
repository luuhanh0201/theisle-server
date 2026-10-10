import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson } from '@isle/api';
import { Button, Card, CardBody, CardHead, Checkbox, NumberInput, Select, TextInput, useToast } from '@isle/ui';
import { can } from '../../app/nav';
import { useSession } from '../../app/session';
import { PlayerLink } from '../../components/dino/Identity';
import { FreshBar } from '../settings-form/FreshBar';
import { useSettingsForm } from '../settings-form/useSettingsForm';
import { TYPE_ICON } from '../items/tickets/Tickets';
import { Milestones } from './Milestones';
import s from './Quests.module.css';

/** bridge/src/economy.ts, quests.ts, shop.ts as the panel reads them. */
export interface EconomySettings { checkinMinutes: number; checkinRewards: number[]; checkinBonusItem: string | null }
interface EconomyView { currency: string; settings: EconomySettings; summary: { players: number; total: number; top: Array<{ steamId: string; name: string | null; balance: number }> } }
interface LedgerLine { t: number; steamId: string; name: string | null; delta: number; balance: number; reason: string; by: string | null }
export interface QuestDef { id: string; kind: string; label: string; target: number; reward: number; diet: string; period: string; enabled: boolean }
interface QuestsView { settings: { perDay: number; defs: QuestDef[] }; kinds: Record<string, { label: string; unit: string }> }
export interface Listing { id?: string; itemId: string; price: number; dailyLimit: number; enabled: boolean }
interface ShopView { listings: Listing[]; items: Array<{ id: string; type: string; name: string; rarity: string }> }
interface ItemLite { id: string; type: string; name: string; retired?: boolean }

const QQ_DIET = [{ value: 'all', label: 'Mọi loài' }, { value: 'carnivore', label: 'Ăn thịt' }, { value: 'herbivore', label: 'Ăn cỏ' }];
const QQ_PERIOD = [{ value: 'day', label: 'Ngày' }, { value: 'week', label: 'Tuần' }];
const vn = (n: number): string => n.toLocaleString('vi-VN');
const dirtyText = (dirty: boolean): string => (dirty ? '● Có thay đổi chưa lưu' : 'Đã lưu');

/** A new quest: the first free id q<n>, 30 minutes of play. */
export function newQuest(defs: QuestDef[]): QuestDef {
  let n = defs.length + 1;
  while (defs.some((q) => q.id === `q${n}`)) n += 1;
  return { id: `q${n}`, kind: 'play', label: 'Chơi 30 phút', target: 30, reward: 30, diet: 'all', period: 'day', enabled: true };
}
/** A listing swapped with the one above (-1) or below (+1). */
export function moved<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j] as T, out[i] as T];
  return out;
}
/** A SteamID typed for an adjustment: 17 digits from 7656… */
export const adjustError = (steamId: string, delta: number, reason: string): string | null => (!/^7656\d{13}$/.test(steamId) ? 'SteamID: 17 chữ số, bắt đầu bằng 7656…'
  : !Number.isInteger(delta) || delta === 0 ? 'Nhập số Hổ phách cộng (+) hoặc trừ (−), khác 0' : !reason ? 'Cần ghi lý do' : null);

/** Nhiệm vụ: Hổ phách, the daily check-in, the shop, the ledger, the daily / weekly quests, the server's online milestones. */
export function Quests() {
  return (
    <>
      <Checkin />
      <Amber />
      <Shop />
      <Ledger />
      <DailyQuests />
      <Milestones />
    </>
  );
}

function Checkin() {
  const { access } = useSession();
  const edit = can(access, 'economy.edit');
  const f = useSettingsForm<EconomyView, EconomySettings>('/api/economy', {
    label: 'Điểm danh', href: '#quests', select: (r) => r.settings, putUrl: '/api/economy/settings', saved: 'Đã lưu điểm danh.',
  });
  const items = useQuery({ queryKey: ['/api/items'], queryFn: () => getJson<{ items: ItemLite[] }>('/api/items'), enabled: can(access, 'items.view'), staleTime: 30_000 }).data?.items ?? [];
  const cur = f.latest?.currency ?? 'Hổ phách';
  const d = f.draft;
  const bonus = d ? [{ value: '', label: 'Không tặng' }, ...items.filter((i) => !i.retired && i.type !== 'dino').map((i) => ({ value: i.id, label: i.name })),
    ...(d.checkinBonusItem && !items.some((i) => i.id === d.checkinBonusItem) ? [{ value: d.checkinBonusItem, label: d.checkinBonusItem }] : [])] : [];
  return (
    <Card>
      <CardHead title="📅 Điểm danh hằng ngày" sub="người chơi chơi đủ phút trong ngày rồi bấm điểm danh trên trang chủ; bỏ lỡ 1 ngày là quay về ngày 1" />
      <CardBody stack>
        {d === null ? <span className={s.muted}>{f.error ? `Không tải được: ${f.error.message}` : 'Đang tải…'}</span> : <>
          <div className={s.fields}>
            <label>Phút chơi cần trong ngày<NumberInput aria-label="Phút chơi cần trong ngày" min={0} max={600} value={d.checkinMinutes} disabled={!edit} onChange={(v) => f.set('checkinMinutes', Math.round(v))} /></label>
            <label>Vật phẩm tặng kèm ngày 7<Select aria-label="Vật phẩm tặng kèm ngày 7" value={d.checkinBonusItem ?? ''} options={bonus} disabled={!edit}
              onChange={(v) => f.set('checkinBonusItem', v || null)} /></label>
          </div>
          <div className={s.days}>
            {d.checkinRewards.map((r, i) => (
              <label key={i}>Ngày {i + 1} ({cur})<NumberInput aria-label={`Ngày ${i + 1}`} min={0} max={100000} value={r} disabled={!edit}
                onChange={(v) => f.update((x) => ({ ...x, checkinRewards: x.checkinRewards.map((y, j) => (j === i ? Math.round(v) : y)) }))} /></label>
            ))}
          </div>
          <div className={s.foot}><span className={s.dirty}>{dirtyText(f.dirty)}</span>
            {edit && <Button onClick={() => void f.save()} disabled={f.saving}>Lưu điểm danh</Button>}</div>
        </>}
      </CardBody>
      <FreshBar show={f.serverChanged} dirty={f.dirty} onReload={f.reload} />
    </Card>
  );
}

function Amber() {
  const { access, withToken } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const edit = can(access, 'economy.edit');
  const eco = useQuery({ queryKey: ['/api/economy'], queryFn: () => getJson<EconomyView>('/api/economy'), refetchInterval: 2000 }).data;
  const [id, setId] = useState('');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const cur = eco?.currency ?? 'Hổ phách';
  const apply = (): void => {
    const steamId = id.trim(), n = Math.round(Number(delta)), why = reason.trim();
    const err = adjustError(steamId, n, why);
    if (err) { toast(err, 'err'); return; }
    void withToken('cộng / trừ Hổ phách', async (token) => {
      const r = await adminFetch<{ line: LedgerLine }>('/api/economy/adjust', 'POST', token, { steamId, delta: n, reason: why });
      toast(`${n > 0 ? '+' : ''}${n} → còn ${vn(r.line.balance)} Hổ phách`);
      setDelta(''); setReason('');
      await qc.invalidateQueries({ queryKey: ['/api/economy'] });
      await qc.invalidateQueries({ queryKey: ['ledger'] });
    });
  };
  const sum = eco?.summary;
  return (
    <Card className={s.gap}>
      <CardHead title={<>Hổ phách <img src="/amber.svg" alt="" aria-hidden="true" className={s.amber} /></>}
        sub={sum ? `${sum.players} người đang có · tổng ${vn(sum.total)} ${cur}` : ''} />
      <CardBody stack>
        {edit && (
          <div className={s.adjust}>
            <label className={s.f1}>SteamID<TextInput inputMode="numeric" maxLength={17} className={s.mono} placeholder="7656119…" autoComplete="off" value={id} onChange={(e) => setId(e.target.value)} /></label>
            {/* A signed whole number typed (− to take away): a text box, the number box has no minus key on a phone. */}
            <label className={s.f0}>Cộng (+) / trừ (−)<TextInput inputMode="numeric" maxLength={7} value={delta} onChange={(e) => setDelta(e.target.value.replace(/[^\d-]/g, ''))} /></label>
            <label className={s.f2}>Lý do (bắt buộc)<TextInput maxLength={200} placeholder="vd. đền bù lỗi gara" autoComplete="off" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <Button onClick={apply}>Cộng / trừ</Button>
          </div>
        )}
        {!sum ? null : sum.top.length === 0 ? <p className={s.hint}>Chưa ai có Hổ phách.</p> : (
          <div className={s.wrap}><table className={s.table}>
            <thead><tr><th>Nhiều nhất</th><th>SteamID</th><th className={s.r}>{cur}</th></tr></thead>
            <tbody>{sum.top.map((x) => (
              <tr key={x.steamId}><td>{x.name ? <PlayerLink id={x.steamId} name={x.name} /> : <span className={s.muted}>?</span>}</td><td className={s.mono}>{x.steamId}</td><td className={s.r}><b>{vn(x.balance)}</b></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </CardBody>
    </Card>
  );
}

function Ledger() {
  const [filter, setFilter] = useState('');
  const id = filter.trim();
  const q = /^\d{17}$/.test(id) ? `?steamId=${id}` : '';
  const lines = useQuery({ queryKey: ['ledger', q], queryFn: () => getJson<{ lines: LedgerLine[] }>(`/api/economy/ledger${q}`), refetchInterval: 2000 }).data?.lines;
  return (
    <Card className={s.gap}>
      <CardHead title="Sổ giao dịch">
        <span className={s.filter}><TextInput aria-label="Lọc theo SteamID" inputMode="numeric" maxLength={17} className={s.mono} placeholder="Lọc theo SteamID" value={filter} onChange={(e) => setFilter(e.target.value)} /></span>
      </CardHead>
      <CardBody>
        {lines === undefined ? null : lines.length === 0 ? <p className={s.hint}>Chưa có giao dịch.</p> : (
          <div className={s.wrap}><table className={s.table}>
            <thead><tr><th>Lúc</th><th>Người chơi</th><th className={s.r}>Thay đổi</th><th className={s.r}>Còn</th><th>Lý do</th><th>Bởi</th></tr></thead>
            <tbody>{lines.map((l, i) => (
              <tr key={`${l.t}-${i}`}>
                <td className={`${s.muted} ${s.nowrap}`}>{new Date(l.t * 1000).toLocaleString('vi-VN', { hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{l.name ? <PlayerLink id={l.steamId} name={l.name} /> : <span className={s.mono}>{l.steamId}</span>}</td>
                <td className={`${s.r} ${l.delta > 0 ? s.plus : s.minus}`}><b>{l.delta > 0 ? '+' : ''}{vn(l.delta)}</b></td>
                <td className={s.r}>{vn(l.balance)}</td><td>{l.reason}</td><td className={s.muted}>{l.by ?? 'hệ thống'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </CardBody>
    </Card>
  );
}

function Shop() {
  const { access } = useSession();
  const edit = can(access, 'economy.edit');
  const f = useSettingsForm<ShopView, { listings: Listing[] }>('/api/shop', {
    label: 'Cửa hàng Hổ phách', href: '#quests', select: (r) => ({ listings: r.listings }), saved: 'Đã lưu cửa hàng.',
  });
  const items = f.latest?.items ?? [];
  const list = f.draft?.listings ?? null;
  const set = (fn: (l: Listing[]) => Listing[]): void => f.update((x) => ({ listings: fn(x.listings) }));
  const setOne = (i: number, p: Partial<Listing>): void => set((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Card className={s.gap}>
      <CardHead title="🏪 Cửa hàng Hổ phách" sub="người chơi mua ở trang Cửa hàng, vật phẩm vào Túi đồ; giới hạn tính theo người, mỗi ngày (00:00 giờ VN); 0 = không giới hạn" />
      <CardBody stack>
        <p className={s.hint}>Thứ tự ở đây là thứ tự trong cửa hàng (trong từng nhóm). Món tắt hoặc vật phẩm ngừng phát hành thì không hiện. Mỗi lần mua ghi vào Sổ giao dịch ("Mua N × tên"). Ai dùng được: <b>Thành viên → SVip → Mức phát hành chức năng</b> (Cửa hàng).</p>
        {list === null ? <span className={s.muted}>{f.error ? `Không tải được: ${f.error.message}` : 'Đang tải…'}</span> : <>
          <div className={s.list}>
            {list.length === 0 && <p className={s.hint}>Cửa hàng chưa có món nào. Bấm "+ Thêm món".</p>}
            {list.map((l, i) => (
              <div key={l.id ?? `new-${i}`} className={`${s.spRow}${l.enabled ? '' : ` ${s.off}`}`}>
                <div className={s.on}><Checkbox checked={l.enabled} disabled={!edit} onChange={(v) => setOne(i, { enabled: v })} label={<span className={s.onLbl}>Đang bán</span>} /></div>
                <label className={s.spItem}>Vật phẩm<Select aria-label="Vật phẩm" value={l.itemId} disabled={!edit}
                  options={[...(items.some((it) => it.id === l.itemId) ? [] : [{ value: l.itemId, label: `${l.itemId} (không còn)` }]),
                    ...items.map((it) => ({ value: it.id, label: `${TYPE_ICON[it.type] ?? ''} ${it.name}` }))]}
                  onChange={(v) => setOne(i, { itemId: v })} /></label>
                <label>Giá (Hổ phách)<NumberInput aria-label="Giá (Hổ phách)" min={1} max={1000000} value={l.price} disabled={!edit} onChange={(v) => setOne(i, { price: Math.round(v) })} /></label>
                <label>Mỗi người / ngày<NumberInput aria-label="Mỗi người / ngày" min={0} max={100} value={l.dailyLimit} disabled={!edit} onChange={(v) => setOne(i, { dailyLimit: Math.round(v) })} /></label>
                {edit ? <div className={s.btns}>
                  <Button variant="ghost" small title="Lên" disabled={i === 0} onClick={() => set((x) => moved(x, i, -1))}>↑</Button>
                  <Button variant="ghost" small title="Xuống" disabled={i === list.length - 1} onClick={() => set((x) => moved(x, i, 1))}>↓</Button>
                  <Button variant="ghost" small title="Bỏ khỏi cửa hàng" className={s.del} onClick={() => set((x) => x.filter((_, j) => j !== i))}>Xoá</Button>
                </div> : <span />}
              </div>
            ))}
          </div>
          <div className={s.foot}><span className={s.dirty}>{dirtyText(f.dirty)}</span>
            {edit && <>
              <Button variant="ghost" disabled={items.length === 0} onClick={() => set((x) => {
                const free = items.find((it) => !x.some((l) => l.itemId === it.id)) ?? items[0];
                return free ? [...x, { itemId: free.id, price: 100, dailyLimit: 1, enabled: true }] : x;
              })}>+ Thêm món</Button>
              <Button onClick={() => void f.save()} disabled={f.saving}>Lưu cửa hàng</Button></>}
          </div>
        </>}
      </CardBody>
      <FreshBar show={f.serverChanged} dirty={f.dirty} onReload={f.reload} />
    </Card>
  );
}

function DailyQuests() {
  const { access } = useSession();
  const edit = can(access, 'economy.edit');
  const f = useSettingsForm<QuestsView, QuestsView['settings']>('/api/quests', { label: 'Nhiệm vụ', href: '#quests', select: (r) => r.settings, saved: 'Đã lưu nhiệm vụ.' });
  const kinds = f.latest?.kinds ?? {};
  const d = f.draft;
  const setOne = (i: number, p: Partial<QuestDef>): void => f.update((x) => ({ ...x, defs: x.defs.map((q, j) => (j === i ? { ...q, ...p } : q)) }));
  const kindOptions = Object.entries(kinds).map(([k, v]) => ({ value: k, label: `${v.label} (${v.unit})` }));
  return (
    <Card className={s.gap}>
      <CardHead title="🎯 Nhiệm vụ hằng ngày / tuần" sub="mỗi người nhận ngẫu nhiên N nhiệm vụ ngày (đúng chế độ ăn của loài đang chơi) + 1 nhiệm vụ tuần; nhận thưởng trên trang chủ" />
      <CardBody stack>
        {d === null ? <span className={s.muted}>{f.error ? `Không tải được: ${f.error.message}` : 'Đang tải…'}</span> : <>
          <div className={s.fields} style={{ maxWidth: 360 }}>
            <label>Số nhiệm vụ ngày mỗi người<NumberInput aria-label="Số nhiệm vụ ngày mỗi người" min={0} max={10} value={d.perDay} disabled={!edit} onChange={(v) => f.set('perDay', Math.round(v))} /></label>
          </div>
          <p className={s.hint}>Tiến độ đo từ game: <b>phút chơi</b>, <b>sống liên tục không chết</b> (phút), <b>hạ dino</b> theo luật bảng kill (admin không tính), <b>lớn thêm</b> (%, không tính nhảy do gara / admin), <b>đi đường</b> (km, không tính dịch chuyển), <b>ghé địa danh / hồ có tên</b> (trong 100 m), <b>nhiệm vụ prime</b> xong. Đổi danh sách: người đã nhận nhiệm vụ hôm nay giữ nguyên tới hết ngày.</p>
          <div className={s.list}>
            {d.defs.length === 0 && <p className={s.hint}>Chưa có nhiệm vụ nào.</p>}
            {d.defs.map((q, i) => (
              <div key={q.id} className={`${s.qqRow}${q.enabled ? '' : ` ${s.off}`}`}>
                <div className={s.on} title="Bật / tắt"><Checkbox checked={q.enabled} disabled={!edit} onChange={(v) => setOne(i, { enabled: v })} label={<span className={s.hidden}>Bật nhiệm vụ</span>} /></div>
                <label className={s.wide}>Tên hiện cho người chơi<TextInput maxLength={80} value={q.label} disabled={!edit} onChange={(e) => setOne(i, { label: e.target.value })} /></label>
                <label className={s.wide}>Loại<Select aria-label="Loại" value={q.kind} options={kindOptions} disabled={!edit} onChange={(v) => setOne(i, { kind: v })} /></label>
                <label>Mục tiêu ({kinds[q.kind]?.unit ?? ''})<NumberInput aria-label="Mục tiêu" min={0.1} max={100000} step={0.1} value={q.target} disabled={!edit} onChange={(v) => setOne(i, { target: v })} /></label>
                <label>Thưởng<NumberInput aria-label="Thưởng" min={0} max={100000} value={q.reward} disabled={!edit} onChange={(v) => setOne(i, { reward: Math.round(v) })} /></label>
                <label>Dành cho<Select aria-label="Dành cho" value={q.diet} options={QQ_DIET} disabled={!edit} onChange={(v) => setOne(i, { diet: v })} /></label>
                <label>Theo<Select aria-label="Theo" value={q.period} options={QQ_PERIOD} disabled={!edit} onChange={(v) => setOne(i, { period: v })} /></label>
                {edit ? <Button variant="ghost" small title="Xoá nhiệm vụ" className={s.del} onClick={() => f.update((x) => ({ ...x, defs: x.defs.filter((_, j) => j !== i) }))}>Xoá</Button> : <span />}
              </div>
            ))}
          </div>
          <div className={s.foot}><span className={s.dirty}>{dirtyText(f.dirty)}</span>
            {edit && <>
              <Button variant="ghost" onClick={() => f.update((x) => ({ ...x, defs: [...x.defs, newQuest(x.defs)] }))}>+ Thêm nhiệm vụ</Button>
              <Button onClick={() => void f.save()} disabled={f.saving}>Lưu nhiệm vụ</Button></>}
          </div>
        </>}
      </CardBody>
      <FreshBar show={f.serverChanged} dirty={f.dirty} onReload={f.reload} />
    </Card>
  );
}
