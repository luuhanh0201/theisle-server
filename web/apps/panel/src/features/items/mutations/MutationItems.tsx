import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { adminFetch } from '@isle/api';
import { Button, Card, CardBody, CardHead, Select, TextInput, useToast } from '@isle/ui';
import { can } from '../../../app/nav';
import { useSession } from '../../../app/session';
import { MutIcon } from '../../../components/dino/Mutations';
import { EditorActions, ItemRow, OwnerRow, OwnersBox, Retired, useOwners, useRevoke } from '../ItemParts';
import { ITEMS_URL, byPlayer, useItems, type Item, type MutationRef } from '../items';
import { useItemEditor } from '../useItemEditor';
import s from '../Items.module.css';

export const MIT_DIET: Record<string, string> = { all: 'Mọi loài', carnivore: 'Ăn thịt', herbivore: 'Ăn cỏ', herbivore_omnivore: 'Ăn cỏ / ăn tạp' };
interface Draft { type: 'mutation'; name: string; rarity: string; data: { mutation: string } }

/** A quest mutation is always special; another may not be (items.ts withRarity). */
export function fixRarity(d: Draft, ref: MutationRef | null): Draft {
  const quest = ref?.kind === 'unlock';
  if (quest && d.rarity !== 'special') return { ...d, rarity: 'special' };
  if (!quest && d.rarity === 'special') return { ...d, rarity: 'legendary' };
  return d;
}

