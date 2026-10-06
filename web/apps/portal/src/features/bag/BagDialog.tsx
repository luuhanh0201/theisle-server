import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Select } from '@isle/ui';
import type { PlayerMe } from '@isle/api';
import { useToast } from '../../app/toast';
import { portalGet } from '../../lib/http';
import {
  BAG_RARITY, DIET_VI, LOOT_AT, LOOT_CARD, LOOT_GAP, SLOT_FROM, bagGroups, dinoSlotChoices, fitMuts, lootStrip, mutSlug, pctOf,
  type BagGroup, type BagItem, type BoxOptions, type BoxResult, type DinoOptions, type LootOptions, type LootPrize, type Preview,
} from './bag';
import { BAG_TICKET, MutIcon, type Status } from './parts';

/** What the dialog shows: a use (a slot, a ticket's pick), a dino box, a dino item, a hòm. */
export type Open =
  | { kind: 'use'; g: BagGroup; pv: Preview; slot: number | null; pick: { name: string; rarity: string; slot2?: boolean; description?: string } | null }
  | { kind: 'box'; g: BagGroup; opts: BoxOptions; species: string; phase: 'pick' | 'rolling' | 'done'; result: BoxResult | null }
  | { kind: 'dino'; g: BagGroup; uid: string; opts: DinoOptions; female: boolean; muts: Record<number, string> }
  | { kind: 'loot'; g: BagGroup; opts: LootOptions; phase: 'pool' | 'rolling' | 'done'; won: LootPrize | null; strip: LootPrize[] | null; endX: number };

const reduced = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const Rar = ({ r }: { r: string }) => <span className={`rar-label rar-${r}`}>{BAG_RARITY[r] ?? r}</span>;
const Close = () => <button type="button" className="x" data-dlg="close" aria-label="Đóng">×</button>;
const StatusEl = ({ s }: { s: Status }) => (
  <div className={`garage-status${s?.kind ? ` ${s.kind}` : ''}`} id="bag-dlg-status" role="status" aria-live="polite" hidden={!s}>{s?.node}</div>
);
const Head = ({ icon, title, rarity, sub }: { icon: string; title: string; rarity?: string; sub: ReactNode }) => (
  <div className="hd"><span className="mut-ico tk-ico" aria-hidden="true">{icon}</span><div><b id="bag-dlg-title">{title}</b>
    {rarity && <> <Rar r={rarity} /></>}
    <div className="muted" style={{ fontSize: 12.5 }}>{sub}</div></div>
    <Close /></div>
);
const Val = ({ v }: { v: string | null }) => (v == null ? <span className="muted">chưa rõ số liệu</span> : <>{v}</>);
const lootIcon = (p: LootPrize) => (p.type === 'mutation' ? <MutIcon name={p.mutation} />
  : <span className="mut-ico tk-ico" aria-hidden="true">{p.type === 'skin' ? '🎨' : BAG_TICKET[p.type]?.icon ?? '🎁'}</span>);

interface Props {
  dlg: React.RefObject<HTMLDialogElement | null>; token: React.RefObject<number>; show: number; closeDialog: () => void;
  me: PlayerMe; open: Open | null; setOpen: (o: Open | null) => void; busy: boolean; setBusy: (b: boolean) => void;
  status: Status; setStatus: (s: Status) => void;
  send: (url: string, body: unknown, what: string, inDialog?: boolean) => Promise<void>;
  openDino: (uid: string) => Promise<void>; refreshMe: () => Promise<unknown>; sayBag: (kind: '' | 'ok' | 'bad', node: ReactNode) => void;
}

