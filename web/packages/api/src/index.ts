// @isle/api: talking to the bridge (http.ts) and the shapes of its answers (types.ts).
export { ApiError, LOGIN_URL, adminFetch, getJson, onLoginEnded } from './http';
export type {
  CommandName, CommandsSettings, Health, Me, MessageDef, MessagesSettings, MessagesWithCatalog, PeriodicMessage,
  PteraSettings, ServerStatus, TeleSettings, VoiceNameMode, VoiceSettings, VoiceSettingsStatus,
} from './types';
