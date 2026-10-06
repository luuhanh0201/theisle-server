import { PageHead } from '@isle/ui';
import { Quests } from '../../features/quests/Quests';

/** Nhiệm vụ: one page (no sub-pages), as the panel before React. */
export function QuestsPage() {
  return (
    <div>
      <PageHead title="Nhiệm vụ" sub={<>Hổ phách, tiền của server, kiếm bằng cách chơi (không bán bằng tiền thật), và điểm danh hằng ngày (giờ Việt Nam). Ai dùng được: <b>Thành viên → SVip → Mức phát hành chức năng</b>.</>} />
      <Quests />
    </div>
  );
}
