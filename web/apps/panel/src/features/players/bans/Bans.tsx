import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson, type MessagesSettings, type PlayerRow } from '@isle/api';
import { Button, Card, CardBody, CardHead, DateTimeInput, Field, Select, TextArea, TextInput, useToast } from '@isle/ui';
import { useConfirm } from '../../../app/confirm';
import { useSession } from '../../../app/session';
import { getDraft, setDraft } from '../../settings-form/drafts';
import { ListTools, Pager, Seg, pageOf } from '../../../components/list/List';
import t from '../../../components/table/Table.module.css';
import { dateTime, dinoName } from '../../../lib/format';
import s from './Bans.module.css';

/** A ban in the game's list (bridge/src/bans.ts Ban) with what GET /api/bans adds. */
export interface BanRow {
  steamId: string; bannedTime: string; name: string; reason: string; bannedAt: number | null; endsAt: number | null; permanent: boolean; by: string;
  duration: string; active: boolean;
}
interface BansView { bans: BanRow[]; reasons: string[]; permanentHours: number; rcon: boolean; admins: string[] }
const URL = '/api/bans';
const REASONS_URL = '/api/ban-reasons';
const LIMIT = 20;
export const HOURS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '1', label: '1 giờ' }, { value: '6', label: '6 giờ' }, { value: '24', label: '1 ngày' }, { value: '72', label: '3 ngày' },
  { value: '168', label: '7 ngày' }, { value: '720', label: '30 ngày' }, { value: 'perm', label: 'Vĩnh viễn' },
];
export const isSteamId = (v: string): boolean => /^7656119\d{10}$/.test(v);
/** The list the search and the filter keep. */
export function banMatch(b: BanRow, q: string, status: 'all' | 'active' | 'expired'): boolean {
  if (status === 'active' && !b.active) return false;
  if (status === 'expired' && b.active) return false;
  const n = q.trim().toLowerCase();
  return !n || [b.name ?? '', b.steamId, b.reason ?? ''].some((v) => v.toLowerCase().includes(n));
}