/** The bag's one dialog (#bag-dlg, the old page's): what using the item does, chosen and sent from here. */
export function BagDialog(p: Props) {
  const { dlg, token, show, open, setOpen, busy } = p;
  const shownFor = useRef(0);
  useEffect(() => {
    const d = dlg.current;
    if (!d || show === 0) return;
    shownFor.current = token.current ?? 0;
    if (!d.open) d.showModal?.();
  }, [show, dlg, token]);
  const busyNow = useRef(busy);
  busyNow.current = busy;
  // × or a click outside: closed and forgotten here (unless a use is on its way); the "close" event then has
  // nothing to do. Esc closes it without a click: the event does it then.
  const byClick = useRef(false);
  return (
    <dialog className="bag-dlg" id="bag-dlg" aria-labelledby="bag-dlg-title" ref={dlg}
      onClose={() => {
        if (byClick.current) { byClick.current = false; return; }
        // Forgotten unless a use is on its way, or a newer one was asked for meanwhile.
        if (!busyNow.current && shownFor.current === token.current) setOpen(null);
      }}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (t !== dlg.current && !t.closest('[data-dlg="close"]')) return;
        byClick.current = true;
        dlg.current?.close();
        if (!busyNow.current) setOpen(null);
      }}>
      <div className="in" id="bag-dlg-in">
        {open?.kind === 'use' && <UseBox {...p} o={open} />}
        {open?.kind === 'box' && <BoxBox {...p} o={open} />}
        {open?.kind === 'dino' && <DinoBox {...p} o={open} />}
        {open?.kind === 'loot' && <LootBox {...p} o={open} />}
      </div>
    </dialog>
  );
}

