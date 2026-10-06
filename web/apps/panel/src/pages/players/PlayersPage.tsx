import { BlockPage } from '../../app/BlockPage';
import { Bans } from '../../features/players/bans/Bans';
import { Chat } from '../../features/players/chat/Chat';
import { Killfeed } from '../../features/players/killfeed/Killfeed';
import { Leaderboard } from '../../features/players/leaderboard/Leaderboard';
import { PlayersList } from '../../features/players/list/PlayersList';
import { Prison } from '../../features/players/prison/Prison';

/** Người chơi: who plays, who kills whom, the leaderboard, the chat, bans and the prison. */
export function PlayersPage({ sub }: { sub: string }) {
  return <BlockPage tab="players" sub={sub} title="Người chơi" intro="Ai đang chơi, ai giết ai, bảng xếp hạng và chat trong game."
    pages={{ list: PlayersList, killfeed: Killfeed, leaderboard: Leaderboard, chat: Chat, bans: Bans, prison: Prison }} />;
}
