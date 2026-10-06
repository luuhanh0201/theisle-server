import { useMemo, useState } from 'react';
import { adminFetch } from '@isle/api';
import { Button, Card, CardBody, CardHead, Select, Slider, TextInput, useToast } from '@isle/ui';
import { DEFAULT_COLORS, REGIONS, hex, lightSlider, lightText, linearOf, type LinearColor } from '@portal/skin-editor';
import { can } from '../../../app/nav';
import { useSession } from '../../../app/session';
import { EditorActions, ItemRow, OwnerRow, OwnersBox, Retired, useOwners, useRevoke } from '../ItemParts';
import { ITEMS_URL, useItems, type Item } from '../items';
import { useItemEditor } from '../useItemEditor';
import { SkinPresets, SkinRegions, factorOf } from './SkinEditor';
import { Viewer3D, useDino3D, type SkinPreview } from './Viewer3D';
import s from '../Items.module.css';
import k from './Skins.module.css';

interface SkinData { species: string; colors: Record<string, LinearColor>; light: Record<string, number>; brightness: number; pattern: unknown; theme: unknown; variation: unknown }
interface Draft { type: 'skin'; name: string; rarity: string; data: SkinData }

/** Regions past what the game takes (each channel at most × 4 of 1): the rest is lost. */
export function overLimit(d: SkinData): string[] {
  return REGIONS.filter(([id]) => {
    const c = d.colors[id] ?? DEFAULT_COLORS[id] as LinearColor;
    return Math.max(c.r, c.g, c.b) * (d.light[id] ?? 1) * d.brightness > 4.001;
  }).map(([, label]) => label);
}
export const previewOf = (d: SkinData, female: boolean): SkinPreview => ({
  colors: Object.fromEntries(REGIONS.map(([id]) => [id, hex(d.colors[id] ?? DEFAULT_COLORS[id])])), light: d.light, brightness: d.brightness, female,
});