// --- a use: salt, growth / food, prime, a mutation / ticket / clear into a slot --------------------------------
function UseBox({ me, o, setOpen, busy, status, send }: Props & { o: Extract<Open, { kind: 'use' }> }) {
  const { g, pv, slot } = o;
  const gen = pv.stacks == null ? '?' : pv.stacks + 1;
  const head = (
    <div className="hd">{g.type === 'mutation' ? <MutIcon name={g.mutation} /> : <span className="mut-ico tk-ico" aria-hidden="true">{BAG_TICKET[g.type]?.icon ?? ''}</span>}<div><b id="bag-dlg-title">{g.name}</b>
      {' '}<Rar r={g.rarity} />
      <div className="muted" style={{ fontSize: 12.5 }}>{pv.species ?? ''} · {pv.growth != null ? `${Math.round(pv.growth * 100)}%` : '?'} · đời {gen}{pv.prime ? ' · prime' : ''}{me.bagUnlimited ? ' · ∞ (túi admin)' : g.uids.length > 1 ? ` · còn ${g.uids.length} cái` : ''}</div></div>
      <Close /></div>
  );
  const uid = g.uids[0];
  if (g.type === 'salt_lick') {
    return <>{head}<div className="sec"><h4>Liếm đá muối</h4>
      <div className="cmp">Một khối khoáng mặn hiếm thấy trên đảo. Liếm vài lần, dạ dày dịu lại ngay: <b>hết trạng thái ốm sau khi nôn</b>.</div>
      <div className="cmp muted">Chỉ chữa ốm sau khi nôn, không hồi máu, thức ăn hay nước. Dùng là hết vật phẩm.</div>
      <div className="row"><button type="button" className="btn btn-emerald" data-dlg="apply" disabled={busy} onClick={() => { void send('/api/items/use', { uid }, g.name, true); }}>🧂 Liếm đá muối</button></div></div><StatusEl s={status} /></>;
  }
  if (g.type === 'growth_bag' || g.type === 'food_box') {
    const grow = g.type === 'growth_bag';
    const amount = Math.round((g.amount ?? (grow ? 0.1 : 0.2)) * 100);
    const below = g.below ?? 0.6;
    const why = grow && pv.growth != null && pv.growth >= below - 1e-6
      ? (below >= 1 ? 'Dino đã 100% tăng trưởng.' : `Chỉ dùng cho dino dưới ${Math.round(below * 100)}% (dino đang ${Math.round(pv.growth * 100)}%).`) : '';
    const to = grow && pv.growth != null ? Math.min(100, Math.round(pv.growth * 100) + amount) : null;
    return <>{head}<div className="sec"><h4>{grow ? 'Tăng trưởng' : 'Cho ăn'}</h4>
      <div className="cmp">{grow ? <>Dino đang chơi lớn thêm <b>{amount}%</b>{to !== null && pv.growth != null && <> ({Math.round(pv.growth * 100)}% → <b>{to}%</b>)</>}. Chỉ số được giữ theo tỉ lệ như lúc trước.</>
        : <>Thanh thức ăn <b>+{amount}%</b> (tối đa đầy). Chống đói, không tăng chất dinh dưỡng. Dino đang no thì vật phẩm vẫn còn.</>}</div>
      {why && <div className="why" style={{ color: '#fbbf24', fontSize: 13 }}>⚠️ {why}</div>}
      <div className="row"><button type="button" className="btn btn-emerald" data-dlg="apply" disabled={Boolean(why) || busy} onClick={() => { void send('/api/items/use', { uid }, g.name, true); }}>{grow ? `+${amount}% tăng trưởng` : `+${amount}% thức ăn`}</button></div></div><StatusEl s={status} /></>;
  }
  if (g.type === 'prime_ticket') {
    const grown = pv.growth != null && pv.growth >= 0.999;
    const why = pv.prime ? 'Dino này đã là prime.' : !grown ? 'Cần dino 100% tăng trưởng.' : '';
    return <>{head}<div className="sec"><h4>Lên prime</h4>
      <div className="cmp">Đánh dấu đủ 10 điều kiện prime và cho dino lên prime, như khi tự làm nhiệm vụ prime. Chỉ số prime có sau vài giây.</div>
      {why && <div className="why" style={{ color: '#fbbf24', fontSize: 13 }}>⚠️ {why}</div>}
      <div className="row"><button type="button" className="btn btn-emerald" data-dlg="prime" disabled={Boolean(why) || busy} onClick={() => { void send('/api/items/use', { uid }, 'phiếu Prime', true); }}>Lên prime</button></div></div><StatusEl s={status} /></>;
  }
  const isClear = g.type === 'mutation_clear';
  const isTicket = g.type === 'mutation_ticket';
  const incomingName = isTicket ? o.pick?.name ?? null : g.mutation ?? null;
  const slot2 = isTicket ? Boolean(o.pick?.slot2) : Boolean(pv.slot2);
  const has = incomingName ? pv.slots.find((x) => x.name && mutSlug(x.name) === mutSlug(incomingName)) : null;
  const choosable = (x: Preview['slots'][number]): boolean => (isClear ? Boolean(x.name) : x.open && (!slot2 || x.slot === 2 || x.slot === 4));
  const picked = pv.slots.find((x) => x.slot === slot) ?? null;
  const pickMut = (name: string): void => {
    if (busy) return;
    const pick = (pv.pool ?? []).find((m) => m.name === name) ?? null;
    // A slot-2 kind leaves a slot it cannot take.
    const s = pick?.slot2 && o.slot !== 2 && o.slot !== 4 ? pv.slots.find((x) => x.open && (x.slot === 2 || x.slot === 4))?.slot ?? null : o.slot;
    setOpen({ ...o, pick, slot: s });
  };
  const go = (): void => {
    if (!picked) return;
    if (isClear) { void send('/api/items/use', { uid, slot: picked.slot }, `bỏ mutation ô ${picked.slot}`, true); return; }
    if (isTicket && o.pick) { void send('/api/items/use', { uid, slot: picked.slot, mutation: o.pick.name }, `mutation ${o.pick.name}`, true); return; }
    void send('/api/items/use', { uid, slot: picked.slot }, `mutation ${g.mutation}`, true);
  };
  const canGo = Boolean(picked && choosable(picked) && (isClear || (incomingName && !has)) && !busy);
  return (
    <>
      {head}
      {isTicket && (
        <div className="sec"><h4>1. Chọn mutation</h4><div className="tk-pool">
          {(pv.pool ?? []).length > 0 ? (pv.pool ?? []).map((m) => (
            <button key={m.name} type="button" className={`tk-pick rar-${m.rarity}${incomingName === m.name ? ' on' : ''}`} data-dlg-pick={m.name} title={m.description ?? ''} onClick={() => pickMut(m.name)}>
              <MutIcon name={m.name} cls="sm" /><span>{m.name}{m.slot2 && <> <small>(ô 2/4)</small></>}</span></button>
          )) : <div className="muted">Không có mutation nào hợp với loài này trong độ hiếm của phiếu.</div>}
        </div></div>
      )}
      <div className="sec"><h4>{isTicket ? '2. ' : ''}{isClear ? 'Chọn ô cần bỏ' : 'Chọn ô'}</h4>
        {has && !isClear && <div className="cmp muted">Dino đã có {incomingName} ở ô {has.slot}: dùng thêm không mạnh hơn.</div>}
        <div className="slots">{pv.slots.map((x) => (
          <button key={x.slot} type="button" className={`slot${x.slot === slot ? ' on' : ''}`} data-dlg-slot={x.slot} disabled={!choosable(x)} onClick={() => { if (!busy) setOpen({ ...o, slot: x.slot }); }}>
            {x.name && <MutIcon name={x.name} cls="sm" />}<span><b>Ô {x.slot}</b>{!x.open && <> <small>mở từ {Math.round(x.minGrowth * 100)}%</small></>}<br />{x.name ? <>{x.name} · <Val v={x.value} /></> : <span className="muted">trống</span>}</span></button>
        ))}</div>
        {picked && choosable(picked)
          ? <div className="cmp">{isClear ? <>Bỏ <b>{picked.name}</b> khỏi ô {picked.slot}.</>
            : incomingName ? <>{picked.name ? <>Thay <b>{picked.name}</b> (<Val v={picked.value} />)</> : `Ô ${picked.slot} đang trống`} → <b>{incomingName}</b> <span className="muted">· độ mạnh theo đời của dino (đời {gen})</span></> : 'Chọn mutation trước.'}</div>
          : <div className="cmp muted">{isClear ? 'Chọn một ô đang có mutation.' : 'Chọn một ô đã mở (ô 1 từ 25%, ô 2 từ 50%, ô 3–4 từ 75% tăng trưởng).'}</div>}
        <div className="row"><button type="button" className="btn btn-emerald" data-dlg={isClear ? 'clear' : 'place'} disabled={!canGo} onClick={go}>
          {isClear ? (picked?.name ? `Bỏ khỏi ô ${picked.slot}` : 'Bỏ') : picked?.name ? `Thay vào ô ${picked.slot}` : picked ? `Thêm vào ô ${picked.slot}` : 'Thêm'}</button></div></div>
      <StatusEl s={status} />
    </>
  );
}

