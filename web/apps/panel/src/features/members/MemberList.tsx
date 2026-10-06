import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson, type MembersData } from '@isle/api';
import { Button, Card, CardBody, CardHead, Hint, Select, TextInput, useToast } from '@isle/ui';
import { PlayerLink } from '../../components/dino/Identity';
import { can } from '../../app/nav';
import { useSession } from '../../app/session';
import t from '../../components/table/Table.module.css';
import s from './Members.module.css';

type ListKey = 'admins' | 'whitelist' | 'vips';
/** The Game.ini setting each list is saved as (through /api/game-config; the bridge keeps the rest). */
const INI_KEY: Record<ListKey, string> = { admins: 'AdminsSteamIDs', whitelist: 'WhitelistIDs', vips: 'VIPs' };
const STEAM_RE = /^7656\d{13}$/;

export const useMembers = () => useQuery({ queryKey: ['/api/members'], queryFn: () => getJson<MembersData>('/api/members'), refetchInterval: 15_000 });

/** "Saved to Game.ini, the game takes it at the next restart", over the member pages. */
export function PendingBanner() {
  const d = useMembers().data;
  if (!d?.pendingRestart) return null;
  return <div className={s.banner}>Danh sách đã lưu vào Game.ini, game áp dụng từ <b>lần khởi động lại tới</b>.</div>;
}

const TEXT: Record<ListKey, { title: string; sub: string; hint: string }> = {
  admins: { title: 'Admin', sub: 'admin trong game và trên panel',
    hint: 'Có hiệu lực trên panel ngay; trong game từ lần khởi động lại tới. Quyền chi tiết của từng admin: mục Phân quyền. Admin cố định (ADMIN_STEAM_IDS trên VPS) không bỏ được ở đây.' },
  whitelist: { title: 'Whitelist', sub: 'chỉ những SteamID này mới vào được server khi bật',
    hint: 'Thêm / bỏ có hiệu lực ngay (gửi lệnh RCON cho game) và được lưu vào Game.ini; bật / tắt whitelist có hiệu lực từ lần khởi động lại tới.' },
  vips: { title: 'VIP', sub: 'được ưu tiên vào khi server đầy; gara 5 slot, chờ 120 giây (Server → Gara). SVip tự được tính là VIP trong game (thêm vào Game.ini mỗi lần server khởi động), không cần thêm ở đây.',
    hint: 'Lưu vào Game.ini, có hiệu lực từ lần khởi động lại tới.' },
};

/** Thành viên → Admin / Whitelist / VIP: one Game.ini list, add and remove. */
export function MemberList({ list }: { list: ListKey }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { access, withToken } = useSession();
  const d = useMembers().data;
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const ids = d?.[list] ?? [];
  const fixed = new Set([...(d?.owners ?? []), ...(d?.superAdmin ? [d.superAdmin] : [])]);
  const save = async (next: string[], label: string, rcon: { cmd: string; arg: string } | null): Promise<boolean> => {
    setBusy(true);
    try {
      return await withToken(label, async (token) => {
        await adminFetch('/api/game-config', 'PUT', token, { settings: { [INI_KEY[list]]: next } });
        if (rcon && can(access, 'rcon.run')) {
          await adminFetch(`/api/rcon/${rcon.cmd}`, 'POST', token, { args: rcon.arg })
            .catch(() => toast('Đã lưu, nhưng RCON không gửi được: có hiệu lực từ lần khởi động lại tới.', 'err'));
        }
        await qc.invalidateQueries({ queryKey: ['/api/members'] });
        toast('Đã lưu.');
      });
    } finally { setBusy(false); }
  };
  const add = async (): Promise<void> => {
    const v = id.trim();
    if (!STEAM_RE.test(v)) { toast('SteamID: 17 chữ số, bắt đầu bằng 7656…', 'err'); return; }
    if (ids.includes(v)) { toast('Đã có trong danh sách', 'err'); return; }
    if (await save([...ids, v], `thêm ${list}`, list === 'whitelist' ? { cmd: 'addWhitelistIds', arg: v } : null)) setId('');
  };
  const setWhitelist = (on: boolean): void => {
    void withToken(on ? 'bật whitelist' : 'tắt whitelist', async (token) => {
      await adminFetch('/api/game-config', 'PUT', token, { settings: { bServerWhitelist: on } });
      await qc.invalidateQueries({ queryKey: ['/api/members'] });
      toast(on ? 'Đã bật whitelist, có hiệu lực từ lần khởi động lại tới.' : 'Đã tắt whitelist, có hiệu lực từ lần khởi động lại tới.');
    });
  };
  const text = TEXT[list];
  return (
    <Card>
      <CardHead title={text.title} sub={text.sub} />
      <CardBody stack>
        {list === 'whitelist' && d && (
          <div className={s.route}><span><b>Chỉ cho whitelist vào</b>, tắt: ai cũng vào được</span>
            <span className={s.routeSel}><Select aria-label="Chỉ cho whitelist vào" value={d.whitelistOn ? 'true' : 'false'}
              options={[{ value: 'false', label: 'Tắt' }, { value: 'true', label: 'Bật' }]} onChange={(v) => setWhitelist(v === 'true')} /></span></div>
        )}
        <Hint>{text.hint}</Hint>
        <form className={s.addRow} onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <div className={s.addField}><label htmlFor={`mb-${list}-id`} className={s.label}>SteamID</label>
            <TextInput id={`mb-${list}-id`} inputMode="numeric" maxLength={17} placeholder="7656119…" className={t.mono} autoComplete="off" value={id} onChange={(e) => setId(e.target.value)} /></div>
          <Button type="submit" disabled={busy}>Thêm</Button>
        </form>
        {!d ? <Hint>Đang tải…</Hint> : ids.length === 0 ? <Hint>Chưa có ai.</Hint> : (
          <div className={t.wrap}><table className={t.table}>
            <thead><tr><th>Người chơi</th><th>SteamID</th><th /></tr></thead>
            <tbody>{ids.map((x) => (
              <tr key={x}>
                <td>{d.names[x] ? <PlayerLink id={x} name={d.names[x]} /> : <span className={t.muted}>chưa vào game</span>}</td>
                <td className={t.mono}>{x}</td>
                <td className={t.right}>{list === 'admins' && fixed.has(x) ? <span className={t.muted} title="ADMIN_STEAM_IDS / admin tổng trên VPS">cố định</span>
                  : can(access, 'config.edit') ? <Button variant="ghost" small className={t.del} disabled={busy}
                    onClick={() => void save(ids.filter((y) => y !== x), `bỏ ${list}`, list === 'whitelist' ? { cmd: 'removeWhitelistIds', arg: x } : null)}>Bỏ</Button> : null}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </CardBody>
    </Card>
  );
}
