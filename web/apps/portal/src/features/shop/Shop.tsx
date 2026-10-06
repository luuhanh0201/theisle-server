import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { NumberInput } from '@isle/ui';
import { useToast } from '../../app/toast';
import { useTab } from '../../app/router';
import { Amber } from '../../lib/amber';
import { ME } from '../../lib/queries';
import { BAG_CATS, BAG_RARITY, bagCat, type BagGroup } from '../bag/bag';
import { BAG_TICKET, MutIcon, type Status } from '../bag/parts';
import s from './Shop.module.css';

/** A listing (bridge shop.ts shopView): the item, its price, how many may still be bought today (null: no limit). */
export interface Listing {
  id: string; price: number; dailyLimit: number; bought: number; left: number | null; owned?: boolean;
  item: { id: string; type: string; name: string; rarity: string; description?: string; data: Record<string, unknown> };
}
/** GET /api/shop: the balance, the most per buy, the listings; `locked`: shown but not for this account yet. */
export interface ShopData { currency: string; balance: number; maxQty?: number; listings: Listing[]; locked?: string }

/** A listing's item as the bag's card texts read it (BAG_TICKET). */
const shopG = (l: Listing): BagGroup => ({ ...l.item.data, type: l.item.type, name: l.item.name, rarity: l.item.rarity } as unknown as BagGroup);
const ShopIcon = ({ l }: { l: Listing }) => (l.item.type === 'mutation' ? <MutIcon name={l.item.data['mutation']} />
  : <span className="mut-ico tk-ico" aria-hidden="true">{l.item.type === 'skin' ? '🎨' : BAG_TICKET[l.item.type]?.icon ?? '🎁'}</span>);
const shopDesc = (l: Listing): ReactNode => (l.item.type === 'mutation' ? l.item.description ?? String(l.item.data['mutation'] ?? '')
  : l.item.type === 'skin' ? <>Skin cho <b>{String(l.item.data['species'] ?? '')}</b>, mặc lên dino đúng loài.</> : BAG_TICKET[l.item.type]?.desc(shopG(l)) ?? '');
/** Why this listing cannot be bought now, or null. */
export function shopBlock(d: ShopData, l: Listing): string | null {
  if (d.locked) return '🧪 Đang thử nghiệm';
  if (l.owned) return 'Đã có';
  if (l.left === 0) return 'Hết lượt hôm nay';
  if (l.price > d.balance) return 'Chưa đủ Hổ phách';
  return null;
}
/** The most of one listing that may be bought at once (the shop's max, what is left today, what the balance pays). */
export const shopMax = (d: ShopData, l: Listing): number => Math.max(1, Math.min(d.maxQty ?? 10, l.left ?? Infinity, Math.floor(d.balance / l.price) || 1));

/**
 * Cửa hàng Hổ phách (#shop; bridge shop.ts; owner, 2026-10-05): items bought with Hổ phách, a daily limit per item,
 * 1-10 at a time; a box to confirm with the total and what is left. Bought: into the bag. Read when the page is
 * opened, then every 30 s while it is shown (a new day, the balance from a quest).
 */