// --- a dino box: its species picked (or drawn), a roll, then a dino item in the bag ------------------------------
function BoxBox({ o, setOpen, busy, setBusy, status, setStatus, openDino, refreshMe }: Props & { o: Extract<Open, { kind: 'box' }> }) {
  const { g, opts } = o;
  const random = opts.pick === 'random';
  const range = `${pctOf(opts.growthMin)}–${pctOf(opts.growthMax)}`;
  const head = <Head icon="🎁" title={g.name} rarity={g.rarity} sub={`${random ? 'Loài ngẫu nhiên' : 'Tự chọn loài'} · tăng trưởng ngẫu nhiên ${range}`} />;
  const [roll, setRoll] = useState<{ sp: string; g: string } | null>(null);
  const current = useRef(o);
  current.current = o;
  // The roll: names and numbers flick by, slowing down, then land on what the bridge drew (≈1.7 s; text only).
  useEffect(() => {
    if (o.phase !== 'rolling' || !o.result) return undefined;
    const res = o.result;
    const land = (): void => { setOpen({ ...current.current, phase: 'done' } as Open); };
    if (reduced()) { land(); return undefined; }
    const names = opts.species.map((x) => x.label);
    const lo = Math.round(opts.growthMin * 100), hi = Math.round(opts.growthMax * 100);
    const steps = 18;
    let i = 0;
    let t: ReturnType<typeof setTimeout> | undefined;
    const tick = (): void => {
      i += 1;
      if (i >= steps) { land(); return; }
      setRoll({ sp: random ? names[Math.floor(Math.random() * names.length)] ?? res.label : res.label, g: `${lo + Math.floor(Math.random() * (hi - lo + 1))}%` });
      t = setTimeout(tick, 35 + 220 * (i / steps) ** 2.5);
    };
    tick();
    return () => { if (t) clearTimeout(t); };
    // Once per roll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.phase]);

  const openIt = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    let error: string | null = null;
    let rolled = false;
    try {
      const r = await fetch('/api/items/open', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uid: g.uids[0], species: o.species || undefined }) });
      const b = await r.json().catch(() => null) as (BoxResult & { error?: string }) | null;
      if (r.status !== 200 || !b) { error = `❌ ${b?.error ?? 'Không mở được hộp.'} Hộp vẫn còn.`; return; }
      rolled = true;
      setRoll(null);
      setOpen({ ...o, result: b, phase: 'rolling' });
    } catch {
      error = 'Mất kết nối. Thử lại.';
    } finally {
      setBusy(false);
      if (!rolled && error) setStatus({ kind: 'bad', node: error });
      void refreshMe();
    }
  };

  if (o.phase === 'pick') {
    return <>{head}
      {random
        ? <div className="sec"><div className="cmp">Mở hộp ra <b>1 trong {opts.species.length} loài</b>, tăng trưởng ngẫu nhiên {range}. Mở xong là vật phẩm Dino trong túi, dùng để chọn giới tính và mutation.</div></div>
        : <div className="sec"><h4>Chọn loài</h4><label className="dino-slot"><span>Loài</span>
          <Select aria-label="Loài" value={o.species} placeholder="Chọn loài" options={[{ value: '', label: 'Chọn loài' }, ...opts.species.map((x) => ({ value: x.key, label: x.label }))]}
            onChange={(v) => { if (!busy) setOpen({ ...o, species: v }); }} /></label>
          <div className="cmp muted">Tăng trưởng bốc ngẫu nhiên {range} khi mở.</div></div>}
      <div className="act"><button type="button" className="btn btn-emerald" data-dlg="open-box" disabled={!((random || o.species) && !busy)} onClick={() => { void openIt(); }}>🎁 Mở hộp</button></div>
      <StatusEl s={status} /></>;
  }
  const res = o.result as BoxResult;
  const done = o.phase === 'done';
  return <>{head}
    <div className={`roll${done ? ' landed' : ''}`} aria-live="polite">
      <div className={`roll-sp${random ? '' : ' fixed'}`} id="roll-sp">{done || !random ? res.label : roll?.sp ?? '…'}</div>
      <div className="roll-g" id="roll-g">{done ? pctOf(res.growth) : roll?.g ?? '…'}</div>
    </div>
    {done && <>
      <p className="muted" style={{ margin: 0, textAlign: 'center', fontSize: 13 }}>Đã vào túi đồ: <b>Dino {res.label} {pctOf(res.growth)}</b>. Dùng để chọn giới tính và mutation ({res.growth >= 0.75 ? 'đủ 4 ô' : res.growth >= 0.5 ? 'ô 1–2' : res.growth >= 0.25 ? 'ô 1' : 'chưa có ô nào'}).</p>
      <div className="act"><button type="button" className="btn btn-ghost" data-dlg="close">Để trong túi</button>
        <button type="button" className="btn btn-emerald" data-dlg="use-dino" onClick={() => { if (!busy) void openDino(res.uid); }}>🦖 Dùng ngay</button></div>
    </>}
    <StatusEl s={status} /></>;
}

