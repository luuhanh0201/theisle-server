import type { CatalogSpecies, MutationsData } from '@isle/api';
import { Select, type SelectOption } from '@isle/ui';
import { dinoName, mutName } from '../../../lib/format';
import { GEN_LABEL, genIndex, refAlert, refFor, tierList } from '../../mutations/reference';
import { MUT_SLOTS, SLOT_LABEL, mutationChoices, type MutGroup } from './logic';
import c from './Creator.module.css';

/** Under a chosen mutation: what it does, English (the source) and Vietnamese, its strength at this dino's generation. */
function MutDesc({ name, data, stacks }: { name: string; data: MutationsData | null; stacks: number }) {
  const r = refFor(data, name);
  const note = data?.notes[name];
  if (!r) {
    return <div className={c.mutDesc}>{note ? <div className={c.vi}><span className={c.lang}>VI</span>{note.description}</div>
      : <div className={c.meta}>Chưa có mô tả cho tên này, bấm ✎ mô tả để thêm.</div>}</div>;
  }
  const meta = [r.kind === 'slot2' ? 'Chỉ slot 2 / 4' : '', r.kind === 'unlock' ? `Mở khoá: ${r.unlock ?? r.unlockEn ?? ''}` : '',
    r.femaleOnly ? 'Chỉ con cái' : '', r.groupLeaderOnly ? 'Chỉ trưởng nhóm' : ''].filter(Boolean).join(' · ');
  const tiers = tierList(r);
  const at = genIndex(r, stacks);
  return (
    <div className={c.mutDesc}>
      <div className={c.en}><span className={c.lang}>EN</span>{r.en}</div>
      <div className={c.vi}><span className={c.lang}>VI</span>{r.description}</div>
      {note && <div className={c.vi}><span className={c.lang}>AD</span>{note.description}</div>}
      {tiers.length > 0 && <>
        <div className={c.gens}>{tiers.map((v, i) => <span key={i} className={`${c.gen}${i === at ? ` ${c.genOn}` : ''}`}>{GEN_LABEL[i] ?? `Đời ${i + 1}`}: {v}</span>)}</div>
        <div className={c.now}>→ Dino này ({stacks} lần trùng sinh): <b>{tiers[at]}</b>{r.stat ? ` ${r.stat}` : ''}</div>
      </>}
      {meta && <div className={c.meta}>{meta}</div>}
    </div>
  );
}

/**
 * The 16 mutation pickers by group. Confirmed = seen on this species (any slot); the rest only
 * when allowed. Within a group, a mutation picked in one slot is not offered in another.
 */
export function MutationPicker({ group, catalog, data, species, allow, stacks, mutations, onPick, onEditNote }: {
  group: MutGroup; catalog: CatalogSpecies[]; data: MutationsData | null; species: string | null; allow: boolean; stacks: number;
  mutations: Record<string, string>; onPick: (slot: string, name: string) => void; onEditNote: (name: string) => void;
}) {
  const { own, others } = mutationChoices(catalog, species, allow);
  const sp = species ? dinoName(species) : null;
  const none = own.length === 0 && others.length === 0;
  const label = (n: string): string => refFor(data, n)?.name ?? mutName(n);
  return (
    <div className={c.mutGrid}>
      {MUT_SLOTS[group].map((slot) => {
        const value = mutations[slot] ?? '';
        const taken = new Set(MUT_SLOTS[group].filter((k) => k !== slot).map((k) => mutations[k]).filter(Boolean));
        const opt = (n: string, warn: boolean, grp: string): SelectOption => ({
          value: n, group: grp, disabled: taken.has(n),
          label: `${warn ? '⚠ ' : ''}${label(n)}${refAlert(refFor(data, n)) ? ' ⚠' : ''}${taken.has(n) ? ' (đã chọn)' : ''}`,
          sub: refFor(data, n) ? `${refFor(data, n)!.description}` : undefined,
        });
        const emptyLabel = !species ? 'chọn loài trước' : none ? `chưa có mutation nào được xác nhận trên ${sp}` : 'trống';
        const options: SelectOption[] = [
          { value: '', label: emptyLabel },
          ...own.map((n) => opt(n, false, `✓ Đã xác nhận trên ${sp}`)),
          ...others.map((n) => opt(n, true, '⚠ Chưa xác nhận, chỉ thấy trên loài khác')),
        ];
        const confirmed = value !== '' && own.includes(value);
        const alert = value ? refAlert(refFor(data, value)) : '';
        const status = value === '' ? '' : `${confirmed ? `✓ đã xác nhận trên ${sp}` : `⚠ chưa xác nhận trên ${sp}`}${alert ? ` · ${alert.replace(/^⚠ /, '')}` : ''}`;
        return (
          <div key={slot}>
            <div className={c.mutHead}>
              <label htmlFor={`f-mut-${slot}`}>{SLOT_LABEL(slot)}</label>
              {value && <button type="button" className={`${c.infoBtn}${confirmed ? '' : ` ${c.infoWarn}`}`} aria-label="Mô tả mutation" data-mut-tip={value} data-species={species ?? ''}>!</button>}
              {value && <button type="button" className={c.editBtn} title="Sửa mô tả" onClick={() => onEditNote(value)}>✎ mô tả</button>}
            </div>
            <Select id={`f-mut-${slot}`} value={value} options={options} disabled={none} chosen={value !== ''} aria-label={SLOT_LABEL(slot)}
              onChange={(v) => onPick(slot, v)} />
            <div className={`${c.mutStatus}${value === '' ? '' : confirmed && !alert ? ` ${c.ok}` : ` ${c.warn}`}`}>{status}</div>
            {value && <MutDesc name={value} data={data} stacks={stacks} />}
          </div>
        );
      })}
    </div>
  );
}
