import { BlockPage } from '../../app/BlockPage';
import { CommandsSettings } from '../../features/mods/commands/CommandsSettings';
import { MessagesSettings } from '../../features/mods/messages/MessagesSettings';
import { PteraSettings } from '../../features/mods/ptera/PteraSettings';
import { TeleSettings } from '../../features/mods/tele/TeleSettings';
import { VoiceSettings } from '../../features/mods/voice/VoiceSettings';

/** Tính năng mod: the mods' settings, one sub-page each. */
export function ModsPage({ sub }: { sub: string }) {
  return <BlockPage tab="mods" sub={sub} title="Tính năng mod"
    intro="Những gì các mod của server thêm cho người chơi: lệnh chat, Ptera gắp, tele con non, voice gần, và nội dung mọi thông báo."
    pages={{ commands: CommandsSettings, ptera: PteraSettings, tele: TeleSettings, voice: VoiceSettings, messages: MessagesSettings }} />;
}
