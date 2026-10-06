import { BlockPage } from '../../app/BlockPage';
import { AuditLog } from '../../features/admin/AuditLog';
import { DiscordSettings } from '../../features/admin/DiscordSettings';
import { PanelAccess } from '../../features/admin/PanelAccess';

/** Quản trị: who may open the panel, the log of every admin action, and the log sent to Discord. */
export function AdminPage({ sub }: { sub: string }) {
  return <BlockPage tab="admin" sub={sub} title="Quản trị" intro="Ai được vào panel, nhật ký mọi thao tác của admin, và log gửi lên Discord."
    pages={{ access: PanelAccess, audit: AuditLog, discord: DiscordSettings }} />;
}
