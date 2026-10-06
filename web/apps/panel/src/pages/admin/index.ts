import type { BlockPages } from '../../app/Block';
import { PanelAccessSettings } from '../../features/admin/access/PanelAccessSettings';

/** Quản trị: Truy cập panel in React; Nhật ký admin (a list) and Discord not yet. */
export const ADMIN_PAGES: BlockPages = { access: PanelAccessSettings };
