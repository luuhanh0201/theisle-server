import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson } from '@isle/api';
import { Button, Card, CardBody, CardHead, NumberInput, Select, Switch, useToast } from '@isle/ui';
import { useConfirm } from '../../app/confirm';
import { can } from '../../app/nav';
import { useSession } from '../../app/session';
import { FreshBar } from '../settings-form/FreshBar';
import { useSettingsForm } from '../settings-form/useSettingsForm';
import { TYPE_ICON } from '../items/tickets/Tickets';
import s from './Quests.module.css';
import m from './Milestones.module.css';

/** bridge/src/milestones.ts as the panel reads it. */
export interface RewardItem { itemId: string; qty: number }
export interface MilestoneDef { id: string; players: number; amber: number; items: RewardItem[] }
export interface MilestoneSettings { enabled: boolean; holdMinutes: number; minPlayMinutes: number; defs: MilestoneDef[] }
interface MilestonesView {
  settings: MilestoneSettings; reached: Record<string, { at: number; online: number }>; claimedCount: Record<string, number>;
  online: number; held: Record<string, number>;
}
interface ItemLite { id: string; type: string; name: string; retired?: boolean }

const URL = '/api/milestones';
const when = (t: number): string => new Date(t * 1000).toLocaleString('vi-VN', { hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const mmss = (sec: number): string => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/** A new milestone: the first free id m<n>, twice the biggest one. */
export function newMilestone(defs: MilestoneDef[]): MilestoneDef {
  const players = Math.min(1000, Math.max(10, ...defs.map((d) => d.players * 2)));
  let id = `m${players}`;
  for (let n = 2; defs.some((d) => d.id === id); n++) id = `m${players}-${n}`;
  return { id, players, amber: 100, items: [] };
}

/**
 * Mốc online toàn server (owner, 2026-10-10): N players online at once, held some minutes, gives everyone
 * who has played enough minutes in all the milestone's reward, once each, on their home page.
 */
export function Milestones() {
  const { access } = useSession();
  const edit = can(access, 'economy.edit');
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const f = useSettingsForm<MilestonesView, MilestoneSettings>(URL, { label: 'Mốc online toàn server', href: '#quests', select: (r) => r.settings, saved: 'Đã lưu mốc online.' });
  const items = useQuery({ queryKey: ['/api/items'], queryFn: () => getJson<{ items: ItemLite[] }>('/api/items'), enabled: can(access, 'items.view'), staleTime: 30_000 }).data?.items ?? [];
  const d = f.draft;
  const v = f.latest;
  const usable = items.filter((i) => !i.retired && i.type !== 'dino');
  const itemOptions = (cur: string) => [
    ...(cur && !usable.some((i) => i.id === cur) ? [{ value: cur, label: items.find((i) => i.id === cur)?.name ?? `${cur} (không còn)` }] : []),
    ...usable.map((i) => ({ value: i.id, label: `${TYPE_ICON[i.type] ?? ''} ${i.name}` })),
  ];
  const setDef = (i: number, p: Partial<MilestoneDef>): void => f.update((x) => ({ ...x, defs: x.defs.map((q, j) => (j === i ? { ...q, ...p } : q)) }));
  const setItems = (i: number, fn: (l: RewardItem[]) => RewardItem[]): void => f.update((x) => ({ ...x, defs: x.defs.map((q, j) => (j === i ? { ...q, items: fn(q.items) } : q)) }));
  const reopen = (def: MilestoneDef): void => confirm({
    title: `Mở lại mốc ${def.players} người`, okLabel: 'Mở lại',
    body: <>Mốc trở về <b>chưa đạt</b>, server phải đạt lại mới phát quà. {v?.claimedCount[def.id] ?? 0} người đã nhận sẽ <b>nhận lại được</b> lần nữa khi đạt lại.</>,
    run: async (token) => {
      await adminFetch(`${URL}/reopen`, 'POST', token, { id: def.id });
      toast(`Đã mở lại mốc ${def.players} người.`);
      await qc.invalidateQueries({ queryKey: [URL] });
    },
  });
  const status = (def: MilestoneDef) => {
    const r = v?.reached[def.id];
    if (r) {
      return <span className={m.reached}>✓ Đạt {when(r.at)} ({r.online} người) · {v?.claimedCount[def.id] ?? 0} người đã nhận
        {edit && <> <Button variant="ghost" small onClick={() => reopen(def)}>Mở lại</Button></>}</span>;
    }
    const held = v?.held[def.id];
    return held !== undefined ? <span className={m.held}>Đang giữ {mmss(held)} / {d?.holdMinutes ?? 0} phút</span> : <span className={s.muted}>Chưa đạt</span>;
  };
  return (
    <Card className={s.gap}>
      <CardHead title="🏆 Mốc online toàn server" sub={`server đạt N người online cùng lúc, giữ liên tục vài phút: mọi người chơi đủ số phút nhận quà trên trang chủ, mỗi mốc 1 lần${v ? ` · đang online ${v.online}` : ''}`} />
      <CardBody stack>
        {d === null ? <span className={s.muted}>{f.error ? `Không tải được: ${f.error.message}` : 'Đang tải…'}</span> : <>
          <Switch checked={d.enabled} disabled={!edit} onChange={(on) => f.set('enabled', on)} label="Bật mốc online (tắt: trang chủ không hiện, không tính giờ giữ)" />
          <div className={s.fields} style={{ maxWidth: 520 }}>
            <label>Giữ liên tục (phút)<NumberInput aria-label="Giữ liên tục (phút)" min={0} max={180} value={d.holdMinutes} disabled={!edit} onChange={(x) => f.set('holdMinutes', Math.round(x))} /></label>
            <label>Phút chơi tối thiểu để nhận<NumberInput aria-label="Phút chơi tối thiểu để nhận" min={0} max={100000} value={d.minPlayMinutes} disabled={!edit} onChange={(x) => f.set('minPlayMinutes', Math.round(x))} /></label>
          </div>
          <p className={s.hint}>Đếm <b>mọi người đang trong game</b> (cả admin). Số người phải <b>không tụt dưới mốc</b> suốt thời gian giữ, tụt 1 lần là đếm lại từ đầu. Mỗi mốc đạt <b>1 lần duy nhất</b>; ai có tổng thời gian chơi đủ số phút (online lúc đạt hay không, kể cả người mới sau này) đều bấm Nhận được, không có hạn. Vật phẩm vào Túi đồ; skin người chơi đã có thì bỏ qua. Mỗi lần nhận ghi vào Sổ giao dịch và Nhật ký admin.</p>
          <div className={s.list}>
            {d.defs.length === 0 && <p className={s.hint}>Chưa có mốc nào.</p>}
            {d.defs.map((def, i) => (
              <div key={def.id} className={m.row}>
                <div className={m.head}>
                  <label>Số người cùng lúc<NumberInput aria-label="Số người cùng lúc" min={1} max={1000} value={def.players} disabled={!edit} onChange={(x) => setDef(i, { players: Math.round(x) })} /></label>
                  <label>Hổ phách<NumberInput aria-label="Hổ phách" min={0} max={1000000} value={def.amber} disabled={!edit} onChange={(x) => setDef(i, { amber: Math.round(x) })} /></label>
                  <div className={m.status}>{status(def)}</div>
                  {edit ? <Button variant="ghost" small title="Xoá mốc" className={s.del} onClick={() => f.update((x) => ({ ...x, defs: x.defs.filter((_, j) => j !== i) }))}>Xoá</Button> : <span />}
                </div>
                {def.items.map((it, k) => (
                  <div key={k} className={m.item}>
                    <label className={m.itemPick}>Vật phẩm<Select aria-label="Vật phẩm" value={it.itemId} options={itemOptions(it.itemId)} disabled={!edit}
                      onChange={(x) => setItems(i, (l) => l.map((y, j) => (j === k ? { ...y, itemId: x } : y)))} /></label>
                    <label>Số lượng<NumberInput aria-label="Số lượng" min={1} max={20} value={it.qty} disabled={!edit}
                      onChange={(x) => setItems(i, (l) => l.map((y, j) => (j === k ? { ...y, qty: Math.round(x) } : y)))} /></label>
                    {edit ? <Button variant="ghost" small className={s.del} onClick={() => setItems(i, (l) => l.filter((_, j) => j !== k))}>Bỏ</Button> : <span />}
                  </div>
                ))}
                {edit && def.items.length < 10 && (
                  <div><Button variant="ghost" small disabled={usable.length === 0}
                    onClick={() => setItems(i, (l) => [...l, { itemId: usable[0]?.id ?? '', qty: 1 }])}>+ Vật phẩm</Button></div>
                )}
              </div>
            ))}
          </div>
          <div className={s.foot}><span className={s.dirty}>{f.dirty ? '● Có thay đổi chưa lưu' : 'Đã lưu'}</span>
            {edit && <>
              <Button variant="ghost" disabled={d.defs.length >= 20} onClick={() => f.update((x) => ({ ...x, defs: [...x.defs, newMilestone(x.defs)] }))}>+ Thêm mốc</Button>
              <Button onClick={() => void f.save()} disabled={f.saving}>Lưu mốc online</Button></>}
          </div>
        </>}
      </CardBody>
      <FreshBar show={f.serverChanged} dirty={f.dirty} onReload={f.reload} />
    </Card>
  );
}
