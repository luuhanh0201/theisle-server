import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MutationRef, MutationsData } from '@isle/api';
import { ago } from '../../lib/time';
import { dinoName, mutName } from '../../lib/format';
import { DIET_VN, GEN_LABEL, STATUS_VN, evidenceOf, mutSlug, refFor, tierList } from '../../features/mutations/reference';
import { useMutationData } from '../../features/mutations/useMutationData';
import s from './dino.module.css';

/** A mutation's icon (filled in by /mut-icons.js from one bundle; nothing shows for a name with no icon). */
export function MutIcon({ name, md = false, lg = false }: { name: string; md?: boolean; lg?: boolean }) {
  return <img className={`${s.mico}${md ? ` ${s.micoMd}` : ''}${lg ? ` ${s.micoLg}` : ''}`} data-mut-icon={mutSlug(name)} alt="" />;
}

const GROUPS: ReadonlyArray<[string, 'active' | 'parent' | 'elder', string[]]> = [
  ['Đang dùng', 'active', ['Slot1', 'Slot2', 'Slot3', 'Slot4']],
  ['Từ cha mẹ', 'parent', ['ParentSlot1', 'ParentSlot2', 'ParentSlot3', 'ParentSlot4']],
  ['Elder', 'elder', ['ElderSlot1A', 'ElderSlot1B', 'ElderSlot2A', 'ElderSlot2B', 'ElderSlot3A', 'ElderSlot3B', 'ElderSlot4A', 'ElderSlot4B']],
];

