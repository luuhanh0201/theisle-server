import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson, type PermDraft, type PermissionsData } from '@isle/api';
import { Button, Card, CardBody, Hint, SectionTitle, Select, Switch, useToast } from '@isle/ui';
import { useSession } from '../../app/session';
import s from './Members.module.css';

/** What a draft gives: the role's permissions, plus those allowed, minus those denied. */
export function effective(roles: PermissionsData['roles'], d: PermDraft): Set<string> {
  const out = new Set(roles[d.role]?.perms ?? []);
  for (const k of d.allow) out.add(k);
  for (const k of d.deny) out.delete(k);
  return out;
}
/** One permission switched on or off: kept as an exception to the role only when it differs from it. */
export function withPerm(roles: PermissionsData['roles'], d: PermDraft, key: string, on: boolean): PermDraft {
  const inRole = (roles[d.role]?.perms ?? []).includes(key);
  const allow = d.allow.filter((k) => k !== key);
  const deny = d.deny.filter((k) => k !== key);
  if (on && !inRole) allow.push(key);
  if (!on && inRole) deny.push(key);
  return { ...d, allow, deny };
}

/** Thành viên → Phân quyền (the super admin only): each admin's role, exceptions, and in-game admin. */
export function Permissions() {
  const q = useQuery({ queryKey: ['/api/permissions'], queryFn: () => getJson<PermissionsData>('/api/permissions') });
  const d = q.data;
  return (
    <>
      <SectionTitle first icon="🛡️" title="Phân quyền admin" sub="chỉ admin tổng thấy trang này · quyền trên panel có hiệu lực ngay" />
      <Hint className={s.permIntro} style={{ marginBottom: 14 }}>Chọn <b>vai trò</b> để gán nhanh, rồi bật / tắt từng quyền nếu cần.
        {' '}<b>Admin trong game</b> (/adminpanel, bay, kéo / dịch chuyển, hồi máu, growth, thời tiết…): tắt thì người đó bị bỏ khỏi danh sách admin của game,
        có hiệu lực hoàn toàn từ <b>lần khởi động lại tới</b>; trước đó mod cố gỡ quyền ngay, và mọi lệnh admin họ còn dùng được ghi đỏ trong Nhật ký admin.
        Mọi lệnh admin trong game của mọi người đều được ghi vào Nhật ký admin.</Hint>
      {q.error ? <Hint>Không tải được: {(q.error as Error).message}</Hint> : !d ? <Hint>Đang tải…</Hint> : (
        <div className={s.permList}>
          {d.admins.length === 0 && <Hint>Chưa có admin nào.</Hint>}
          {d.admins.slice().sort((a, b) => Number(b.super) - Number(a.super) || (a.name ?? '').localeCompare(b.name ?? '')).map((a) => <AdminCard key={a.steamId} data={d} admin={a} />)}
        </div>
      )}
    </>
  );
}

function AdminCard({ data, admin }: { data: PermissionsData; admin: PermissionsData['admins'][number] }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { withToken } = useSession();
  const [draft, setDraft] = useState<PermDraft>(admin.perm);
  useEffect(() => { setDraft(admin.perm); }, [admin.perm]);
  const name = admin.name ?? 'Chưa rõ tên';
  if (admin.super) {
    return <Card><div className={s.permHead} style={{ paddingBottom: 16 }}><div className={s.permWho}><b>{name}</b><span>{admin.steamId}</span></div>
      <span className={`${s.tag} ${s.tagSuper}`}>Admin tổng · toàn quyền, không chỉnh được</span></div></Card>;
  }
  const eff = effective(data.roles, draft);
  const role = data.roles[draft.role]?.perms ?? [];
  const changed = JSON.stringify(draft) !== JSON.stringify(admin.perm);
  const groups = [...new Set(data.perms.map((p) => p.group))];
  const save = (): void => {
    void withToken(`lưu quyền của ${name}`, async (token) => {
      await adminFetch(`/api/permissions/${admin.steamId}`, 'PUT', token, draft);
      toast(`Đã lưu quyền của ${name}`);
      await qc.invalidateQueries({ queryKey: ['/api/permissions'] });
    });
  };
  return (
    <Card data-perm-id={admin.steamId}>
      <div className={s.permHead}>
        <div className={s.permWho}><b>{name}</b><span>{admin.steamId}</span></div>
        {admin.owner && <span className={s.tag}>trong ADMIN_STEAM_IDS</span>}
        {!admin.set && <span className={s.tag}>chưa đặt quyền · đang toàn quyền</span>}
        <span className={s.role}>Vai trò <span className={s.roleSel}><Select aria-label={`Vai trò của ${name}`} value={draft.role}
          options={Object.entries(data.roles).map(([k, r]) => ({ value: k, label: r.label }))}
          onChange={(v) => setDraft({ ...draft, role: v, allow: [], deny: [] })} /></span></span>
      </div>
      <CardBody stack>
        <div className={s.permIngame}>
          <Switch checked={draft.ingame} onChange={(v) => setDraft({ ...draft, ingame: v })} label={<b>Admin trong game (/adminpanel)</b>} />
          <span className={s.muted}>{admin.inGameNow ? 'đang có trong danh sách admin của game' : 'không có trong danh sách admin của game'}</span>
          {draft.ingame !== admin.inGameNow && <span className={`${s.tag} ${s.tagWarn}`}>{draft.ingame ? 'sẽ có lại quyền admin trong game sau lần khởi động lại'
            : 'đã bỏ khỏi danh sách admin của game · hết hẳn quyền sau lần khởi động lại'}</span>}
        </div>
        <div className={s.groups}>
          {groups.map((g) => (
            <div key={g}><h4>{g}</h4>
              {data.perms.filter((p) => p.group === g).map((p) => {
                const cls = eff.has(p.key) && !role.includes(p.key) ? 'extra' : !eff.has(p.key) && role.includes(p.key) ? 'removed' : '';
                return (
                  <div key={p.key} className={`${s.permRow}${cls ? ` ${s[cls]}` : ''}`}>
                    <span>{p.label}{cls === 'extra' && <small>thêm ngoài vai trò</small>}{cls === 'removed' && <small>đã tắt khỏi vai trò</small>}</span>
                    <Switch aria-label={p.label} checked={eff.has(p.key)} onChange={(v) => setDraft(withPerm(data.roles, draft, p.key, v))} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className={s.actions}>
          <Button variant="ghost" disabled={!changed} onClick={() => setDraft(admin.perm)}>Huỷ thay đổi</Button>
          <Button disabled={!changed} onClick={save}>Lưu quyền của {name}</Button>
        </div>
      </CardBody>
    </Card>
  );
}
