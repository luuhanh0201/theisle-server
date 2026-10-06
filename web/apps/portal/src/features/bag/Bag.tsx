import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PlayerMe } from '@isle/api';
import { ERROR_VI, waitCommand } from '../../lib/commands';
import { portalGet } from '../../lib/http';
import { ME } from '../../lib/queries';
import { replyVi } from '../gara/garage';
import { BAG_DIET, BAG_NO_DINO, BAG_RARITY, bagCat, bagHex, bagView, BAG_CATS, pctOf, type BagGroup, type BoxOptions, type DinoOptions, type LootOptions, type Preview } from './bag';
import { BagDialog, type Open } from './BagDialog';
import { BAG_TICKET, MutIcon, type Status } from './parts';

const Msgs = ({ list }: { list: string[] }) => <>{list.map((m, i) => <span key={i}>{i > 0 && <br />}{replyVi(m)}</span>)}</>;

/**
 * Túi đồ (#bag): the items of this account (/api/me items), a card per kind with how many, tabs by kind,
 * a search; "Dùng" opens the box for that use (a slot, a ticket's pick, a dino box opened, a dino item into
 * the garage, a hòm rolled), "Mặc" wears a skin. Each use goes to the game (the bridge queues it, DinoGarage
 * does it); the copy leaves the bag once the game confirms.
 */
