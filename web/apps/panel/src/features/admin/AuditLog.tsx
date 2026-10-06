import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson, type AuditPage, type PlayerRow } from '@isle/api';
import { Button, Card, CardBody, CardHead, Checkbox, TextInput, useToast } from '@isle/ui';
import { dinoName, shortId } from '../../lib/format';
import { useConfirm } from '../../app/confirm';
import { useSession } from '../../app/session';
import { auditName } from './auditNames';
import s from './Admin.module.css';

/** A log line's detail: dates in vi-VN, species by name, SteamIDs as links to the player (by name when known). */
export function auditDetail(raw: string, names: Map<string, string>): ReactNode[] {
  let text = String(raw)
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g, (iso) => {
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleTimeString('vi-VN', { hour12: false })} ${d.toLocaleDateString('vi-VN')}`;
    })
    .replace(/\bBP_([A-Za-z0-9_]+)_C\b/g, (full) => dinoName(full));
  const out: ReactNode[] = [];
  const re = /\b(7656\d{13})(?:\/([a-zA-Z0-9_.-]+))?\b/g;
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const id = m[1]!;
    const name = names.get(id);
    out.push(<a key={`${m.index}`} href={`#player/${id}`} className={s.plink} title={`SteamID: ${id}`}>{name ? <b>{name}</b> : <span className={s.mono}>{shortId(id)}</span>}</a>);
    if (m[2]) out.push(' / ', <span key={`${m.index}s`} className={s.mono}>{m[2]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  text = '';
  return out;
}

/** Quản trị → Nhật ký admin: every change and panel login, 7 days, searchable; the super admin may delete lines. */
export function AuditLog() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { me } = useSession();
  const [page, setPage] = useState(1);
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => { const t = setTimeout(() => { setQ(typed.trim()); setPage(1); }, 250); return () => clearTimeout(t); }, [typed]);
  const url = `/api/server/audit?page=${page}&limit=30${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const data = useQuery({ queryKey: ['audit', url], queryFn: () => getJson<AuditPage>(url), refetchInterval: 5000, placeholderData: keepPreviousData }).data;
  const players = useQuery({ queryKey: ['/api/players'], queryFn: () => getJson<{ players: PlayerRow[] }>('/api/players') }).data?.players;
  const names = useMemo(() => new Map((players ?? []).filter((p) => p.name).map((p) => [p.steamId, p.name as string])), [players]);
  const entries = data?.entries ?? [];
  const del = me?.super === true && entries.some((e) => e.key);
  const keysHere = entries.map((e) => e.key).filter((k): k is string => !!k);
  const remove = (keys: string[]): void => confirm({
    title: `Xoá ${keys.length} dòng nhật ký?`, body: 'Các dòng bị xoá khỏi nhật ký admin (máy chủ giữ một bản sao trước khi xoá). Việc xoá không được ghi lại.', okLabel: 'Xoá',
    run: async (token) => {
      await adminFetch('/api/server/audit/delete', 'POST', token, { keys });
      setPicked((p) => { const n = new Set(p); for (const k of keys) n.delete(k); return n; });
      await qc.invalidateQueries({ queryKey: ['audit'] });
      toast(`Đã xoá ${keys.length} dòng`);
    },
  });
  const pages = data?.pages ?? 1;
  const around = [...new Set([1, page - 2, page - 1, page, page + 1, page + 2, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  return (
    <Card>
      <CardHead title="Nhật ký admin" sub="mọi thay đổi và mọi lượt đăng nhập panel · giữ 7 ngày rồi tự xoá">
        <TextInput type="search" className={s.search} placeholder="Tìm: tên, SteamID, thao tác…" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Tìm trong nhật ký" />
      </CardHead>
      <CardBody>
        {del && (
          <div className={s.delBar}>
            <Checkbox checked={keysHere.length > 0 && keysHere.every((k) => picked.has(k))} label="Chọn cả trang"
              onChange={(on) => setPicked((p) => { const n = new Set(p); for (const k of keysHere) { if (on) n.add(k); else n.delete(k); } return n; })} />
            <span className={s.muted}>{picked.size} dòng đã chọn</span>
            <Button variant="danger" small className={s.delGo} disabled={picked.size === 0} onClick={() => remove([...picked])}>Xoá đã chọn</Button>
          </div>
        )}
        <div className={s.tableWrap}>
          <table className={s.audit}>
            <thead><tr>{del && <th className={s.pick} />}<th>Thời gian</th><th>Admin</th><th>Thao tác</th><th>Thay đổi</th>{del && <th className={s.pick} />}</tr></thead>
            <tbody>
              {!data ? <tr><td colSpan={del ? 6 : 4} className={s.empty}>Đang tải…</td></tr>
                : entries.length === 0 ? <tr><td colSpan={del ? 6 : 4} className={s.empty}>{q ? 'Không có dòng nào khớp' : 'Chưa có thao tác nào trong 7 ngày qua'}</td></tr>
                  : entries.map((e, i) => {
                    const d = new Date(e.t * 1000);
                    return (
                      <tr key={e.key ?? `${e.t}-${i}`}>
                        {del && <td className={s.pick}>{e.key && <Checkbox checked={picked.has(e.key)} onChange={(on) => setPicked((p) => { const n = new Set(p); if (on) n.add(e.key!); else n.delete(e.key!); return n; })} />}</td>}
                        <td className={s.when}>{d.toLocaleTimeString('vi-VN', { hour12: false })}<div className={s.d}>{d.toLocaleDateString('vi-VN')}</div></td>
                        <td className={s.who}>{e.byId ? <><b>{e.byName ?? names.get(e.byId) ?? 'Không rõ tên'}</b><div className={s.id}>{e.byId}</div></>
                          : e.by === 'ADMIN_TOKEN' ? <b>Script (ADMIN_TOKEN)</b> : e.by ? e.by : <span className={s.muted}>Hệ thống</span>}</td>
                        <td className={`${s.what}${e.ok ? '' : ` ${s.fail}`}`}>{e.ok ? '' : '✗ '}{auditName(e.action)}</td>
                        <td className={s.detail}>{auditDetail(e.detail ?? '', names)}{e.error && <div className={s.err}>{e.error}</div>}</td>
                        {del && <td className={s.pick}>{e.key && <button type="button" className={s.delOne} title="Xoá dòng này" aria-label="Xoá dòng này" onClick={() => remove([e.key!])}>🗑</button>}</td>}
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
        {data && (
          <div className={s.pager}>
            <span className={s.muted}>{data.total} dòng · trang {data.page}/{pages}</span>
            <Button variant="ghost" small disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</Button>
            {around.map((p, i) => (
              <span key={p} className={s.pagerItem}>{i > 0 && p - around[i - 1]! > 1 && <span className={s.muted}>…</span>}
                <Button variant="ghost" small className={p === page ? s.on : undefined} onClick={() => setPage(p)}>{p}</Button></span>
            ))}
            <Button variant="ghost" small disabled={page >= pages} onClick={() => setPage(page + 1)}>›</Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
