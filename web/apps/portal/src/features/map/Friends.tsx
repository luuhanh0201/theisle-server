import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PlayerMe } from '@isle/api';
import { useTab } from '../../app/router';
import { useToast } from '../../app/toast';
import { RelBadge } from '../../components/RelBadge';
import { portalGet } from '../../lib/http';
import { getMap, setFriendSpots } from '../../lib/mapService';

/** A player as Kết bạn names them (`ref`, never their SteamID). */
interface FrPerson { ref: string; name: string | null; online?: boolean; species?: string | null; pos?: { x: number; y: number; yaw?: number | null } | null; relation?: string }
interface FriendsData { friends: FrPerson[]; incoming: FrPerson[]; outgoing: FrPerson[] }

export const fmtDist = (m: number): string => (m >= 1000 ? `${(m / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`);
const FR_DONE: Record<string, string> = { request: '✅ Đã gửi lời mời kết bạn', accept: '✅ Đã kết bạn', decline: 'Đã từ chối lời mời', cancel: 'Đã huỷ lời mời', remove: 'Đã huỷ kết bạn' };

function Item({ p, sub, children }: { p: FrPerson; sub?: string; children: React.ReactNode }) {
  return (
    <li className="fr-item"><span className={`fr-dot${p.online ? ' on' : ''}`} title={p.online ? 'Đang online' : 'Offline'} />
      <span className="fr-who"><b>{p.name ?? 'Người chơi'}</b>{sub && <span>{sub}</span>}</span><span className="fr-acts">{children}</span></li>
  );
}

/**
 * Kết bạn (bridge friends.ts): find a player by name or SteamID, ask; once accepted, each sees the other on the
 * map, the big map and the mini map. The lists every 2 s while the map shows them.
 */
