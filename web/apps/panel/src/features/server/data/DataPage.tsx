import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, LOGIN_URL, adminFetch, getJson, type BackupsView } from '@isle/api';
import { Button, Card, CardBody, CardHead, CheckGrid, Checkbox, FileInput, NumberInput, Switch, Table, useToast } from '@isle/ui';
import { useConfirm } from '../../../app/confirm';
import { useSession } from '../../../app/session';
import { dateTime } from '../../../lib/format';
import t from '../../../components/table/Table.module.css';
import s from './Data.module.css';

const URL = '/api/backups';
export const bkSize = (b: number): string => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const REASON: Record<string, string> = { manual: 'bấm tay', scheduled: 'tự động (restart định kỳ)', 'before-wipe': 'trước khi xoá', 'before-restore': 'trước khi khôi phục' };
export const WIPE_WORDS = 'XOA DU LIEU';

/**
 * Server → Dữ liệu (bridge/src/backup.ts): backups (now, automatic, kept), moving to another VPS
 * (export / restore from a file), and wiping data for a fresh start. A restore or a wipe restarts
 * the bridge: the page reloads after it.
 */
export function DataPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { withToken } = useSession();
  const q = useQuery({ queryKey: [URL], queryFn: () => getJson<BackupsView>(URL), refetchInterval: 2000 });
  // Settings as edited (null = as saved) and the parts ticked for a wipe (all, at first).
  const [auto, setAuto] = useState<boolean | null>(null);
  const [keep, setKeep] = useState<number | null>(null);
  const [parts, setParts] = useState<Record<string, boolean>>({});
  const [file, setFile] = useState<File | null>(null);
  const d = q.data;
  if (!d) return <Card><CardBody><span className={s.muted}>{q.error ? `Không tải được: ${(q.error as Error).message}` : 'Đang tải…'}</span></CardBody></Card>;
  const stopped = d.phase === 'stopped';
  const reload = (): void => { void qc.invalidateQueries({ queryKey: [URL] }); };
  const picked = d.parts.filter((p) => parts[p.key] ?? true);

  /** A restore: the archive in the body (a file) or named in the address (a backup on the VPS). */
  const restore = async (token: string, url: string, body?: File): Promise<void> => {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/gzip', 'x-admin-token': token }, body });
    if (res.status === 401) { location.href = LOGIN_URL; throw new ApiError(401, 'Phiên đăng nhập đã hết, đăng nhập lại'); }
    const data = (await res.json().catch(() => ({}))) as { kind?: string; files?: number; error?: string };
    if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
    toast(`Đã khôi phục ${data.kind === 'settings' ? 'cài đặt' : 'dữ liệu'} (${data.files} file). Panel khởi động lại trong vài giây…`);
    setTimeout(() => location.reload(), 6000);
  };
  const restoreText = (what: React.ReactNode) => <>
    <p style={{ margin: '0 0 8px' }}>{what}</p>
    <p style={{ margin: 0 }}>Dữ liệu hiện có được <b>tự backup trước</b>. Sau đó panel tự khởi động lại.</p>
  </>;

  return (
    <div className={s.page}>
      {!stopped && <div className={s.banner}>Xoá dữ liệu và khôi phục chỉ làm được khi <b>server đã tắt</b>, tắt ở <a href="#server/ops">Server → Vận hành</a>.</div>}
      <Card>
        <CardHead title="Backup dữ liệu người chơi" sub="dino · gara · thống kê · ban">
          <Button className={s.right} onClick={() => void withToken('backup dữ liệu', async (token) => {
            const b = await adminFetch<{ name: string; size: number }>(URL, 'POST', token, {});
            toast(`Đã backup: ${b.name} (${bkSize(b.size)}).`);
            reload();
          })}>Backup ngay</Button>
        </CardHead>
        <CardBody stack>
          <div className={s.row}>
            <Switch checked={auto ?? d.settings.atScheduledRestart} onChange={setAuto} label="Tự backup mỗi lần khởi động lại định kỳ (lúc server đã tắt)" />
            <span className={s.keep}>Giữ <span className={s.keepBox}><NumberInput aria-label="Số bản giữ lại" value={keep ?? d.settings.keep} min={1} max={60} onChange={setKeep} /></span> bản gần nhất</span>
            <Button variant="soft" small onClick={() => void withToken('lưu cài đặt backup', async (token) => {
              await adminFetch('/api/backup-settings', 'PUT', token, { atScheduledRestart: auto ?? d.settings.atScheduledRestart, keep: Math.round(keep ?? d.settings.keep) });
              setAuto(null); setKeep(null);
              toast('Đã lưu.');
              reload();
            })}>Lưu</Button>
          </div>
          <Table cards className={s.table}>
            <thead><tr><th>File</th><th>Loại</th><th>Lúc</th><th>Dung lượng</th><th /></tr></thead>
            <tbody>
              {d.backups.length === 0 && <tr><td colSpan={5} className={s.muted}>Chưa có bản backup nào.</td></tr>}
              {d.backups.map((b) => (
                <tr key={b.name}>
                  <td data-label="File" className={`${t.mono} ${s.file}`}>{b.name}</td>
                  <td data-label="Loại">{b.kind === 'data' ? 'Dữ liệu' : <b>Cài đặt + bí mật</b>}
                    {b.reason && b.kind === 'data' && <><br /><span className={s.small}>{REASON[b.reason] ?? b.reason}</span></>}</td>
                  <td data-label="Lúc">{dateTime(b.createdAt)}</td>
                  <td data-label="Dung lượng">{bkSize(b.size)}</td>
                  <td><div className={s.actions}>
                    <a className={s.link} href={`/api/backups/file/${encodeURIComponent(b.name)}`} download>Tải</a>
                    <Button variant="soft" small disabled={!stopped} title={stopped ? undefined : 'Tắt server trước'} onClick={() => confirm({
                      title: 'Khôi phục bản backup này?', okLabel: 'Khôi phục', body: restoreText(<>Ghi đè bằng <span className={t.mono}>{b.name}</span>.</>),
                      run: (token) => restore(token, `/api/backups/restore?name=${encodeURIComponent(b.name)}`),
                    })}>Khôi phục</Button>
                    <Button variant="ghost" small className={t.del} onClick={() => confirm({
                      title: 'Xoá bản backup?', okLabel: 'Xoá', body: <>Xoá hẳn file <span className={t.mono}>{b.name}</span> trên VPS.</>,
                      run: async (token) => { await adminFetch(`/api/backups/file/${encodeURIComponent(b.name)}`, 'DELETE', token); toast('Đã xoá.'); reload(); },
                    })}>Xoá</Button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className={s.hint}>Lưu trên VPS (<span className={t.mono}>/home/isle/backups/panel</span>), tải về máy bằng nút Tải. Bấm tay khi server đang chạy:
            file save được chép lại nếu game ghi dở trong lúc chép; bản chắc chắn nhất là bản tự động lúc khởi động lại định kỳ.</div>
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Chuyển sang VPS khác" />
        <CardBody stack>
          <div className={s.row}>
            <Button variant="soft" onClick={() => void withToken('xuất cài đặt', async (token) => {
              const b = await adminFetch<{ name: string; skipped?: string[] }>('/api/backups/export-settings', 'POST', token, {});
              toast(b.skipped?.length ? `Đã xuất (không đọc được: ${b.skipped.join(', ')}). Đang tải…` : 'Đã xuất cài đặt. Đang tải…');
              const a = document.createElement('a');
              a.href = `/api/backups/file/${encodeURIComponent(b.name)}`; a.download = b.name; document.body.append(a); a.click(); a.remove();
              reload();
            })}>Xuất cài đặt</Button>
            <span className={s.hint}>Cài đặt panel, mod, Game.ini/Engine.ini và các file <span className={t.mono}>.env</span> (mật khẩu, token, webhook), <b>giữ kín như mật khẩu</b>.</span>
          </div>
          <div className={s.row}>
            <span className={s.fileBox}><FileInput aria-label="File backup" accept=".tar.gz,.gz,application/gzip" file={file} onChange={setFile} /></span>
            <Button variant="soft" disabled={!stopped} onClick={() => {
              if (!file) { toast('Chọn file backup (.tar.gz) trước.', 'err'); return; }
              confirm({ title: 'Khôi phục từ file?', okLabel: 'Khôi phục', body: restoreText(<>Khôi phục từ <b>{file.name}</b> ({bkSize(file.size)}).</>),
                run: (token) => restore(token, '/api/backups/restore', file) });
            }}>Khôi phục từ file</Button>
          </div>
          <div className={s.hint}>Trên VPS mới (đã cài server + panel như cũ): tải lên file <b>xuất cài đặt</b> rồi file <b>backup dữ liệu</b>. Cần tắt server trước;
            panel tự backup dữ liệu hiện có trước khi ghi đè, rồi tự khởi động lại.</div>
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Xoá dữ liệu để bắt đầu mới" />
        <CardBody stack>
          <CheckGrid>
            {d.parts.map((p) => <Checkbox key={p.key} label={p.label} checked={parts[p.key] ?? true} onChange={(v) => setParts({ ...parts, [p.key]: v })} />)}
          </CheckGrid>
          <div><Button variant="dangerSolid" disabled={!stopped} onClick={() => {
            if (picked.length === 0) { toast('Chọn ít nhất một phần.', 'err'); return; }
            confirm({
              title: 'Xoá dữ liệu để bắt đầu mới?', okLabel: 'Xoá dữ liệu', text: { label: `Gõ ${WIPE_WORDS} để xác nhận`, value: '' },
              body: <>
                <p style={{ margin: '0 0 8px' }}>Xoá: <b>{picked.map((p) => p.label).join(', ')}</b>.</p>
                <p style={{ margin: 0 }}>Panel <b>tự backup đầy đủ trước</b> (khôi phục lại được), rồi tự khởi động lại.</p>
              </>,
              run: async (token, _reason, typed) => {
                if (typed.trim() !== WIPE_WORDS) throw new Error(`Gõ đúng: ${WIPE_WORDS}`);
                const r = await adminFetch<{ wiped: string[]; backup: string }>('/api/backups/wipe', 'POST', token, { parts: picked.map((p) => p.key), confirm: WIPE_WORDS });
                toast(`Đã xoá (${r.wiped.join(', ')}). Backup trước khi xoá: ${r.backup}. Panel khởi động lại…`);
                setTimeout(() => location.reload(), 6000);
              },
            });
          }}>Xoá dữ liệu…</Button></div>
          <div className={s.hint}>Cần tắt server trước. Luôn tự backup đầy đủ trước khi xoá (khôi phục lại được). Cài đặt panel, mod, game và cài đặt gara được giữ nguyên.</div>
        </CardBody>
      </Card>
    </div>
  );
}