// --- a dino item: its sex and the mutations of the slots its growth opens, into the garage ----------------------
function DinoBox({ o, setOpen, busy, setBusy, status, setStatus, refreshMe, sayBag, ...p }: Props & { o: Extract<Open, { kind: 'dino' }> }) {
  const toast = useToast();
  const op = o.opts;
  const muts = fitMuts(op, o.female, o.muts);
  const slotRow = (n: number) => {
    if (!op.openSlots.includes(n)) {
      return <label key={n} className="dino-slot"><span>Ô {n}</span>
        <Select aria-label={`Ô ${n}`} value="locked" disabled options={[{ value: 'locked', label: `🔒 Mở từ ${SLOT_FROM[n]}% (dino ${pctOf(op.growth)})` }]} onChange={() => undefined} /></label>;
    }
    const list = dinoSlotChoices(op, o.female, muts, n);
    const chosen = muts[n] ? op.mutations.find((m) => m.name === muts[n]) : null;
    return <label key={n} className="dino-slot"><span>Ô {n}{(n === 2 || n === 4) && <> <span className="muted">(nhận cả mutation chỉ ô 2/4)</span></>}</span>
      <Select aria-label={`Ô ${n}`} value={muts[n] ?? ''} options={[{ value: '', label: 'Để trống' },
        ...list.map((m) => ({ value: m.name, label: `${m.name}${m.femaleOnly ? ' (cái)' : ''}${m.quest ? ' (nhiệm vụ)' : ''}` }))]}
        onChange={(v) => { if (!busy) setOpen({ ...o, muts: { ...muts, [n]: v } }); }} />
      {chosen && <small className="dino-desc"><MutIcon name={chosen.name} cls="sm" /> {chosen.description ?? ''}</small>}</label>;
  };
  const receive = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setStatus({ kind: '', node: 'Đang đưa dino vào gara…' });
    try {
      const r = await fetch('/api/items/dino', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uid: o.uid, female: o.female, mutations: muts }) });
      const b = await r.json().catch(() => null) as { species?: string; growth?: number; female?: boolean; slot?: string; error?: string } | null;
      if (r.status !== 200 || !b) { setStatus({ kind: 'bad', node: `❌ ${b?.error ?? 'Không nhận được dino.'} Vật phẩm vẫn còn.` }); return; }
      p.closeDialog();
      sayBag('ok', <>✅ Đã nhận <b>{b.species} {pctOf(b.growth ?? 0)}</b> ({b.female ? 'cái' : 'đực'}, đủ nhiệm vụ prime) vào <b>gara ô {b.slot}</b>. Vào Gara, respawn đúng loài rồi lấy ra.</>);
      toast(`✅ ${b.species} ${pctOf(b.growth ?? 0)} đã vào gara ô ${b.slot}`);
    } catch {
      setStatus({ kind: 'bad', node: 'Mất kết nối. Thử lại.' });
    } finally {
      setBusy(false);
      void refreshMe();
    }
  };
  return <>
    <Head icon="🦖" title={`Dino ${op.label} ${pctOf(op.growth)}`} rarity="legendary" sub={`${DIET_VI[op.diet] ?? ''} · đủ 10 nhiệm vụ prime · vào gara`} />
    <div className="sec"><h4>Giới tính</h4>
      <div className="xseg">
        <button type="button" data-dino-sex="m" className={o.female ? '' : 'on'} onClick={() => { if (!busy) setOpen({ ...o, female: false, muts: fitMuts(op, false, muts) }); }}>♂ Đực</button>
        <button type="button" data-dino-sex="f" className={o.female ? 'on' : ''} onClick={() => { if (!busy) setOpen({ ...o, female: true, muts: fitMuts(op, true, muts) }); }}>♀ Cái</button>
      </div></div>
    <div className="sec"><h4>Mutation <span className="muted" style={{ fontWeight: 500 }}>· {op.openSlots.length ? `mở ${op.openSlots.length}/4 ô theo ${pctOf(op.growth)} tăng trưởng` : 'chưa mở ô nào (dưới 25%)'}</span></h4>
      <div className="dino-muts">{[1, 2, 3, 4].map(slotRow)}</div></div>
    <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Dùng là hết vật phẩm. Dino vào ô gara trống kế tiếp (kể cả khi gara đã đủ ô){op.growth >= 0.75 ? ', từ 75% game cho lên prime' : ''}.</p>
    <div className="act"><button type="button" className="btn btn-emerald" data-dlg="dino" disabled={busy} onClick={() => { void receive(); }}>Nhận {op.label} vào gara</button></div>
    <StatusEl s={status} />
  </>;
}

