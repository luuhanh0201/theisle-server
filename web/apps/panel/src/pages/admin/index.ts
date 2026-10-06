import type { BlockPages } from '../../app/Block';
import { PanelAccessSettings } from '../../features/admin/access/PanelAccessSettings';
import { DiscordSettings } from '../../features/admin/discord/DiscordSettings';

/** Quản trị: Truy cập panel and Discord in React; Nhật ký admin (a list) not yet. */
export const ADMIN_PAGES: BlockPages = { access: PanelAccessSettings, discord: DiscordSettings };
