import type { ReactNode } from 'react';
import { Button, Card, CardBody, CardHead, Checkbox, NumberInput, Select, TextInput } from '@isle/ui';
import { can } from '../../../app/nav';
import { useSession } from '../../../app/session';
import { EditorActions, ItemRow, OwnerRow, OwnersBox, Retired, useOwners, useRevoke } from '../ItemParts';
import { byPlayer, useItems, type Item } from '../items';
import { useItemEditor } from '../useItemEditor';
import s from '../Items.module.css';
import t from './Tickets.module.css';

export const TKT_TYPES: Record<string, string> = {
  mutation_ticket: '🎟️ Phiếu đổi mutation', mutation_clear: '🧹 Phiếu bỏ mutation', prime_ticket: '👑 Phiếu Prime',
  dino_box: '🎁 Hộp dino', growth_bag: '🌱 Túi tăng trưởng', food_box: '🍖 Hộp food', salt_lick: '🧂 Đá muối', loot_box: '🏺 Hòm',
};
const TYPE_OPTIONS = [
  ['mutation_ticket', '🎟️ Phiếu đổi mutation'], ['mutation_clear', '🧹 Phiếu bỏ mutation'], ['prime_ticket', '👑 Phiếu Prime'], ['dino_box', '🎁 Hộp dino'],
  ['growth_bag', '🌱 Túi tăng trưởng'], ['food_box', '🍖 Hộp food'], ['salt_lick', '🧂 Đá muối'], ['loot_box', '🏺 Hòm (mở ra ngẫu nhiên)'],
].map(([value, label]) => ({ value: value as string, label: label as string }));
/** The shop's icons by type (Nhiệm vụ → Cửa hàng), for a hòm's prizes. */
export const TYPE_ICON: Record<string, string> = { mutation: '🧬', mutation_ticket: '🎟️', mutation_clear: '🧹', prime_ticket: '👑', dino_box: '🎁', growth_bag: '🌱', food_box: '🍖', salt_lick: '🧂', skin: '🎨' };
/** A new item's data, by type (items.ts defaults). */
export function dataFor(type: string, rarity: string): Record<string, any> {
  if (type === 'mutation_ticket') return { maxRarity: rarity === 'special' ? 'special' : rarity };
  if (type === 'loot_box') return { pool: [] };
  if (type === 'dino_box') return { pick: 'random', growthMin: 0.5, growthMax: 1, quest: false };
  if (type === 'growth_bag') return { amount: 0.1, below: 0.6 };
  if (type === 'food_box') return { amount: 0.2 };
  return {};
}
const INFO: Record<string, ReactNode> = {
  mutation_ticket: <>Người chơi tự chọn một mutation khi dùng: mọi mutation còn trong game, đúng chế độ ăn của loài. Phiếu <b>Đặc biệt</b> đổi được cả mutation nhiệm vụ; độ hiếm khác chỉ để hiển thị. Chỉ vào ô đã mở theo tăng trưởng như game (ô 1 từ 25%, ô 2 từ 50%, ô 3–4 từ 75%).</>,
  mutation_clear: <>Bỏ mutation ở một ô (1–4) để người chơi chọn lại trong game.</>,
  prime_ticket: <>Dino 100% chưa prime: dùng là lên prime (đủ 10 điều kiện, chỉ số prime sau vài giây). Dùng cho trường hợp lỡ prime.</>,
  dino_box: <>Người chơi <b>mở hộp</b>: loài <b>ngẫu nhiên</b> (có hiệu ứng roll) hoặc <b>tự chọn</b>, tăng trưởng bốc ngẫu nhiên trong khoảng dưới, ra <b>vật phẩm Dino</b> trong túi. Dùng vật phẩm Dino: chọn giới tính và mutation (ô mở theo tăng trưởng như game: ô 1 từ 25%, ô 2 từ 50%, ô 3–4 từ 75%; đúng chế độ ăn, ô 2/4, mutation chỉ con cái). Dino vào <b>gara</b> với <b>đủ 10 nhiệm vụ prime</b>. Quà tân thủ <span className={t.mono}>starter_box</span> (hộp tự chọn) được nhận ở trang chủ, mỗi tài khoản 1 lần. Ai dùng được: <b>Thành viên → SVip → Mức phát hành chức năng</b> (Hộp dino).</>,
  loot_box: <>Người chơi <b>mở hòm</b> (có hiệu ứng quay kiểu gacha) và nhận <b>1 phần thưởng</b> bốc ngẫu nhiên theo trọng số bên dưới; người chơi xem được tỉ lệ từng món trước khi mở. Hòm không chứa hòm khác. Bán ở cửa hàng: Nhiệm vụ → Cửa hàng Hổ phách. Túi admin mở không mất hòm.</>,
  salt_lick: <>Dùng lên dino <b>đang chơi</b>: hết trạng thái ốm sau khi nôn (hàm game <span className={t.mono}>ResetVomitSickState</span>, như nút Hồi máu của admin). Không hồi máu / thức ăn / nước. Người chơi thấy: “Một khối khoáng mặn hiếm thấy trên đảo. Liếm vài lần, dạ dày dịu lại ngay”.</>,
  growth_bag: <>Dùng lên dino <b>đang chơi</b>: cộng thêm tăng trưởng, chỉ khi dino dưới mốc (vd +10% khi dưới 60%: 55% → 65%; mốc 100% = mọi dino chưa trưởng thành). Chỉ số giữ theo tỉ lệ. Vật phẩm chỉ mất khi game xác nhận.</>,
  food_box: <>Dùng lên dino <b>đang chơi</b>: thanh thức ăn cộng thêm (tối đa đầy), chống đói, <b>không tăng chất dinh dưỡng</b>. Dino đang no: vật phẩm vẫn còn.</>,
};
interface Draft { type: string; name: string; rarity: string; data: Record<string, any> }
interface Prize { itemId: string; qty: number; weight: number }
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** Each prize's chance: its weight over the sum, "12.5%". */
export const chanceOf = (pool: Prize[], i: number): string => {
  const sum = pool.reduce((n, e) => n + (Number(e.weight) || 0), 0);
  return sum ? `${(((Number(pool[i]?.weight) || 0) / sum) * 100).toFixed(1)}%` : '-';
};

