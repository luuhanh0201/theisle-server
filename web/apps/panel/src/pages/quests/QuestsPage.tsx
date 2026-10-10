import { BlockPage } from '../../app/BlockPage';
import { QUEST_PAGES } from '../../features/quests/Quests';

/** Nhiệm vụ: the check-in, Hổ phách, the shop, the quests, the online milestones, one sub-page each. */
export function QuestsPage({ sub }: { sub: string }) {
  return <BlockPage tab="quests" sub={sub} title="Nhiệm vụ"
    intro={<>Hổ phách, tiền của server, kiếm bằng cách chơi (không bán bằng tiền thật), và điểm danh hằng ngày (giờ Việt Nam). Ai dùng được: <b>Thành viên → SVip → Mức phát hành chức năng</b>.</>}
    pages={QUEST_PAGES} />;
}