/** A dino's mutations by group, as chips; hovering one shows what it does (MutTipLayer). */
export function MutationBlock({ muts, species }: { muts: Record<string, string> | null | undefined; species: string }) {
  const { data } = useMutationData();
  return (
    <>
      {GROUPS.map(([label, group, keys]) => {
        const present = keys.map((k) => muts?.[k]).filter((v): v is string => typeof v === 'string' && v !== '');
        return (
          <div key={group}>
            <div className={s.groupLabel}>{label}</div>
            <div className={s.muts}>
              {present.length === 0 ? <span className={`${s.mut} ${s.none}`}>trống</span>
                : present.map((m, i) => (
                  <span key={`${m}-${i}`} className={`${s.mut}${group === 'active' ? '' : ` ${s[group]}`}`} tabIndex={0} data-mut-tip={m} data-species={species}>
                    {refFor(data, m) && <MutIcon name={refFor(data, m)!.name} />}{mutName(m)}
                  </span>
                ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

/** The reference's facts: diet, who may have it, slots, strength by generation, sources. */
function RefFacts({ r, data }: { r: MutationRef; data: MutationsData }) {
  const chips = [
    r.diet ? DIET_VN[r.diet] : '', r.femaleOnly ? 'Chỉ con cái' : '', r.groupLeaderOnly ? 'Chỉ trưởng nhóm' : '',
    r.kind === 'slot2' ? 'Chỉ slot 2 / 4' : '', r.kind === 'unlock' ? `Mở khoá: ${r.unlock ?? 'nhiệm vụ trong game'}` : '',
    r.slots ? `Slot: ${r.slots}` : '',
    r.tiers ? `Theo đời (trùng sinh): ${tierList(r).map((v, i) => `${GEN_LABEL[i] ?? i + 1} ${v}`).join(' · ')}${r.stat ? `, ${r.stat}` : ''}` : '',
  ].filter(Boolean);
  const hosts = r.sources.map((k) => { try { return new URL(data.sources[k] ?? '').hostname.replace(/^www\./, ''); } catch { return k; } });
  return (
    <>
      <div className={s.tMeta}>{chips.map((c) => <span key={c} className={s.tChip}>{c}</span>)}</div>
      {r.status !== 'active' && <div className={s.tAlert}>{STATUS_VN[r.status]}{r.statusNote ? `, ${r.statusNote}` : ''}</div>}
      <div className={s.tSrc}>Nguồn: {hosts.join(', ')}{data.referenceChecked ? ` · kiểm tra ${data.referenceChecked}` : ''}</div>
    </>
  );
}

/** The source's English line, then ours in Vietnamese (and how to unlock, both ways). */
function Bilingual({ r }: { r: MutationRef }) {
  return (
    <>
      <div className={s.tDesc}><span className={s.lang}>EN</span>{r.en}<br /><span className={s.lang}>VI</span>{r.description}</div>
      {(r.unlockEn || r.unlock) && <div className={s.tDesc}><span className={s.lang}>EN</span>How to get: {r.unlockEn ?? ''}<br /><span className={s.lang}>VI</span>Cách mở: {r.unlock ?? r.slots ?? ''}</div>}
    </>
  );
}

const GROUP_VN: Record<string, string> = { active: 'đang dùng', parent: 'cha mẹ', elder: 'elder' };

/**
 * One tooltip for every element with data-mut-tip (a chip, the "!" of a picker): hover, keyboard
 * focus, or a tap. Mounted once (App), as the panel before React did.
 */
export function MutTipLayer() {
  const { data, catalog } = useMutationData();
  const [at, setAt] = useState<{ name: string; species: string | null; rect: DOMRect } | null>(null);
  useEffect(() => {
    const show = (el: HTMLElement): void => {
      const name = el.dataset['mutTip'];
      if (name) setAt({ name, species: el.dataset['species'] || null, rect: el.getBoundingClientRect() });
    };
    const over = (e: MouseEvent): void => { const el = (e.target as HTMLElement).closest?.<HTMLElement>('[data-mut-tip]'); if (el) show(el); };
    const out = (e: MouseEvent): void => {
      if ((e.target as HTMLElement).closest?.('[data-mut-tip]') && !(e.relatedTarget as HTMLElement | null)?.closest?.('[data-mut-tip]')) setAt(null);
    };
    const focus = (e: FocusEvent): void => { const el = (e.target as HTMLElement).closest?.<HTMLElement>('[data-mut-tip]'); if (el) show(el); else setAt(null); };
    const click = (e: MouseEvent): void => { const el = (e.target as HTMLElement).closest?.<HTMLElement>('[data-mut-tip]'); if (el) show(el); else setAt(null); };
    const hide = (): void => setAt(null);
    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    document.addEventListener('focusin', focus);
    document.addEventListener('click', click);
    window.addEventListener('scroll', hide, { passive: true });
    return () => {
      document.removeEventListener('mouseover', over); document.removeEventListener('mouseout', out);
      document.removeEventListener('focusin', focus); document.removeEventListener('click', click); window.removeEventListener('scroll', hide);
    };
  }, []);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = (el: HTMLDivElement | null): void => {
    if (!el || !at) return;
    const w = el.offsetWidth, h = el.offsetHeight, r = at.rect;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    const top = r.bottom + 8 + h < window.innerHeight ? r.bottom + 8 : Math.max(8, r.top - h - 8);
    if (!pos || pos.left !== left || pos.top !== top) setPos({ left, top });
  };
  if (!at || !data) return null;
  const note = data.notes[at.name];
  const r = refFor(data, at.name);
  const { ev, elsewhere } = evidenceOf(catalog, at.species, at.name);
  const sp = at.species ? dinoName(at.species) : null;
  return createPortal(
    <div ref={ref} className={s.tip} role="tooltip" style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}>
      <div className={s.tName}>{r && <MutIcon name={r.name} md />}{r ? r.name : mutName(at.name)}</div>
      <div className={s.tId}>{at.name}</div>
      {note && <><div className={s.tLabel}>Mô tả của admin</div><div className={s.tDesc}>{note.description}</div></>}
      {r ? <><div className={s.tLabel}>Theo wiki cộng đồng</div><Bilingual r={r} /><RefFacts r={r} data={data} /></>
        : !note && <div className={`${s.tDesc} ${s.tDescNone}`}>Chưa có mô tả, tên này không có trong bảng tham chiếu. Admin bấm ✎ cạnh ô chọn để thêm.</div>}
      {sp && (
        <>
          <div className={s.tLabel}>Trên server này</div>
          <div className={s.tProof}>
            {ev ? <>
              <span className={s.ok}>✓ Đã xác nhận trên {sp}</span>
              <span>Thấy {ev.count} lần · {ev.players} người chơi{ev.lastSeen ? ` · gần nhất ${ago(ev.lastSeen)}` : ''}</span>
              <span>Trong slot: {ev.groups.map((g) => GROUP_VN[g] ?? g).join(', ')}</span>
            </> : <>
              <span className={s.warn}>⚠ Chưa từng thấy trên {sp}</span>
              <span>{elsewhere.length ? `Chỉ thấy trên: ${elsewhere.map(dinoName).join(', ')}` : 'Chưa thấy trên loài nào'}</span>
            </>}
          </div>
        </>
      )}
    </div>, document.body);
}
