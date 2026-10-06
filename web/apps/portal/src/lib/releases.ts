import type { PlayerMe, ReleaseBadge } from '@isle/api';

/** The mark beside a feature (bridge svip.ts /me releases): its level, or NEW for 7 days after it is made public. */
export const REL_BADGE: Record<string, readonly [string, string]> = {
  dev: ['Đang phát triển', 'Chỉ admin thấy: đang phát triển'],
  svip: ['Ưu tiên', 'SVip dùng trước, sẽ mở cho tất cả'],
  new: ['NEW', 'Vừa phát hành'],
};

/** Trang chủ's mark: when its features (Hổ phách, nhiệm vụ, quà tân thủ) all share one. */
export function homeRelease(me: PlayerMe | null | undefined): ReleaseBadge {
  const rel = me?.releases ?? {};
  const home = [me?.economy ? rel['amber'] ?? '' : null, me?.quests ? rel['quests'] ?? '' : null, me?.starter ? rel['starter'] ?? '' : null]
    .filter((x): x is ReleaseBadge => x !== null);
  return home.length > 0 && home.every((x) => x === home[0]) ? home[0] as ReleaseBadge : '';
}