/** Vật phẩm → Phiếu & hộp (items.ts mutation_ticket / mutation_clear / prime_ticket / dino_box / growth_bag / food_box / salt_lick / loot_box). */
export function Tickets() {
  const { access } = useSession();
  const data = useItems().data;
  const all = (data?.items ?? []).filter((i) => TKT_TYPES[i.type]);
  const ed = useItemEditor<Draft>('ticket', data?.items, {
    what: 'Phiếu',
    first: (items) => items.find((i) => TKT_TYPES[i.type]),
    toDraft: (i) => ({ type: i.type, name: i.name, rarity: i.rarity, data: structuredClone(i.data) }),
    fresh: () => ({ type: 'mutation_ticket', name: '', rarity: 'rare', data: { maxRarity: 'rare' } }),
  });
  const edit = can(access, 'items.edit');
  const grant = can(access, 'items.grant');
  const owners = useOwners(ed.sel).data?.owners ?? [];
  const people = byPlayer(owners);
  const revoke = useRevoke(ed.sel);
  const rarities = data?.rarities ?? [];
  const d = ed.draft;
  const set = (fn: (x: Draft) => Draft): void => ed.setDraft(fn);
  const setData = (p: Record<string, unknown>): void => set((x) => ({ ...x, data: { ...x.data, ...p } }));
  const ticket = d?.type === 'mutation_ticket';
  const pool: Prize[] = (d?.data['pool'] as Prize[] | undefined) ?? [];
  const choices = (data?.items ?? []).filter((i) => i.type !== 'loot_box' && i.type !== 'dino' && !i.retired);
  const sum = pool.reduce((n, e) => n + (Number(e.weight) || 0), 0);
  const setPrize = (i: number, p: Partial<Prize>): void => setData({ pool: pool.map((e, j) => (j === i ? { ...e, ...p } : e)) });

  const save = (): void => {
    if (!d) return;
    const name = d.name.trim() ? d.name : (TKT_TYPES[d.type] ?? '').replace(/^\S+\s/, '');
    void ed.save({ ...d, name }, ed.sel, 'Đã lưu phiếu');
  };
  return (
    <div className={s.layout}>
      <Card>
        <CardHead title="Phiếu & hộp" sub={`${all.length} phiếu`}>
          {edit && <Button variant="soft" small className={s.headBtn} onClick={() => ed.select(null)}>+ Tạo mới</Button>}
        </CardHead>
        <CardBody>
          <div className={s.list}>
            {all.length === 0 && <div className={s.empty}>Chưa có phiếu nào, bấm “+ Phiếu mới”.</div>}
            {all.map((i: Item) => (
              <ItemRow key={i.id} item={i} rarities={rarities} on={i.id === ed.sel} onPick={() => ed.select(i.id)}
                sub={<span className={s.sub}>{TKT_TYPES[i.type]} · {i.owners} cái trong kho<Retired item={i} /></span>} />
            ))}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHead title={ed.item ? ed.item.name : 'Phiếu mới'} sub={ed.item ? `${ed.item.id}${ed.item.retired ? ' · ngừng phát hành' : ''}` : 'chưa lưu'} />
        <CardBody>
          {d && (
            <div className={s.body}>
              <div className={s.fields}>
                {/* An item keeps its type. */}
                <label>Loại<Select aria-label="Loại" value={d.type} options={TYPE_OPTIONS} disabled={!edit || ed.item !== null}
                  onChange={(v) => set((x) => ({ ...x, type: v, rarity: v !== 'mutation_ticket' && x.rarity === 'special' ? 'legendary' : x.rarity, data: dataFor(v, x.rarity) }))} /></label>
                <label>Tên<TextInput maxLength={60} placeholder="vd: Phiếu đổi mutation Hiếm" value={d.name} disabled={!edit} onChange={(e) => set((x) => ({ ...x, name: e.target.value }))} /></label>
                <label>{ticket ? 'Độ hiếm (Đặc biệt = cả mutation nhiệm vụ)' : 'Độ hiếm'}
                  <Select aria-label="Độ hiếm" value={ticket ? String(d.data['maxRarity']) : d.rarity} disabled={!edit}
                    options={rarities.filter((r) => ticket || r.key !== 'special').map((r) => ({ value: r.key, label: r.label }))}
                    onChange={(v) => set((x) => ({ ...x, rarity: v, data: x.type === 'mutation_ticket' ? { ...x.data, maxRarity: v } : x.data }))} /></label>
              </div>
              {d.type === 'dino_box' && (
                <div className={s.fields}>
                  <label>Loài<Select aria-label="Loài" value={String(d.data['pick'] ?? 'choose')} disabled={!edit}
                    options={[{ value: 'random', label: 'Ngẫu nhiên (roll khi mở)' }, { value: 'choose', label: 'Người chơi tự chọn khi mở' }]} onChange={(v) => setData({ pick: v })} /></label>
                  <label>Tăng trưởng thấp nhất (%)<NumberInput aria-label="Tăng trưởng thấp nhất (%)" min={25} max={100} value={Math.round(Number(d.data['growthMin']) * 100)} disabled={!edit}
                    onChange={(v) => setData({ growthMin: clamp(v / 100, 0.25, 1) })} /></label>
                  <label>Tăng trưởng cao nhất (%)<NumberInput aria-label="Tăng trưởng cao nhất (%)" min={25} max={100} value={Math.round(Number(d.data['growthMax']) * 100)} disabled={!edit}
                    onChange={(v) => setData({ growthMax: clamp(v / 100, 0.25, 1) })} /></label>
                  <div className={s.check}><Checkbox checked={d.data['quest'] === true} disabled={!edit} onChange={(v) => setData({ quest: v })} label="Cho chọn cả mutation nhiệm vụ" /></div>
                </div>
              )}
              {d.type === 'loot_box' && (
                <div className={t.loot}>
                  <div className={t.lootHead}><h3>Phần thưởng trong hòm</h3>
                    <span className={s.hint}>tỉ lệ = trọng số / tổng trọng số; skin người chơi đã có thì bị bỏ khỏi lượt mở của họ</span></div>
                  <div className={t.prizes}>
                    {pool.length === 0 && <p className={s.hint} style={{ margin: 0 }}>Chưa có phần thưởng. Bấm "+ Thêm phần thưởng".</p>}
                    {pool.map((e, i) => (
                      <div key={i} className={t.prize}>
                        <label className={t.item}>Vật phẩm<Select aria-label="Vật phẩm" value={e.itemId} disabled={!edit}
                          options={[...(choices.some((c) => c.id === e.itemId) ? [] : [{ value: e.itemId ?? '', label: `${e.itemId ?? 'chọn'} (không còn)` }]),
                            ...choices.map((c) => ({ value: c.id, label: `${TYPE_ICON[c.type] ?? ''} ${c.name}` }))]}
                          onChange={(v) => setPrize(i, { itemId: v })} /></label>
                        <label>Số lượng<NumberInput aria-label="Số lượng" min={1} max={10} value={e.qty ?? 1} disabled={!edit} onChange={(v) => setPrize(i, { qty: Math.round(v) })} /></label>
                        <label>Trọng số<NumberInput aria-label="Trọng số" min={1} max={100000} value={e.weight ?? 1} disabled={!edit} onChange={(v) => setPrize(i, { weight: Math.round(v) })} /></label>
                        <label>Tỉ lệ<span className={t.pct}>{chanceOf(pool, i)}</span></label>
                        {edit ? <div className={t.btns}><Button variant="ghost" small className={t.del} onClick={() => setData({ pool: pool.filter((_, j) => j !== i) })}>Xoá</Button></div> : <span />}
                      </div>
                    ))}
                  </div>
                  <div className={t.addRow}>
                    {edit && <Button variant="ghost" onClick={() => {
                      const first = choices[0];
                      if (!first) return;
                      setData({ pool: [...pool, { itemId: first.id, qty: 1, weight: 10 }] });
                    }} disabled={choices.length === 0} title={choices.length === 0 ? 'Chưa có vật phẩm nào để cho vào hòm' : undefined}>+ Thêm phần thưởng</Button>}
                    <span className={s.muted} style={{ fontSize: 12.5 }}>{pool.length ? `${pool.length} món · tổng trọng số ${sum}` : ''}</span>
                  </div>
                </div>
              )}
              {(d.type === 'growth_bag' || d.type === 'food_box') && (
                <div className={s.fields}>
                  <label>{d.type === 'growth_bag' ? 'Tăng trưởng cộng thêm (%)' : 'Thức ăn cộng thêm (%)'}
                    <NumberInput aria-label="Cộng thêm (%)" min={1} max={100} value={Math.round(Number(d.data['amount']) * 100)} disabled={!edit}
                      onChange={(v) => setData({ amount: clamp(v / 100, 0.01, d.type === 'growth_bag' ? 0.5 : 1) })} /></label>
                  {d.type === 'growth_bag' && <label>Chỉ dùng khi dino dưới (%)
                    <NumberInput aria-label="Chỉ dùng khi dino dưới (%)" min={10} max={100} value={Math.round(Number(d.data['below']) * 100)} disabled={!edit}
                      onChange={(v) => setData({ below: clamp(v / 100, 0.1, 1) })} /></label>}
                </div>
              )}
              <div className={s.hint}>{INFO[d.type]}</div>
              <EditorActions edit={edit} item={ed.item} dirty={ed.dirty} sel={ed.sel} onRetire={ed.retire} onSave={save} saveLabel="Lưu phiếu" />
              {ed.item && (
                <OwnersBox itemId={ed.item.id} count={`(${people.length} người · ${owners.length} cái)`} grantLabel="Tặng 1 phiếu"
                  granted="Đã tặng 1 phiếu vào kho người chơi" notePlaceholder="Ghi chú (vd: đền bù lỗi gara)">
                  {people.length === 0 ? <div className={s.muted} style={{ fontSize: 13 }}>Chưa ai có phiếu này.</div>
                    : people.map((o) => (
                      <OwnerRow key={o.steamId} o={o} n={o.n} showSource={false} actions={grant && (
                        <Button variant="danger" small onClick={() => revoke(o.steamId, 'Thu hồi phiếu?',
                          <>Lấy hết <b>{o.n}</b> phiếu <b>{d.name}</b> khỏi kho của <b>{o.name ?? o.steamId}</b>.</>)}>Thu hồi hết</Button>)} />
                    ))}
                </OwnersBox>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