export function Shop() {
  const qc = useQueryClient();
  const toast = useToast();
  const tab = useTab();
  const [data, setData] = useState<ShopData | null>(null);
  const [filter, setFilter] = useState('all');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [open, setOpen] = useState<{ l: Listing; qty: number } | null>(null);
  const [dlgError, setDlgError] = useState<string | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const busyNow = useRef(busy);
  busyNow.current = busy;
  const openNow = useRef(open);
  openNow.current = open;

  const load = useCallback(async (): Promise<void> => {
    const r = await fetch('/api/shop', { credentials: 'same-origin' }).catch(() => null);
    const body = await r?.json().catch(() => null) as (ShopData & { error?: string }) | null;
    if (r?.status !== 200 || !body) { setStatus({ kind: 'bad', node: `❌ ${body?.error ?? 'Không tải được cửa hàng.'}` }); return; }
    setData(body);
    setStatus(body.locked ? { kind: '', node: `🧪 ${body.locked}` } : null);
  }, []);
  // Opened (as before React: each time the page is shown), then every 30 s while it is shown.
  useEffect(() => {
    if (tab !== 'shop') return undefined;
    void load();
    const t = setInterval(() => { if (!document.hidden && !busyNow.current && !openNow.current) void load(); }, 30_000);
    return () => clearInterval(t);
  }, [tab, load]);

  const buy = async (o: { l: Listing; qty: number }): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setDlgError(null);
    try {
      const r = await fetch('/api/shop/buy', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ listing: o.l.id, qty: o.qty }) });
      const b = await r.json().catch(() => null) as { qty?: number; item?: string; spent?: number; error?: string } | null;
      if (r.status === 429) setDlgError('Chậm lại chút rồi thử lại.');
      else if (r.status !== 200 || !b) setDlgError(`❌ ${b?.error ?? 'Không mua được.'}`);
      else {
        dlg.current?.close();
        setOpen(null);
        setStatus({ kind: 'ok', node: <>✅ Đã mua <b>{b.qty} × {b.item}</b> (<Amber n={b.spent} />). Xem trong <a href="#bag">Túi đồ</a>.</> });
        toast(`✅ Đã mua ${b.qty} × ${b.item}, xem trong Túi đồ`);
      }
    } catch {
      setDlgError('Mất kết nối. Thử lại.');
    } finally {
      setBusy(false);
      // The balance, what is left today and the bag, read again.
      const r = await fetch('/api/shop', { credentials: 'same-origin' }).catch(() => null);
      const body = await r?.json().catch(() => null) as ShopData | null;
      if (r?.status === 200 && body) setData(body);
      void qc.refetchQueries({ queryKey: [ME] });
    }
  };

  const d = data;
  const ls = d?.listings ?? [];
  const counts: Record<string, number> = Object.fromEntries(BAG_CATS.map((c) => [c.key, ls.filter((l) => (c.types as readonly string[]).includes(l.item.type)).length]));
  const f = filter !== 'all' && !counts[filter] ? 'all' : filter;
  useEffect(() => { if (d && f !== filter) setFilter(f); }, [d, f, filter]);
  const shown = ls.filter((l) => f === 'all' || bagCat(l.item.type) === f);
  const card = (l: Listing) => {
    if (!d) return null;
    const block = shopBlock(d, l);
    const unique = l.item.type === 'skin';
    const max = shopMax(d, l);
    const q = Math.min(qty[l.id] ?? 1, max);
    return (
      <li key={l.id} className={`bag-item shop-item rar-${l.item.rarity}`}>
        <div className="top"><ShopIcon l={l} /><div className="nm"><b>{l.item.name}</b><span className={`rar-label rar-${l.item.rarity}`}>{BAG_RARITY[l.item.rarity] ?? l.item.rarity}</span></div></div>
        <div className="desc">{shopDesc(l)}</div>
        <div className="price"><Amber n={l.price} /><span className={`left${l.left === 0 ? ' out' : ''}`}>{l.owned ? 'Đã có trong túi' : l.left === null ? 'Không giới hạn' : `Hôm nay còn ${l.left}/${l.dailyLimit}`}</span></div>
        <div className="act">
          {!unique && !block && <span className={s.qty}><NumberInput aria-label="Số lượng" min={1} max={max} step={1} value={q} onChange={(v) => setQty((x) => ({ ...x, [l.id]: v }))} /></span>}
          <button type="button" className={`btn ${block ? 'btn-ghost' : 'btn-emerald'}`} data-shop-buy={l.id} disabled={Boolean(block) || busy}
            onClick={() => {
              const n = unique ? 1 : Math.max(1, Math.min(max, Math.floor(q) || 1));
              setQty((x) => ({ ...x, [l.id]: n }));
              setDlgError(null);
              setOpen({ l, qty: n });
              if (dlg.current && !dlg.current.open) dlg.current.showModal?.();
            }}>{block ?? 'Mua'}</button>
        </div>
      </li>
    );
  };
  const kinds = [...new Set(shown.map((l) => bagCat(l.item.type)))];
  const list = kinds.length > 1
    ? kinds.flatMap((k) => {
      const of = shown.filter((l) => bagCat(l.item.type) === k);
      return [<li key={`sec-${k}`} className="bag-sec">{BAG_CATS.find((c) => c.key === k)?.label ?? 'Khác'} <span className="bag-n">{of.length}</span></li>, ...of.map(card)];
    })
    : shown.map(card);
  const o = open;
  const total = o ? o.l.price * o.qty : 0;
  const after = d ? d.balance - total : 0;
  return (
    <>
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">🏪 Cửa hàng Hổ phách</h3>
            <span className="card-subtitle">Mua vật phẩm bằng Hổ phách kiếm được khi chơi (điểm danh, nhiệm vụ). Mua xong vật phẩm vào Túi đồ. Mỗi món có giới hạn mua mỗi ngày, làm mới lúc 00:00.</span>
          </div>
          <span className="shop-bal" id="shop-bal">{d && <><span>Bạn có</span><Amber n={d.balance} /></>}</span>
        </div>
        <div className="bag-bar"><div className="bag-tabs" id="shop-filter">
          {d && [['all', 'Tất cả', ls.length] as const, ...BAG_CATS.filter((c) => (counts[c.key] ?? 0) > 0).map((c) => [c.key, c.label, counts[c.key] ?? 0] as const)].map(([k, label, n]) => (
            <button key={k} type="button" className={`gara-filter-btn${f === k ? ' active' : ''}`} data-shop-tab={k} onClick={() => setFilter(k)}>{label} <span className="bag-n">{n}</span></button>
          ))}
        </div></div>
        <div className={`garage-status${status?.kind ? ` ${status.kind}` : ''}`} id="shop-status" role="status" aria-live="polite" hidden={!status}>{status?.node}</div>
        <ul className="bag-grid" id="shop-list">
          {!d ? <li className="muted" style={{ padding: 16, gridColumn: '1/-1' }}>Đang tải cửa hàng…</li>
            : list.length > 0 ? list : <li className="muted" style={{ padding: 16, textAlign: 'center', gridColumn: '1/-1' }}>Cửa hàng chưa có món nào.</li>}
        </ul>
      </div>
      <dialog className="bag-dlg" id="shop-dlg" aria-labelledby="shop-dlg-title" ref={dlg}
        onClose={() => { if (!busyNow.current) setOpen(null); }}
        onClick={(e) => {
          const t = e.target as HTMLElement;
          if (t === dlg.current || t.closest('[data-shop-dlg="close"]')) dlg.current?.close();
        }}>
        <div className="in" id="shop-dlg-in">
          {o && d && <>
            <div className="hd"><ShopIcon l={o.l} /><div><b id="shop-dlg-title">{o.l.item.name}</b>
              {' '}<span className={`rar-label rar-${o.l.item.rarity}`}>{BAG_RARITY[o.l.item.rarity] ?? o.l.item.rarity}</span>
              <div className="muted" style={{ fontSize: 12.5 }}><Amber n={o.l.price} /> mỗi cái</div></div>
              <button type="button" className="x" data-shop-dlg="close" aria-label="Đóng">×</button></div>
            <div className="sec"><h4>Xác nhận mua</h4>
              <div className="cmp">Mua <b>{o.qty} × {o.l.item.name}</b></div>
              <div className="shop-sum"><span className="muted">Tổng</span><b><Amber n={total} /></b><span className="muted">Bạn đang có</span><b><Amber n={d.balance} /></b>
                <span className="muted">Mua xong còn</span><b><Amber n={Math.max(0, after)} /></b></div>
              {o.l.left !== null && <div className="cmp muted">Hôm nay còn mua được {o.l.left - o.qty} cái sau lần này.</div>}
              {after < 0 && <div className="why" style={{ color: '#fbbf24', fontSize: 13 }}>⚠️ Chưa đủ Hổ phách.</div>}
            </div>
            <div className="act"><button type="button" className="btn btn-ghost" data-shop-dlg="close">Huỷ</button>
              <button type="button" className="btn btn-emerald" data-shop-dlg="buy" disabled={after < 0 || busy} onClick={() => { void buy(o); }}>Mua</button></div>
            <div className={`garage-status${dlgError ? ' bad' : ''}`} id="shop-dlg-status" role="status" aria-live="polite" hidden={!dlgError}>{dlgError}</div>
          </>}
        </div>
      </dialog>
    </>
  );
}