export function Friends({ me }: { me: PlayerMe | null | undefined }) {
  const toast = useToast();
  const shown = useTab() === 'map';
  const [data, setData] = useState<FriendsData | null>(null);
  const [found, setFound] = useState<FrPerson[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeAsk, setRemoveAsk] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const loading = useRef(false);
  const f = me?.friends ?? null;
  const open = Boolean(f && !f.locked);

  const load = async (): Promise<void> => {
    if (loading.current || !open) return;
    loading.current = true;
    try {
      const d = await portalGet<FriendsData>('/api/friends').catch(() => null);
      if (!d) return;
      setData(d);
      setFriendSpots(d.friends.filter((x) => x.pos).map((x) => ({ name: x.name, x: (x.pos as { x: number }).x, y: (x.pos as { y: number }).y, yaw: x.pos?.yaw ?? null })));
    } finally { loading.current = false; }
  };
  const loadRef = useRef(load);
  loadRef.current = load;
  // Every 2 s while the map page shows them.
  useEffect(() => {
    if (!shown || !open) return undefined;
    const t = setInterval(() => { if (!document.hidden) void loadRef.current(); }, 2000);
    return () => clearInterval(t);
  }, [shown, open]);
  // A new request: the lists at once, not at the next poll.
  const incoming = f && !f.locked ? f.incoming ?? 0 : 0;
  useEffect(() => { if (open && data && incoming !== data.incoming.length) void loadRef.current(); }, [incoming, open, data]);
  // Not open to them (or logged out): forget the lists and the friends on the map.
  useEffect(() => { if (!f) { setData(null); setFound(null); setFriendSpots(null); } }, [f]);
  // "Huỷ kết bạn" waits 4 s for its second click.
  useEffect(() => {
    if (removeAsk === null) return undefined;
    const t = setTimeout(() => setRemoveAsk(null), 4000);
    return () => clearTimeout(t);
  }, [removeAsk]);

  if (!f || !me) return <div className="card" id="map-friends" hidden />;

  const search = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const text = q.trim();
    if (!text || busy) return;
    try {
      const r = await fetch(`/api/friends/search?q=${encodeURIComponent(text)}`, { credentials: 'same-origin' });
      const b = await r.json().catch(() => null) as { results?: FrPerson[]; error?: string } | null;
      if (r.status === 200) setFound(b?.results ?? []);
      else { setFound(null); toast(`❌ ${b?.error ?? 'Không tìm được.'}`); }
    } catch { toast('❌ Mất kết nối. Thử lại.'); }
    if (!data) await load();
  };
  const act = async (action: string, ref: string): Promise<void> => {
    if (busy) return;
    if (action === 'focus') {
      const fr = data?.friends.find((x) => x.ref === ref);
      if (fr?.pos) { getMap().map.focus(fr.pos); document.getElementById('map')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      return;
    }
    if (action === 'ask-remove') { setRemoveAsk(ref); return; }
    setBusy(true); setRemoveAsk(null);
    try {
      const r = await fetch('/api/friends', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ref }) });
      const body = await r.json().catch(() => null) as { result?: string; error?: string } | null;
      if (r.status === 200) {
        toast(action === 'request' && body?.result === 'accepted' ? FR_DONE['accept'] as string : FR_DONE[action] ?? '✅ Xong');
        setFound((list) => list?.map((p) => (p.ref === ref ? { ...p, relation: action === 'request' ? (body?.result === 'accepted' ? 'friend' : 'outgoing') : action === 'accept' ? 'friend' : p.relation } : p)) ?? null);
      } else toast(`❌ ${body?.error ?? 'Không thực hiện được.'}`);
    } catch { toast('❌ Mất kết nối. Thử lại.'); } finally {
      setBusy(false);
      await load();
    }
  };
  const btn = (action: string, ref: string, label: string, cls = 'btn-ghost', title = '') => (
    <button type="button" className={`btn ${cls}`} data-fr={action} data-ref={ref} title={title || undefined} disabled={busy} onClick={() => void act(action, ref)}>{label}</button>
  );
  const myPos = me.dino?.position ?? null;
  const where = (p: FrPerson): string => {
    if (!p.online) return 'Offline';
    if (!p.pos) return 'Online · chưa điều khiển dino';
    const dist = myPos ? ` · cách ${fmtDist(Math.hypot(p.pos.x - myPos.x, p.pos.y - myPos.y) / 100)}` : '';
    return `${p.species ?? 'Đang chơi'}${dist}`;
  };
  const locked = f.locked ?? '';
  return (
    <div className="card" id="map-friends">
      <div className="card-header">
        <div>
          <h3 className="card-title">🤝 Bạn bè <span id="fr-rel"><RelBadge b={me.releases?.['friends']} /></span></h3>
          <span className="card-subtitle">Bạn bè thấy nhau trên bản đồ, bản đồ lớn (M) và mini map</span>
        </div>
        <span className="tag" id="fr-count">{data ? `${data.friends.length} bạn` : '0 bạn'}</span>
      </div>
      <form className="fr-search" id="fr-search" autoComplete="off" onSubmit={(e) => void search(e)}>
        <input className="fr-input" id="fr-q" type="text" maxLength={40} placeholder="Tên trong game hoặc SteamID (17 số)" spellCheck={false} aria-label="Tìm người chơi"
          value={q} disabled={Boolean(locked)} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn btn-emerald" id="fr-find" disabled={Boolean(locked) || busy}>Tìm</button>
      </form>
      <div id="fr-results">
        {found !== null && (found.length === 0
          ? <p className="fr-empty">Không tìm thấy ai. Người chơi phải từng vào server; thử tên khác hoặc SteamID.</p>
          : <ul className="fr-list">{found.map((p) => (
            <Item key={p.ref} p={p} sub={p.online ? 'Đang online' : ''}>
              {p.relation === 'friend' ? <span className="fr-empty">Đã là bạn</span>
                : p.relation === 'outgoing' ? <span className="fr-empty">Đã mời</span>
                  : p.relation === 'incoming' ? btn('accept', p.ref, 'Chấp nhận', 'btn-emerald')
                    : btn('request', p.ref, 'Kết bạn', 'btn-emerald')}
            </Item>
          ))}</ul>)}
      </div>
      <div id="fr-lists">
        {data && (
          <>
            {data.incoming.length > 0 && (
              <div className="fr-sec"><div className="fr-sec-h">Lời mời kết bạn ({data.incoming.length})</div>
                <ul className="fr-list">{data.incoming.map((r) => <Item key={r.ref} p={r}>{btn('accept', r.ref, 'Chấp nhận', 'btn-emerald')}{btn('decline', r.ref, 'Từ chối')}</Item>)}</ul></div>
            )}
            <div className="fr-sec"><div className="fr-sec-h">Bạn bè</div>
              {data.friends.length ? <ul className="fr-list">{data.friends.map((p) => (
                <Item key={p.ref} p={p} sub={where(p)}>
                  {p.pos && btn('focus', p.ref, 'Xem', 'btn-ghost', 'Xem trên bản đồ')}
                  {removeAsk === p.ref ? btn('remove', p.ref, 'Bấm lần nữa để huỷ', 'btn-danger') : btn('ask-remove', p.ref, '✕', 'btn-ghost', 'Huỷ kết bạn')}
                </Item>
              ))}</ul> : <p className="fr-empty">Chưa có bạn nào. Tìm theo tên hoặc SteamID ở trên rồi bấm Kết bạn; người kia chấp nhận là hai bạn thấy nhau trên bản đồ.</p>}
            </div>
            {data.outgoing.length > 0 && (
              <div className="fr-sec"><div className="fr-sec-h">Đã mời, chờ chấp nhận ({data.outgoing.length})</div>
                <ul className="fr-list">{data.outgoing.map((r) => <Item key={r.ref} p={r}>{btn('cancel', r.ref, 'Huỷ lời mời')}</Item>)}</ul></div>
            )}
          </>
        )}
      </div>
      <div className="tele-note" id="fr-locked" hidden={!locked}>{locked ? `🧪 ${locked}` : ''}</div>
    </div>
  );
}