/** Người chơi → Ban (bridge/src/bans.ts): ban with a reason and a time, the reasons offered, the game's ban list (unban, edit). */
export function Bans() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { withToken } = useSession();
  const d = useQuery({ queryKey: [URL], queryFn: () => getJson<BansView>(URL), refetchInterval: 2000 }).data;
  const players = useQuery({ queryKey: ['/api/players'], queryFn: () => getJson<{ players: PlayerRow[] }>('/api/players'), refetchInterval: 5000 }).data?.players ?? [];
  // The texts as the panel saved them: the preview of what the whole server will read.
  const msgs = useQuery({ queryKey: ['/api/messages'], queryFn: () => getJson<MessagesSettings>('/api/messages'), staleTime: 60_000 }).data;
  const online = players.filter((p) => p.online);
  // null: the first one online (as the old select opened); '': a SteamID typed in.
  const [who, setWho] = useState<string | null>(null);
  const [steam, setSteam] = useState('');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState('72');
  // The reasons as edited, null while untouched (then the server's list shows). Kept across pages, and saved from the unsaved bar.
  const [reasons, setReasons] = useState<string | null>(() => (getDraft(REASONS_URL) as string | undefined) ?? null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'expired'>('all');
  const [page, setPage] = useState(1);
  const reload = (): void => { void qc.invalidateQueries({ queryKey: [URL] }); };

  // The player picked (online) or typed (SteamID + name).
  const picked = who === null ? online[0] : online.find((p) => p.steamId === who);
  const manual = picked === undefined;
  const steamId = picked === undefined ? steam.trim() : picked.steamId;
  const shownName = picked === undefined ? name.trim() : picked.name ?? '';
  const perm = hours === 'perm';
  const durText = HOURS.find((h) => h.value === hours)?.label ?? '';
  const tpl = msgs ? msgs.texts['ban.announce'] ?? msgs.catalog.find((c) => c.key === 'ban.announce')?.default ?? null : null;
  const preview = tpl === null ? null : tpl === '' ? null
    : String(tpl).replace(/\{(\w+)\}/g, (all, k: string) => ({ name: shownName || steamId || 'Rex', reason: reason.trim() || '(chưa ghi lý do)', by: 'admin', duration: perm ? 'vĩnh viễn' : durText, until: '' } as Record<string, string>)[k] ?? all);
  const isAdmin = (d?.admins ?? []).includes(steamId);

  const ban = (): void => {
    if (!isSteamId(steamId)) { toast('Chọn người chơi hoặc nhập SteamID64 đúng.', 'err'); return; }
    const why = reason.trim();
    if (!why) { toast('Cần ghi lý do ban.', 'err'); return; }
    const label = shownName || steamId;
    confirm({
      title: `Ban ${label}?`, okLabel: 'Ban',
      body: <>
        <p style={{ margin: '0 0 8px' }}>Ban <b>{label}</b> <span className={t.mono}>{steamId}</span>, <b>{perm ? 'vĩnh viễn' : durText}</b>.</p>
        <p style={{ margin: '0 0 8px' }}>Lý do: {why}</p>
        <p style={{ margin: 0 }} className={t.muted}>Gỡ hoặc sửa sau ở danh sách ban bên dưới.</p>
      </>,
      run: async (token) => {
        const r = await adminFetch<{ kicked?: boolean }>(URL, 'POST', token, { steamId, name: shownName, reason: why, hours: perm ? d?.permanentHours ?? 87600 : Number(hours) });
        toast(`Đã ban ${label}${r.kicked ? ' và kick khỏi server' : ''}.`);
        setReason('');
        reload();
      },
    });
  };
  const unban = (b: BanRow): void => confirm({
    title: `Gỡ ban ${b.name}?`, okLabel: 'Gỡ ban', danger: false,
    body: <>
      <p style={{ margin: '0 0 8px' }}>Gỡ ban <b>{b.name}</b> <span className={t.mono}>{b.steamId}</span>.</p>
      <p style={{ margin: '0 0 8px' }}>Lý do ban: {b.reason || '(không ghi)'}<br />Ban lúc {b.bannedAt ? dateTime(b.bannedAt) : '-'} · {b.duration}</p>
      <p style={{ margin: 0 }} className={t.muted}>Chắc chắn có hiệu lực sau lần khởi động lại server kế tiếp.</p>
    </>,
    run: async (token) => { await adminFetch('/api/bans/unban', 'POST', token, { steamId: b.steamId, bannedTime: b.bannedTime }); toast(`Đã gỡ ban ${b.name}.`); reload(); },
  });
  const edit = (b: BanRow): void => {
    const form = { current: { mode: 'keep', at: '', reason: b.reason } };
    confirm({
      title: `Sửa ban ${b.name}`, okLabel: 'Lưu', danger: false,
      body: <EditBan b={b} form={form} />,
      run: async (token) => {
        const f = form.current;
        const body: { steamId: string; bannedTime: string; endsAt?: number | 'permanent'; reason?: string } = { steamId: b.steamId, bannedTime: b.bannedTime };
        if (f.mode === 'perm') body.endsAt = 'permanent';
        else if (f.mode === 'at') {
          const at = Math.floor(new Date(f.at).getTime() / 1000);
          if (!Number.isFinite(at)) throw new Error('Chọn ngày giờ hết hạn.');
          body.endsAt = at;
        } else if (f.mode !== 'keep') body.endsAt = Math.floor(Date.now() / 1000) + Number(f.mode) * 3600;
        const why = f.reason.trim();
        if (why !== b.reason) body.reason = why;
        if (body.endsAt === undefined && body.reason === undefined) throw new Error('Chưa đổi gì.');
        await adminFetch('/api/bans/edit', 'POST', token, body);
        toast(`Đã sửa ban ${b.name}.`);
        reload();
      },
    });
  };

  const saveReasons = (): Promise<boolean> => withToken('lưu mẫu lý do ban', async (token) => {
    const list2 = (reasons ?? (d?.reasons ?? []).join('\n')).split('\n').map((x) => x.trim()).filter(Boolean);
    await adminFetch(REASONS_URL, 'PUT', token, { reasons: list2 });
    setReasons(null);
    toast('Đã lưu mẫu lý do.');
    reload();
  });
  const saveRef = useRef(saveReasons);
  saveRef.current = saveReasons;
  const reasonsDirty = reasons !== null && d !== undefined && reasons !== d.reasons.join('\n');
  useEffect(() => {
    setDraft(REASONS_URL, reasonsDirty ? { label: 'Mẫu lý do ban', href: '#players/bans', value: reasons, save: () => void saveRef.current() } : null);
  }, [reasonsDirty, reasons]);

  const list = (d?.bans ?? []).filter((b) => banMatch(b, q, status));
  const shown = pageOf(list, page, LIMIT);
  const options = [...online.map((p) => ({ value: p.steamId, label: `${p.name ?? p.steamId} · ${dinoName(p.species ?? '')} (online)` })), { value: '', label: 'Nhập SteamID khác…' }];
  return (
    <>
      <div className={s.grid}>
        <Card>
          <CardHead title="Ban người chơi" sub="RCON · có lý do, có thời hạn" />
          <CardBody stack>
            <Field label="Người chơi" htmlFor="ban-player"><Select id="ban-player" value={picked?.steamId ?? ''} options={options} onChange={setWho} /></Field>
            {manual && (
              <div className={s.row}>
                <TextInput aria-label="SteamID64" placeholder="SteamID64 (7656119…)" inputMode="numeric" maxLength={17} value={steam} onChange={(e) => setSteam(e.target.value)} />
                <TextInput aria-label="Tên" placeholder="Tên (không bắt buộc)" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            )}
            <Field label="Lý do" htmlFor="ban-reason">
              <div className={s.stack}>
                <Select aria-label="Chọn mẫu lý do" value="" options={[{ value: '', label: 'Chọn mẫu lý do…' }, ...(d?.reasons ?? []).map((r) => ({ value: r, label: r }))]} onChange={(v) => { if (v) setReason(v); }} />
                <TextArea id="ban-reason" rows={2} maxLength={200} placeholder="Ghi lý do (người chơi và cả server sẽ thấy)" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            </Field>
            <Field label="Thời hạn" htmlFor="ban-hours"><Select id="ban-hours" value={hours} options={HOURS} onChange={setHours} /></Field>
            {(tpl === '' || preview || isAdmin) && (
              <div className={s.preview}>
                {tpl === '' ? <span className={t.muted}>Thông báo toàn server khi ban đang tắt.</span> : <><span className={t.muted}>Cả server sẽ thấy:</span><br />{preview}</>}
                {isAdmin && <><br /><b className={s.warn}>⚠ Tài khoản này là admin server (AdminsSteamIDs): game không chặn admin vào lại, panel sẽ tự kick mỗi lần họ vào khi còn hạn ban.</b></>}
              </div>
            )}
            <div><Button variant="dangerSolid" onClick={ban}>Ban</Button></div>
            <div className={s.hint}>Người đang online nhận tin riêng (lý do, thời hạn) rồi bị kick sau ~3 giây. Ai còn hạn ban mà vẫn vào được
              server (vd. tài khoản admin) sẽ bị panel tự kick lại mỗi lần vào. Mọi lần ban, kể cả ban trong
              bảng admin của game, đều được báo cho cả server và ghi lên Discord (loại log "Ban"). Nội dung tin sửa ở
              {' '}<a href="#mods/messages">Tính năng mod → Thông báo → Ban người chơi</a>.</div>
          </CardBody>
        </Card>
        <Card>
          <CardHead title="Mẫu lý do" sub="mỗi dòng một mẫu" />
          <CardBody stack>
            <TextArea aria-label="Mẫu lý do" rows={9} maxLength={6000} value={reasons ?? (d?.reasons ?? []).join('\n')} onChange={(e) => setReasons(e.target.value)} />
            <div><Button variant="soft" onClick={() => void saveReasons()}>Lưu mẫu lý do</Button></div>
          </CardBody>
        </Card>
      </div>
      <Card className={s.list}>
        <CardHead title="Danh sách ban" sub={d ? `${d.bans.filter((b) => b.active).length} đang ban · ${d.bans.length} tất cả` : ''} />
        <CardBody>
          <ListTools q={q} onQ={(v) => { setQ(v); setPage(1); }} placeholder="Tìm theo tên, SteamID hoặc lý do ban…">
            <Seg label="Lọc trạng thái ban" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[['all', 'Tất cả'], ['active', 'Đang ban'], ['expired', 'Hết hạn']]} />
          </ListTools>
          <div className={t.wrap}><table className={t.table}>
            <thead><tr><th>Người chơi</th><th>Lý do</th><th>Thời hạn</th><th>Ban lúc</th><th>Hết hạn</th><th>Người ban</th><th /></tr></thead>
            <tbody>
              {shown.rows.length === 0 && <tr><td colSpan={7} className={t.muted}>{q ? 'Không tìm thấy người chơi bị ban nào phù hợp' : 'Chưa ai bị ban.'}</td></tr>}
              {shown.rows.map((b) => (
                <tr key={`${b.steamId}|${b.bannedTime}`} className={b.active ? undefined : s.off}>
                  <td><b>{b.name}</b>{(d?.admins ?? []).includes(b.steamId) && <span className={s.tag} title="Game không chặn admin vào lại; panel tự kick"> admin</span>}<br /><span className={`${t.mono} ${t.muted}`}>{b.steamId}</span></td>
                  <td>{b.reason || '(không ghi)'}</td>
                  <td>{b.duration}{!b.active && <> · <i>hết hạn</i></>}</td>
                  <td>{b.bannedAt ? dateTime(b.bannedAt) : '-'}</td>
                  <td>{b.permanent ? 'không' : b.endsAt ? dateTime(b.endsAt) : '-'}</td>
                  <td>{b.by === 'Rcon' ? 'panel / RCON' : b.by}</td>
                  <td className={s.nowrap}>{b.active && <>
                    <Button variant="soft" small onClick={() => edit(b)}>Sửa</Button>{' '}
                    <Button variant="ghost" small className={t.del} onClick={() => unban(b)}>Gỡ ban</Button></>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <Pager total={list.length} page={shown.page} limit={LIMIT} unit="lượt ban" onPage={setPage} />
          <div className={s.hint} style={{ marginTop: 8 }}>Lấy từ danh sách ban của game (PlayerBans.json). Gỡ ban / sửa: RCON không có lệnh này nên panel sửa
            thẳng danh sách của game (có sao lưu trước, và tự áp lại nếu game ghi đè). Game có áp dụng ngay khi đang chạy hay không <b>chưa kiểm chứng</b>,
            chắc chắn có hiệu lực sau lần khởi động lại server kế tiếp.</div>
        </CardBody>
      </Card>
    </>
  );
}

const MODES = [
  { value: 'keep', label: 'Giữ nguyên' }, { value: '1', label: '1 giờ nữa' }, { value: '6', label: '6 giờ nữa' }, { value: '24', label: '1 ngày nữa' },
  { value: '72', label: '3 ngày nữa' }, { value: '168', label: '7 ngày nữa' }, { value: '720', label: '30 ngày nữa' }, { value: 'perm', label: 'Vĩnh viễn' }, { value: 'at', label: 'Chọn ngày giờ…' },
];
/** The edit dialog's body: when it ends and why, kept in `form` for the dialog's run(). */
function EditBan({ b, form }: { b: BanRow; form: MutableRefObject<{ mode: string; at: string; reason: string }> }) {
  const [f, setF] = useState(form.current);
  const set = (p: Partial<typeof f>): void => { const n = { ...f, ...p }; form.current = n; setF(n); };
  return (
    <>
      <p style={{ margin: '0 0 10px' }}><b>{b.name}</b> <span className={t.mono}>{b.steamId}</span>, ban lúc {b.bannedAt ? dateTime(b.bannedAt) : '-'}, hiện: <b>{b.duration}</b>{b.permanent ? '' : b.endsAt ? ` (hết ${dateTime(b.endsAt)})` : ''}</p>
      <Field label="Hết hạn" htmlFor="be-mode">
        <div className={s.stack}>
          <Select id="be-mode" value={f.mode} options={MODES} onChange={(v) => set({ mode: v })} />
          {f.mode === 'at' && <DateTimeInput kind="datetime" aria-label="Hết hạn lúc" value={f.at} onChange={(v) => set({ at: v })} />}
        </div>
      </Field>
      <div style={{ marginTop: 10 }}><Field label="Lý do" htmlFor="be-reason"><TextArea id="be-reason" rows={2} maxLength={200} value={f.reason} onChange={(e) => set({ reason: e.target.value })} /></Field></div>
    </>
  );
}