export function Bag({ me }: { me: PlayerMe | null | undefined }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [dlgStatus, setDlgStatus] = useState<Status>(null);
  // The dialog is shown when a use asks for it (as before React: showModal once), not whenever `open` is set:
  // closed while a use is on its way, it stays closed. `token` counts the requests, so a late "close" event of
  // the dialog before does not drop a new one.
  const dlg = useRef<HTMLDialogElement>(null);
  const token = useRef(0);
  const [show, setShow] = useState(0);
  const present = (o: Open): void => { token.current += 1; setOpen(o); setShow((n) => n + 1); };
  const closeDialog = (): void => { dlg.current?.close(); setOpen(null); };
  const v = me?.bag ? bagView(me, filter, query) : null;
  // A kind emptied: back to everything (and it stays there).
  useEffect(() => { if (v && v.filter !== filter) setFilter(v.filter); }, [v, filter]);

  const refreshMe = (): Promise<unknown> => qc.refetchQueries({ queryKey: [ME] });
  const say = (kind: '' | 'ok' | 'bad', node: ReactNode): void => setStatus(node ? { kind, node } : null);

  /** Send a use to the game; its answer in the dialog (or under the bag), the bag read again after. */
  const send = async (url: string, body: unknown, what: string, inDialog = false): Promise<void> => {
    const sayIn = (kind: '' | 'ok' | 'bad', node: ReactNode): void => (inDialog ? setDlgStatus({ kind, node }) : say(kind, node));
    setBusy(true);
    sayIn('', `Đang gửi ${what}…`);
    try {
      const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const b = await r.json().catch(() => null) as { id?: unknown; error?: string } | null;
      if (r.status === 429) { sayIn('bad', 'Chậm lại chút: mỗi vài giây chỉ một lệnh.'); return; }
      if (r.status !== 202 || typeof b?.id !== 'number') { sayIn('bad', `❌ ${b?.error ?? 'Không gửi được lệnh.'}`); return; }
      sayIn('', 'Đã gửi, chờ game xử lý…');
      const done = await waitCommand(b.id, 20, (c) => c?.status === 'done');
      if (done === null) { sayIn('bad', 'Chưa thấy game trả lời. Vật phẩm vẫn còn trong túi, thử lại sau.'); return; }
      const msgs = done.messages ?? [];
      if (!done.ok) {
        sayIn('bad', <>❌ {msgs.length ? <Msgs list={msgs} /> : (ERROR_VI[done.error ?? ''] ?? done.error ?? 'Game từ chối.')} Vật phẩm vẫn còn trong túi.</>);
        return;
      }
      if (inDialog) closeDialog();
      say('ok', <>✅ {msgs.length ? <Msgs list={msgs} /> : 'Xong.'}</>);
    } catch {
      sayIn('bad', 'Mất kết nối khi gửi lệnh. Thử lại.');
    } finally {
      setBusy(false);
      // The used copy leaves the bag once the game confirmed: read /me again now.
      await refreshMe();
    }
  };

  const openUse = async (g: BagGroup): Promise<void> => {
    const r = await portalGet<Preview & { error?: string }>(`/api/items/preview/${encodeURIComponent(g.uids[0] ?? '')}`).catch((e: Error) => ({ error: e.message }) as Preview & { error?: string });
    if (!r || 'error' in r && r.error || !Array.isArray(r.slots)) { say('bad', `❌ ${(r as { error?: string } | null)?.error ?? 'Không đọc được dino đang chơi.'}`); return; }
    const slots = r.slots;
    const first = g.type === 'mutation_clear' ? slots.find((x) => x.name)?.slot ?? null
      : slots.find((x) => x.open && !x.name && (!g.slot2 || x.slot === 2 || x.slot === 4))?.slot ?? null;
    setDlgStatus(null);
    present({ kind: 'use', g, pv: r, slot: first, pick: null });
  };
  const openBox = async (g: BagGroup): Promise<void> => {
    say('', 'Đang mở hộp…');
    const r = await portalGet<BoxOptions>(`/api/items/box-options/${encodeURIComponent(g.uids[0] ?? '')}`).catch((e: Error) => ({ error: e.message }));
    if (!r || 'error' in r) { say('bad', `❌ ${(r as { error?: string } | null)?.error ?? 'Không đọc được hộp.'}`); return; }
    setStatus(null);
    setDlgStatus(null);
    present({ kind: 'box', g, opts: r, species: '', phase: 'pick', result: null });
  };
  const openDino = async (uid: string, g?: BagGroup): Promise<void> => {
    say('', 'Đang tải mutation…');
    const r = await portalGet<DinoOptions>(`/api/items/dino-options/${encodeURIComponent(uid)}`).catch((e: Error) => ({ error: e.message }));
    if (!r || 'error' in r) { say('bad', `❌ ${(r as { error?: string } | null)?.error ?? 'Không đọc được vật phẩm dino.'}`); return; }
    setStatus(null);
    setDlgStatus(null);
    present({ kind: 'dino', g: g ?? ({ uids: [uid], name: `Dino ${r.label} ${pctOf(r.growth)}`, rarity: 'legendary' } as BagGroup), uid, opts: r, female: false, muts: { 1: '', 2: '', 3: '', 4: '' } });
  };
  const openLoot = async (g: BagGroup): Promise<void> => {
    say('', 'Đang mở hòm…');
    const r = await portalGet<LootOptions>(`/api/items/loot-options/${encodeURIComponent(g.uids[0] ?? '')}`).catch((e: Error) => ({ error: e.message }));
    if (!r || 'error' in r) { say('bad', `❌ ${(r as { error?: string } | null)?.error ?? 'Không đọc được hòm.'}`); return; }
    setStatus(null);
    setDlgStatus(null);
    present({ kind: 'loot', g, opts: r, phase: 'pool', won: null, strip: null, endX: 0 });
  };
  const use = (g: BagGroup): void => {
    if (g.type === 'loot_box') void openLoot(g);
    else if (g.type === 'dino_box') void openBox(g);
    else if (g.type === 'dino') void openDino(g.uids[0] ?? '', g);
    else void openUse(g);
  };

  if (!me?.bag || !v) return null;
  const blocked = v.prison ? 'Đang ở tù' : v.dino === null ? 'Vào game để dùng' : null;
  const button = (g: BagGroup, cls: string, label: string, onClick: () => void, attr: 'data-bag-use' | 'data-bag-wear') => {
    const ok = v.usable(g) && !busy;
    // Being tried (svip.ts): shown, but for SVip first.
    if (g.locked) return <button type="button" className={`btn ${cls}`} disabled title={g.locked}>{/phát triển/.test(g.locked) ? '🔒 Đang phát triển' : '🧪 Đang thử nghiệm'}</button>;
    const text = ok || v.mismatch(g) || !blocked || BAG_NO_DINO.has(g.type) ? label : blocked;
    return <button type="button" className={`btn ${cls}`} {...{ [attr]: g.key }} disabled={!ok} title={ok ? undefined : blocked && !v.mismatch(g) ? `${blocked}: điều khiển một con dino trong game` : ''} onClick={onClick}>{text}</button>;
  };
  const rar = (g: BagGroup) => <span className={`rar-label rar-${g.rarity}`}>{BAG_RARITY[g.rarity] ?? g.rarity}</span>;
  const qty = (g: BagGroup) => (me.bagUnlimited && g.type !== 'dino' ? <span className="qty" title="Túi admin: dùng không hết">∞</span>
    : g.uids.length > 1 ? <span className="qty">×{g.uids.length}</span> : null);
  const card = (g: BagGroup) => {
    const ok = !v.mismatch(g);
    const cls = `bag-item rar-${g.rarity}${ok ? '' : ' off'}`;
    if (g.type === 'mutation') {
      return (
        <li key={g.key} className={cls}>
          <div className="top"><MutIcon name={g.mutation} /><div className="nm"><b>{g.name}</b>{rar(g)}</div>{qty(g)}</div>
          <div className="meta">{g.mutation !== g.name && <span>🧬 {g.mutation}</span>}<span>{BAG_DIET[g.diet ?? ''] ?? g.diet}</span>{g.slot2 && <span>Chỉ ô 2 / 4</span>}{g.rarity === 'special' && <span>Mutation nhiệm vụ</span>}</div>
          {g.description && <div className="desc">{g.description}</div>}
          {g.refusal && v.dino && <div className="why">Không dùng được cho {v.dino}: {g.refusal}.</div>}
          <div className="act">{button(g, 'btn-emerald', 'Dùng', () => use(g), 'data-bag-use')}</div>
        </li>
      );
    }
    const t = BAG_TICKET[g.type];
    if (t) {
      return (
        <li key={g.key} className={cls}>
          <div className="top"><span className="mut-ico tk-ico" aria-hidden="true">{t.icon}</span><div className="nm"><b>{g.name}</b>{rar(g)}</div>{qty(g)}</div>
          <div className="desc">{t.desc(g)}</div>
          {g.locked && <div className="why">🧪 {g.locked}</div>}
          <div className="act">{button(g, 'btn-emerald', t.action ?? 'Dùng', () => use(g), 'data-bag-use')}</div>
        </li>
      );
    }
    const colors = g.skin?.colors ?? {};
    return (
      <li key={g.key} className={cls}>
        <div className="top"><div className="nm"><b>{g.name}</b>{rar(g)}</div>{qty(g)}</div>
        <div className="meta"><span>🎨 Skin {g.species ?? ''}</span></div>
        <div className="sw">{['Body', 'Flank', 'Underbelly', 'Markings', 'Eyes'].filter((k) => colors[k]).map((k) => <i key={k} style={{ background: bagHex(colors[k] as { r: number; g: number; b: number }) }} />)}</div>
        {!ok && v.dino && <div className="why">Chỉ mặc được khi đang chơi {g.species ?? ''}.</div>}
        <div className="act">{button(g, 'btn-ghost', 'Mặc', () => { void send('/api/skin', { item: g.key }, 'skin'); }, 'data-bag-wear')}</div>
      </li>
    );
  };
  // More than one kind shown: under a heading each.
  const kinds = [...new Set(v.shown.map((g) => bagCat(g.type)))];
  const list = kinds.length > 1
    ? kinds.flatMap((k) => {
      const of = v.shown.filter((g) => bagCat(g.type) === k);
      const label = BAG_CATS.find((c) => c.key === k)?.label ?? 'Khác';
      return [<li key={`sec-${k}`} className="bag-sec">{label} <span className="bag-n">{of.length}</span></li>, ...of.map(card)];
    })
    : v.shown.map(card);
  const growth = me.dino?.growth;
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 className="card-title">🎒 Túi đồ</h3>
          <span className="card-subtitle">Mutation, phiếu, túi tăng trưởng, hộp food, đá muối: dùng lên dino đang chơi (ô mutation 1 từ 25%, ô 2 từ 50%, ô 3–4 từ 75% tăng trưởng). Hộp dino: mở ra Dino, dùng để nhận vào gara. Skin: mặc lên đúng loài.</span>
        </div>
        <span className="tag" id="bag-count">{me.bagUnlimited ? `${v.groups.length} loại · ∞ (admin)` : `${v.items.length} món`}</span>
      </div>
      <div className="bag-bar">
        <div className="bag-tabs" id="bag-filter">
          {v.tabs.map(([k, label, n]) => (
            <button key={k} type="button" className={`gara-filter-btn${v.filter === k ? ' active' : ''}`} data-bag={k} onClick={() => setFilter(k)}>{label} <span className="bag-n">{n}</span></button>
          ))}
        </div>
        <div className="gara-search-box">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          <input type="text" id="bag-q" placeholder="Tìm vật phẩm…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <p className="muted bag-dino" id="bag-dino">
        {v.prison ? '⛓️ Bạn đang ở tù: không dùng được vật phẩm.'
          : v.dino ? <>Đang chơi: <b>{v.dino}</b>{growth != null ? ` · ${Math.round(growth * 100)}%` : ''}</>
            : 'Vào game và điều khiển một con dino để dùng vật phẩm.'}
      </p>
      <div className={`garage-status${status?.kind ? ` ${status.kind}` : ''}`} id="bag-status" role="status" aria-live="polite" hidden={!status}>{status?.node}</div>
      <ul className="bag-grid" id="bag-list">
        {list.length > 0 ? list : <li className="muted" style={{ padding: 16, textAlign: 'center', gridColumn: '1/-1' }}>{v.items.length ? 'Không có vật phẩm nào khớp.' : 'Túi đồ trống.'}</li>}
      </ul>
      <BagDialog dlg={dlg} token={token} show={show} closeDialog={closeDialog} me={me} open={open} setOpen={setOpen} busy={busy} setBusy={setBusy} status={dlgStatus} setStatus={setDlgStatus}
        send={send} openDino={openDino} refreshMe={refreshMe} sayBag={say} />
    </div>
  );
}
