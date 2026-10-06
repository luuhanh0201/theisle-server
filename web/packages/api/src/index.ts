// @isle/api: talking to the bridge (http.ts) and the shapes of its answers (types.ts).
export { ApiError, LOGIN_URL, adminFetch, getJson, onLoginEnded } from './http';
export type { CommandsSettings, Health, Me, MessageDef, MessagesSettings, PeriodicMessage, PlayerCommand, PteraSettings, ServerStatus, TeleSettings, VoiceSettings } from './types';