// --- a hòm: what it may give, then a gacha roll onto the one drawn ------------------------------------------------
// The draw is the bridge's; the roll only shows it: a strip of cards slides under a marker and slows down onto the
// prize (one CSS transition, ~5 s; reduced motion: at once), then the prize lights up. The page never gets the
// chances (owner, 2026-10-05: the admin's only).
function LootBox({ me, o, setOpen, busy, setBusy, status, setStatus, refreshMe }: Props & { o: Extract<Open, { kind: 'loot' }> }) {
  const { g, opts } = o;
  const win = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const current = useRef(o);
  current.current = o;
  const groupNow = bagGroups((me.items ?? []) as unknown as BagItem[]).find((x) => x.key === g.key);
  const left = groupNow?.uids.length ?? 0;
  const firstUid = groupNow?.uids[0] ?? g.uids[0];
  const head = (
    <div className="hd"><span className="mut-ico tk-ico" aria-hidden="true">🏺</span><div><b id="bag-dlg-title">{opts.name ?? g.name}</b>
      {' '}<Rar r={g.rarity} />
      <div className="muted" style={{ fontSize: 12.5 }}>{me.bagUnlimited ? 'Túi admin: mở không mất hòm' : `Còn ${left} hòm`}</div></div>
      <Close /></div>
  );
  // Slide the strip onto the prize; the prize lights up when it stops.
  useLayoutEffect(() => {
    if (o.phase !== 'rolling') return undefined;
    const w = win.current, s = strip.current;
    const finish = (endX: number): void => { setOpen({ ...current.current, phase: 'done', endX } as Open); void refreshMe(); };
    if (!w || !s) { finish(0); return undefined; }
    const step = LOOT_CARD + LOOT_GAP;
    // Not the prize's dead centre: somewhere on its card, so it looks like it nearly went either way.
    const jitter = (Math.random() - 0.5) * LOOT_CARD * 0.7;
    const endX = Math.round(w.clientWidth / 2 - (LOOT_AT * step + LOOT_CARD / 2) + jitter);
    if (reduced()) { finish(endX); return undefined; }
    s.style.transition = '';
    s.style.transform = 'translateX(0px)';
    let raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => {
      s.style.transition = 'transform 5.2s cubic-bezier(.08,.72,.12,1)';
      s.style.transform = `translateX(${endX}px)`;
    }); });
    let done = false;
    const end = (): void => { if (!done) { done = true; finish(endX); } };
    s.addEventListener('transitionend', end, { once: true });
    const t = setTimeout(end, 5600);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); s.removeEventListener('transitionend', end); };
    // Once per roll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.phase]);

  const openIt = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    let error: string | null = null;
    try {
      const r = await fetch('/api/items/loot', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: firstUid }) });
      const b = await r.json().catch(() => null) as { won?: LootPrize; error?: string } | null;
      if (r.status === 429) error = 'Chậm lại chút rồi mở tiếp.';
      else if (r.status !== 200 || !b?.won) error = `❌ ${b?.error ?? 'Không mở được hòm.'} Hòm vẫn còn.`;
      else setOpen({ ...o, won: b.won, strip: lootStrip(opts.pool.length ? opts.pool : [b.won], b.won), phase: 'rolling' });
    } catch {
      error = 'Mất kết nối. Thử lại.';
    } finally {
      setBusy(false);
      if (error) setStatus({ kind: 'bad', node: error });
    }
  };
  const again = async (): Promise<void> => {
    if (busy) return;
    setStatus(null);
    setOpen({ ...o, phase: 'pool', won: null, strip: null });
    const r = await portalGet<LootOptions>(`/api/items/loot-options/${encodeURIComponent(firstUid ?? '')}`).catch(() => null);
    if (r && Array.isArray(r.pool) && current.current.kind === 'loot') setOpen({ ...current.current, opts: r } as Open);
  };

  if (o.phase === 'pool') {
    const order = ['special', 'legendary', 'epic', 'rare', 'common'];
    const pool = [...opts.pool].sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity) || a.name.localeCompare(b.name, 'vi'));
    return <>{head}
      <div className="sec"><h4>Có thể nhận</h4>
        {pool.length > 0 ? <div className="loot-pool">{pool.map((p) => (
          <div key={p.itemId} className={`loot-row rar-${p.rarity}`} title={p.description ?? ''}>{lootIcon(p)}
            <span className="nm"><b>{p.name}</b>{p.qty > 1 ? ` ×${p.qty}` : ''}<Rar r={p.rarity} /></span></div>
        ))}</div> : <p className="muted" style={{ margin: 0 }}>Hòm này chưa có gì để mở (hoặc bạn đã có hết).</p>}
      </div>
      <div className="act"><button type="button" className="btn btn-emerald" data-dlg="loot-open" disabled={!(pool.length && !busy)} onClick={() => { void openIt(); }}>🏺 Mở hòm</button></div>
      <StatusEl s={status} /></>;
  }
  const won = o.won as LootPrize;
  const done = o.phase === 'done';
  return <>{head}
    <div className={`loot-win${done ? ' landed' : ''}`} id="loot-win" ref={win}>
      <div className="loot-strip" id="loot-strip" ref={strip} style={done ? { transform: `translateX(${o.endX}px)` } : undefined}>
        {(o.strip ?? []).map((p, i) => <div key={i} className={`loot-card rar-${p.rarity} ${i === LOOT_AT ? 'prize' : ''}`}>{lootIcon(p)}<b>{p.name}</b>{p.qty > 1 && <span className="qty">×{p.qty}</span>}</div>)}
      </div>
    </div>
    {done ? <>
      <div className={`loot-result rar-${won.rarity}`}>{lootIcon(won)}<div><div className="muted" style={{ fontSize: 12.5 }}>Bạn nhận được</div>
        <b>{won.qty > 1 ? `${won.qty} × ` : ''}{won.name}</b> <Rar r={won.rarity} />
        <div className="muted" style={{ fontSize: 12.5 }}>Đã vào Túi đồ</div></div></div>
      <div className="act"><button type="button" className="btn btn-ghost" data-dlg="close">Đóng</button>
        {(left > 0 || me.bagUnlimited) && <button type="button" className="btn btn-emerald" data-dlg="loot-again" onClick={() => { void again(); }}>🏺 Mở tiếp</button>}</div>
    </> : <p className="muted" style={{ margin: 0, textAlign: 'center' }}>Đang quay…</p>}
  </>;
}
