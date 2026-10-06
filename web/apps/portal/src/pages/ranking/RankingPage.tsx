import { Ranking } from '../../features/ranking/Ranking';
import { useLeaderboard, useMe } from '../../lib/queries';

/** Bảng Xếp Hạng (#ranking). */
export function RankingPage() {
  const me = useMe();
  const board = useLeaderboard();
  return <Ranking me={me} board={board} />;
}