/** Vật phẩm → Skin dino (bridge/src/items.ts): the skins, one edited with its 3D preview, who owns it. */
export function Skins() {
  const { access, withToken } = useSession();
  const toast = useToast();
  const data = useItems().data;
  const d3 = useDino3D();
  const species = d3.api?.species() ?? [];
  const skins = (data?.items ?? []).filter((i) => i.type === 'skin');
  const [species0] = species;
  const ed = useItemEditor<Draft>('skin', data?.items, {
    what: 'Skin',
    first: (items) => items.find((i) => i.type === 'skin'),
    toDraft: (i) => ({ type: 'skin', name: i.name, rarity: i.rarity, data: structuredClone(i.data) as SkinData }),
    fresh: () => ({ type: 'skin', name: '', rarity: 'common', data: { species: species0 ?? 'Carnotaurus', colors: structuredClone(DEFAULT_COLORS), light: {}, brightness: 1, pattern: null, theme: null, variation: null } }),
  });
  const [q, setQ] = useState('');
  const [female, setFemale] = useState(false);
  const edit = can(access, 'items.edit');
  const grant = can(access, 'items.grant');
  const owners = useOwners(ed.sel).data?.owners ?? [];
  const revoke = useRevoke(ed.sel);
  const rarities = data?.rarities ?? [];
  const d = ed.draft;
  const setData = (fn: (x: SkinData) => SkinData): void => ed.setDraft((x) => ({ ...x, data: fn(x.data) }));
  const preview = useMemo(() => (d ? previewOf(d.data, female) : null), [d, female]);
  const n = q.trim().toLowerCase();
  const shown = skins.filter((i) => !n || i.name.toLowerCase().includes(n) || String(i.data['species']).toLowerCase().includes(n));
  const over = d ? overLimit(d.data) : [];
  const apply = (steamId: string): void => {
    void withToken('áp skin', async (token) => {
      await adminFetch(`${ITEMS_URL}/${ed.sel}/apply`, 'POST', token, { steamId });
      toast('Đã gửi skin vào game, đổi màu sau vài giây');
    });
  };
  const speciesOptions = [...species, ...(d && !species.includes(d.data.species) ? [d.data.species] : [])].map((x) => ({ value: x, label: x }));
  const [bt, bcls] = lightText(d?.data.brightness ?? 1);

  return (
    <div className={s.layout}>
      <Card>
        <CardHead title="Skin dino" sub={`${skins.length} skin`}>
          {edit && <Button variant="soft" small className={s.headBtn} onClick={() => ed.select(null)}>+ Skin mới</Button>}
        </CardHead>
        <CardBody stack>
          <TextInput type="search" aria-label="Tìm skin" placeholder="Tìm tên, loài…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className={s.list}>
            {shown.length === 0 && <div className={s.empty}>{q ? 'Không có skin nào khớp' : 'Chưa có skin nào, bấm “+ Skin mới”.'}</div>}
            {shown.map((i: Item) => (
              <ItemRow key={i.id} item={i} rarities={rarities} on={i.id === ed.sel} onPick={() => ed.select(i.id)}
                sub={<span className={s.top}><span className={s.sw}>{['Body', 'Flank', 'Underbelly', 'Markings', 'Eyes'].filter((x) => i.data['colors']?.[x]).map((x) => <i key={x} style={{ background: hex(i.data['colors'][x]) }} />)}</span>
                  <span className={s.sub}>{String(i.data['species'])} · {i.owners} người có<Retired item={i} /></span></span>} />
            ))}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHead title={ed.item ? ed.item.name : 'Skin mới'} sub={ed.item ? `${ed.item.id}${ed.item.retired ? ' · ngừng phát hành' : ''}` : 'chưa lưu'} />
        <CardBody>
          {d && preview && (
            <div className={s.body}>
              <div className={s.fields}>
                <label>Tên skin<TextInput maxLength={60} placeholder="vd: Hắc Long" value={d.name} disabled={!edit} onChange={(e) => ed.setDraft((x) => ({ ...x, name: e.target.value }))} /></label>
                <label>Loài<Select aria-label="Loài" value={d.data.species} options={speciesOptions} disabled={!edit} onChange={(v) => setData((x) => ({ ...x, species: v }))} /></label>
                <label>Độ hiếm<Select aria-label="Độ hiếm" value={d.rarity} options={rarities.filter((r) => r.pickable).map((r) => ({ value: r.key, label: r.label }))} disabled={!edit}
                  onChange={(v) => ed.setDraft((x) => ({ ...x, rarity: v }))} /></label>
              </div>
              <div className={k.editor}>
                <div>
                  <Viewer3D api={d3.api} loaded={d3.loaded} species={d.data.species} skin={preview} className={k.view ?? ''} noteClass={k.note ?? ''}>
                    <div className={k.sex}>
                      <button type="button" className={female ? undefined : k.on} onClick={() => setFemale(false)}>Đực</button>
                      <button type="button" className={female ? k.on : undefined} onClick={() => setFemale(true)}>Cái</button>
                    </div>
                  </Viewer3D>
                  <div className={k.hint}>Xem trước gần đúng: màu, độ tối và độ sáng nhân như game (mỗi kênh tối đa ×4). Skin chỉ đổi màu (và sáng / tối từng vùng): kiểu hoa văn của dino giữ như người chơi đã chọn trong game, kiểu đó có thể đặt Thân / Hông / Hoa văn khác chỗ so với xem trước.</div>
                  {over.length > 0 && <div className={`${k.hint} ${k.warn}`}>⚠ {over.join(', ')}: vượt ×4, game chỉ nhận tới ×4, kéo thêm không sáng hơn.</div>}
                </div>
                <div>
                  <SkinRegions colors={d.data.colors} light={d.data.light} femaleOff={female} disabled={!edit}
                    onColor={(id, c) => setData((x) => ({ ...x, colors: { ...x.colors, [id]: c } }))}
                    onLight={(id, f) => setData((x) => { const light = { ...x.light }; if (f === null) delete light[id]; else light[id] = f; return { ...x, light }; })} />
                  <div className={k.all} onDoubleClick={() => edit && setData((x) => ({ ...x, brightness: 1 }))} title="Bấm đúp: về thường">
                    <span>Cả con</span><span />
                    <Slider aria-label="Độ sáng cả con" min={lightSlider.min} max={lightSlider.max} step={0.01} value={lightSlider.toSlider(d.data.brightness)} disabled={!edit}
                      onChange={(v) => setData((x) => ({ ...x, brightness: factorOf(v) }))} />
                    <span className={`${k.v} ${bcls ? k[bcls] : ''}`}>{bt}</span>
                  </div>
                  <h4 className={k.presetsTitle}>Bảng màu gợi ý <span>(bấm để áp cả 10 vùng)</span></h4>
                  <SkinPresets disabled={!edit} onPick={(colors) => setData((x) => ({ ...x, colors: Object.fromEntries(REGIONS.map(([id]) => [id, linearOf(colors[id] as string)])) }))} />
                </div>
              </div>
              <EditorActions edit={edit} item={ed.item} dirty={ed.dirty} sel={ed.sel} onRetire={ed.retire} saveLabel="Lưu skin"
                onSave={() => void ed.save(d, ed.sel, (it) => `Đã lưu skin “${it.name}”`)}
                extra={edit && ed.item && <Button variant="ghost" onClick={() => ed.copy({ ...structuredClone(d), name: `${d.name} (bản sao)`.slice(0, 60) })}>Tạo bản sao</Button>} />
              {ed.item && (
                <OwnersBox itemId={ed.item.id} count={`(${owners.length})`} grantLabel="Tặng vào kho" granted="Đã tặng skin vào kho người chơi"
                  notePlaceholder="Ghi chú (vd: quà sự kiện)"
                  extraGrant={(to) => <Button variant="ghost" title="Sơn ngay lên dino người đó đang chơi (phải đúng loài)" onClick={() => apply(to)}>Áp ngay lên dino</Button>}>
                  {owners.length === 0 ? <div className={s.muted} style={{ fontSize: 13 }}>Chưa ai có skin này.</div>
                    : owners.map((o) => (
                      <OwnerRow key={`${o.steamId}-${o.grantedAt}`} o={o} actions={grant && <>
                        <Button variant="ghost" small onClick={() => apply(o.steamId)}>Áp ngay</Button>
                        <Button variant="danger" small onClick={() => revoke(o.steamId, 'Thu hồi skin?',
                          <>Lấy skin <b>{d.name}</b> khỏi kho của <b>{o.name ?? o.steamId}</b>. Màu đang có trên dino không đổi.</>)}>Thu hồi</Button>
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
