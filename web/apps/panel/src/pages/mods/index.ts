import type { BlockPages } from '../../app/Block';
import { CommandsSettings } from '../../features/mods/commands/CommandsSettings';
import { MessagesSettings } from '../../features/mods/messages/MessagesSettings';
import { PteraSettings } from '../../features/mods/ptera/PteraSettings';
import { TeleSettings } from '../../features/mods/tele/TeleSettings';
import { VoiceSettings } from '../../features/mods/voice/VoiceSettings';

/** Tính năng mod: every sub-page is in React. */
export const MODS_PAGES: BlockPages = {
  commands: CommandsSettings, ptera: PteraSettings, tele: TeleSettings, voice: VoiceSettings, messages: MessagesSettings,
};
