import type { CommandResult } from '@isle/api';
import { portalGet } from './http';

/** A game command's refusal, in Vietnamese (DinoGarage errors). */
export const ERROR_VI: Record<string, string> = {
  offline: 'Bạn cần đang ở trong game (server không thấy bạn online).',
  expired: 'Game không kịp nhận lệnh (server bận hoặc đang khởi động lại). Thử lại sau.',
  bad_arguments: 'Lựa chọn không hợp lệ.',
  failed: 'Lệnh gặp lỗi trong game. Thử lại.',
};

const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

/** Poll one command every second until `done(result)` says so or `seconds` pass; null on timeout. */
export async function waitCommand(id: number, seconds: number, done: (c: CommandResult) => boolean, wait: (ms: number) => Promise<void> = sleep): Promise<CommandResult | null> {
  for (let i = 0; i < seconds; i++) {
    await wait(1000);
    const c = await portalGet<CommandResult>(`/api/command/${id}`).catch(() => null);
    if (c && done(c)) return c;
  }
  return null;
}
