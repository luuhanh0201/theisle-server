import { BlockPage } from '../../app/BlockPage';
import { MemberList, PendingBanner } from '../../features/members/MemberList';
import { Permissions } from '../../features/members/Permissions';
import { Svip } from '../../features/members/Svip';

const withBanner = (list: 'admins' | 'whitelist' | 'vips') => () => <><PendingBanner /><MemberList list={list} /></>;
const Admins = withBanner('admins');
const Whitelist = withBanner('whitelist');
const Vips = withBanner('vips');

/** Thành viên: who is admin and what each may do, the whitelist, VIP and SVip. */
export function MembersPage({ sub }: { sub: string }) {
  return <BlockPage tab="members" sub={sub} title="Thành viên" intro="Ai là admin, quyền của từng admin, whitelist, VIP và SVip."
    pages={{ admins: Admins, perms: Permissions, whitelist: Whitelist, vips: Vips, svip: Svip }} />;
}