/** Vật phẩm → Mutation (items.ts type 'mutation'; players use one from Túi đồ, mods/DinoGarage garage/mutation.lua). */
export function MutationItems() {
  const { access, withToken } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const data = useItems().data;
  const all = (data?.items ?? []).filter((i) => i.type === 'mutation');
  const quest = (data?.mutations ?? []).filter((m) => m.kind === 'unlock');
  const refOf = (name: string | undefined): MutationRef | null => (data?.mutations ?? []).find((m) => m.name === name) ?? null;
  const ed = useItemEditor<Draft>('mutation', data?.items, {
    what: 'Mutation',
    first: (items) => items.find((i) => i.type === 'mutation'),
    toDraft: (i) => ({ type: 'mutation', name: i.name, rarity: i.rarity, data: { mutation: String(i.data['mutation']) } }),
    fresh: () => ({ type: 'mutation', name: '', rarity: 'special', data: { mutation: quest[0]?.name ?? '' } }),
  });
  const [q, setQ] = useState('');
  const edit = can(access, 'items.edit');
  const grant = can(access, 'items.grant');
  const owners = useOwners(ed.sel).data?.owners ?? [];
  const people = byPlayer(owners);
  const revoke = useRevoke(ed.sel);
  const [slots, setSlots] = useState<Record<string, string>>({});
  const d = ed.draft;
  const ref = refOf(d?.data.mutation);
  const isQuest = ref?.kind === 'unlock';
  const rarities = data?.rarities ?? [];
  const shown = all.filter((i) => { const n = q.trim().toLowerCase(); return !n || i.name.toLowerCase().includes(n) || String(i.data['mutation']).toLowerCase().includes(n); });
  // Only the quest mutations are items (2026-10-02): the others come from a Phiếu đổi mutation.
  const options = Object.entries(MIT_DIET).flatMap(([diet, label]) => quest.filter((m) => m.diet === diet).sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => ({ value: m.name, label: `${m.name} (nhiệm vụ)`, group: label })));
  const slotList = ed.item?.data['slot2'] ? [2, 4] : [1, 2, 3, 4];

  const use = (steamId: string): void => {
    const slot = Number(slots[steamId] ?? slotList[0]);
    void withToken('dùng mutation', async (token) => {
      await adminFetch(`${ITEMS_URL}/${ed.sel}/apply`, 'POST', token, { steamId, slot });
      toast(`Đã gửi vào game (ô ${slot}), kho trừ 1 khi game xác nhận`);
      setTimeout(() => { void qc.invalidateQueries({ queryKey: [ITEMS_URL] }); void qc.invalidateQueries({ queryKey: [`${ITEMS_URL}/${ed.sel}/owners`] }); }, 6000);
    });
  };
  const save = (): void => {
    if (!d) return;
    const body = fixRarity({ ...d, name: d.name.trim() ? d.name : d.data.mutation }, ref);
    void ed.save(body, ed.sel, 'Đã lưu mutation');
  };
  return (
    <div className={s.layout}>
      <Card>
        <CardHead title="Mutation" sub={`${all.length} mutation`}>
          {edit && <Button variant="soft" small className={s.headBtn} onClick={() => ed.select(null)}>+ Mutation mới</Button>}
        </CardHead>
        <CardBody stack>
          <TextInput type="search" aria-label="Tìm mutation" placeholder="Tìm tên, mutation…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className={s.list}>
            {shown.length === 0 && <div className={s.empty}>{q ? 'Không có mutation nào khớp' : 'Chưa có mutation nào, bấm “+ Mutation mới”.'}</div>}
            {shown.map((i: Item) => (
              <ItemRow key={i.id} item={i} rarities={rarities} on={i.id === ed.sel} onPick={() => ed.select(i.id)} top={<MutIcon name={String(i.data['mutation'])} md />}
                sub={<span className={s.sub}>{String(i.data['mutation'])} · {MIT_DIET[String(i.data['diet'])] ?? String(i.data['diet'] ?? '')} · {i.owners} cái trong kho<Retired item={i} /></span>} />
            ))}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHead title={ed.item ? ed.item.name : 'Mutation mới'} sub={ed.item ? `${ed.item.id}${ed.item.retired ? ' · ngừng phát hành' : ''}` : 'chưa lưu'} />
        <CardBody>
          {d && (
            <div className={s.body}>
              <div className={s.fields}>
                <label>Tên vật phẩm<TextInput maxLength={60} placeholder="vd: Hồi máu nhanh" value={d.name} disabled={!edit} onChange={(e) => ed.setDraft((x) => ({ ...x, name: e.target.value }))} /></label>
                <label>Mutation<Select aria-label="Mutation" value={d.data.mutation} options={options} disabled={!edit}
                  onChange={(v) => ed.setDraft((x) => {
                    // A new item named after its mutation until the admin types a name.
                    const name = !x.name || x.name === refOf(x.data.mutation)?.name ? v : x.name;
                    return fixRarity({ ...x, name, data: { mutation: v } }, refOf(v));
                  })} /></label>
                <label>Độ hiếm<Select aria-label="Độ hiếm" value={fixRarity(d, ref).rarity} disabled={isQuest || !edit}
                  options={rarities.filter((r) => r.pickable || isQuest).map((r) => ({ value: r.key, label: `${r.label}${r.pickable ? '' : ' (mutation nhiệm vụ)'}` }))}
                  onChange={(v) => ed.setDraft((x) => ({ ...x, rarity: v }))} /></label>
              </div>
              {ref && (
                <div className={s.info}>
                  <MutIcon name={ref.name} lg /><b>{ref.name}</b>, {ref.description}<br />
                  Chế độ ăn: <b>{MIT_DIET[ref.diet] ?? ref.diet}</b>{ref.kind === 'slot2' && <> · chỉ đặt ở <b>ô 2 hoặc 4</b></>}
                  {ref.kind === 'unlock' && ` · mutation nhiệm vụ (mod tự mở khoá trước khi gắn${ref.unlock ? `; trong game: ${ref.unlock}` : ''})`}
                  {ref.femaleOnly && ' · chỉ có tác dụng với con cái'}{ref.status === 'test' && <> · <span className={s.kill}>đang thử nghiệm trong game</span></>}
                  {isQuest && <><br />Độ hiếm: <b>Đặc biệt</b>, cố định cho mutation nhiệm vụ.</>}
                  <br />{ref.tiers ? `Mức theo đời${ref.stat ? ` (${ref.stat})` : ''}: ${ref.tiers} (theo đời của cả dino)` : 'Không có số liệu theo đời.'}
                  <div style={{ clear: 'both' }} />
                </div>
              )}
              <div className={s.hint}>Người chơi chọn ô 1–4 trên dino đang chơi (hộp so sánh chỉ số mutation đang ở ô đó với mutation mới), dùng xong vật phẩm mất, mutation ở lại trên con đó.
                Dino đã có mutation này ở ô chính thì bị từ chối, vật phẩm giữ nguyên (nâng cấp riêng một mutation đang thử nghiệm trên server test).
                Chỉ dùng được khi đúng chế độ ăn của loài. Độ hiếm: admin chọn Thường → Huyền thoại; mutation nhiệm vụ luôn là <b>Đặc biệt</b>.</div>
              <EditorActions edit={edit} item={ed.item} dirty={ed.dirty} sel={ed.sel} onRetire={ed.retire} onSave={save} saveLabel="Lưu mutation" />
              {ed.item && (
                <OwnersBox itemId={ed.item.id} count={`(${people.length} người · ${owners.length} cái)`} grantLabel="Tặng 1 cái vào kho"
                  granted="Đã tặng 1 mutation vào kho người chơi" notePlaceholder="Ghi chú (vd: quà sự kiện)">
                  {people.length === 0 ? <div className={s.muted} style={{ fontSize: 13 }}>Chưa ai có mutation này trong kho.</div>
                    : people.map((o) => (
                      <OwnerRow key={o.steamId} o={o} n={o.n} actions={grant && <>
                        <span className={s.slotSel}><Select aria-label="Ô mutation" value={slots[o.steamId] ?? String(slotList[0])} options={slotList.map((n) => ({ value: String(n), label: `Ô ${n}` }))}
                          onChange={(v) => setSlots((x) => ({ ...x, [o.steamId]: v }))} /></span>
                        <Button variant="ghost" small title="Dùng 1 cái trong kho người đó lên dino họ đang chơi, như người chơi tự dùng (đúng chế độ ăn, đang online)" onClick={() => use(o.steamId)}>Dùng lên dino</Button>
                        <Button variant="danger" small onClick={() => revoke(o.steamId, 'Thu hồi mutation?',
                          <>Lấy hết <b>{o.n}</b> cái <b>{d.name}</b> khỏi kho của <b>{o.name ?? o.steamId}</b>. Mutation đã gắn lên dino không đổi.</>)}>Thu hồi hết</Button>
                      </>} />
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
