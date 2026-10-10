import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { ValidationError } from './garage.js';

/**
 * Everything the server tells players, and how often, editable on the admin
 * panel (tab Thông báo).
 *
 *   texts          every message by key; only the ones an admin changed are
 *                  kept. "" = do not send it. {name} is filled when sent.
 *   countdownMarks when a restart / stop countdown announces (seconds left)
 *   periodic       announcements repeated every N minutes while people play
 *   corpseWipe     clear corpses every N minutes (0 = off), warned before
 *
 * The mods' messages are rendered by the mods themselves
 * (mods/_shared/messages.lua), from the file written to messagesModPath, so
 * the web garage shows the same words as the game. Each call there carries
 * its default; MESSAGES below must list the same keys and defaults (a test
 * reads the Lua and checks).
 */

export type MessageGroup = 'server' | 'corpses' | 'ai' | 'ban' | 'ptera' | 'guard' | 'garage' | 'redeem' | 'commands' | 'admin' | 'hello' | 'prime' | 'skin' | 'prison' | 'tele' | 'cap';

export interface MessageDef {
  key: string;
  group: MessageGroup;
  /** What it is, for the admin. */
  label: string;
  default: string;
  /** The {names} it may use. */
  vars: string[];
  /**
   * Not sent unless the admin turns it on (panel: tick "Gửi"): `default` is
   * then only the suggested wording. An admin's text = on, none = off.
   */
  offByDefault?: boolean;
  /** Sent by the bridge itself although its group is a mod's (the garage guard's): not written for the mods. */
  fromBridge?: boolean;
}

const REASONS: Array<[string, string, string]> = [
  ['moved', 'rời bán kính 5 m', 'bạn đã rời khỏi bán kính 5 m'],
  ['damage_dealt', 'gây sát thương', 'bạn đã gây sát thương'],
  ['damage_taken', 'chịu sát thương', 'bạn đã chịu sát thương'],
  ['left', 'thoát game / chết', 'bạn đã thoát game hoặc dino đã chết'],
  ['not_same_dino', 'đổi dino', 'không còn là con dino lúc bắt đầu cất'],
  ['full', 'gara đầy', 'gara đã đầy'],
  ['capture_failed', 'không đọc được dino', 'không đọc được trạng thái dino'],
  ['save_failed', 'không lưu được', 'không lưu được vào gara'],
  ['kill_failed', 'không gỡ được dino', 'không gỡ được dino khỏi game'],
  ['prison', 'bị bỏ tù lúc đang cất', 'bạn đang ở tù'],
];

export const MESSAGES: readonly MessageDef[] = [
  // --- server (bridge/src/power.ts) ---
  { key: 'server.restart.countdown', group: 'server', label: 'Đếm ngược khởi động lại (mỗi mốc)', default: 'Server sẽ khởi động lại sau {left} / Server restarting in {leftEn}. {reason}', vars: ['left', 'leftEn', 'reason'] },
  { key: 'server.restart.now', group: 'server', label: 'Bắt đầu khởi động lại', default: 'Server đang khởi động lại / Server restarting now.', vars: [] },
  { key: 'server.restart.cancelled', group: 'server', label: 'Huỷ khởi động lại', default: 'Đã huỷ khởi động lại server / Restart cancelled.', vars: [] },
  { key: 'server.stop.countdown', group: 'server', label: 'Đếm ngược tắt server (mỗi mốc)', default: 'Server sẽ tắt sau {left} / Server shutting down in {leftEn}. {reason}', vars: ['left', 'leftEn', 'reason'] },
  { key: 'server.stop.now', group: 'server', label: 'Bắt đầu tắt server', default: 'Server đang tắt / Server shutting down now.', vars: [] },
  { key: 'server.stop.cancelled', group: 'server', label: 'Huỷ tắt server', default: 'Đã huỷ tắt server / Shutdown cancelled.', vars: [] },
  { key: 'growth.event.on', group: 'server', label: 'Sự kiện tốc độ lớn đang diễn ra (lúc server vừa lên)', default: 'Sự kiện tốc độ lớn x{multiplier} đang diễn ra tới {until}! {note}', vars: ['multiplier', 'until', 'note'] },
  { key: 'growth.event.off', group: 'server', label: 'Sự kiện tốc độ lớn đã kết thúc (lúc server vừa lên)', default: 'Sự kiện tốc độ lớn x{multiplier} đã kết thúc, tốc độ lớn trở lại bình thường. {note}', vars: ['multiplier', 'note'] },
  { key: 'server.scheduledReason', group: 'server', label: 'Lý do của lần khởi động lại định kỳ ({reason} ở trên)', default: 'Khởi động lại định kỳ {time}', vars: ['time'] },
  // --- corpses (announcer.ts) ---
  { key: 'corpses.warning', group: 'corpses', label: 'Báo trước khi dọn xác', default: 'Dọn xác sau {left} / Clearing corpses in {leftEn}.', vars: ['left', 'leftEn'] },
  { key: 'corpses.done', group: 'corpses', label: 'Đã dọn xác', default: 'Đã dọn xác / Corpses cleared.', vars: [] },
  // --- AI reset (ai-reset.ts) ---
  { key: 'ai.reset.warning', group: 'ai', label: 'Báo trước khi làm mới AI', default: 'AI sẽ được làm mới sau {left} / AI reset in {leftEn}.', vars: ['left', 'leftEn'] },
  { key: 'ai.reset.done', group: 'ai', label: 'Đã làm mới AI', default: 'Đã làm mới AI ({count} con) / AI has been reset.', vars: ['count'] },
  { key: 'ai.reset.cancelled', group: 'ai', label: 'Huỷ làm mới AI', default: 'Đã huỷ làm mới AI / AI reset cancelled.', vars: [] },
  // --- bans (bans.ts): every ban in the game's list, from the panel or the game's own admin panel ---
  { key: 'ban.announce', group: 'ban', label: 'Thông báo toàn server khi có người bị ban', default: '⛔ {name} đã bị ban {duration}. Lý do: {reason}', vars: ['name', 'reason', 'duration', 'until', 'since', 'by'] },
  { key: 'ban.unban', group: 'ban', label: 'Thông báo toàn server khi gỡ ban', default: '✅ {name} đã được gỡ ban.', vars: ['name', 'reason', 'by'], offByDefault: true },
  { key: 'ban.edit', group: 'ban', label: 'Thông báo toàn server khi sửa ban (thời hạn / lý do)', default: '✏️ Ban của {name} đổi thành {duration} (hết hạn {until}). Lý do: {reason}', vars: ['name', 'reason', 'duration', 'until', 'since', 'by'], offByDefault: true },
  { key: 'ban.player', group: 'ban', label: 'Tin riêng cho người bị ban (gửi ngay trước khi bị kick, chỉ khi ban từ panel)', default: 'Bạn đã bị ban {duration}. Lý do: {reason}. Khiếu nại: vào Discord của server.', vars: ['name', 'reason', 'duration', 'until'] },
  // --- Pteranodon carry (mods/PteraCarry) ---
  { key: 'ptera.carry.hint', group: 'ptera', label: 'Gợi ý: có con gắp được ở gần', default: 'Có thể gắp {species} ({kg} kg), đang bay, giữ Z + chuột phải sát nó.', vars: ['species', 'kg'], offByDefault: true },
  { key: 'ptera.carry.start', group: 'ptera', label: 'Bắt đầu gắp (cho Ptera)', default: 'Đang gắp {species} ({kg} kg). Đáp xuống hoặc gõ !drop để thả (tối đa {seconds} giây).', vars: ['species', 'kg', 'seconds'], offByDefault: true },
  { key: 'ptera.carry.victim', group: 'ptera', label: 'Bị gắp (cho con bị gắp)', default: 'Bạn đang bị một Pteranodon gắp đi!', vars: [], offByDefault: true },
  { key: 'ptera.carry.dropped', group: 'ptera', label: 'Đã thả (cho Ptera)', default: 'Đã thả {species}.', vars: ['species'], offByDefault: true },
  { key: 'ptera.carry.released', group: 'ptera', label: 'Được thả (cho con bị gắp)', default: 'Pteranodon đã thả bạn ra.', vars: [], offByDefault: true },
  { key: 'ptera.carry.tooHeavy', group: 'ptera', label: 'Quá nặng', default: '{species} nặng {kg} kg, Pteranodon chỉ gắp được tới {max} kg.', vars: ['species', 'kg', 'max'], offByDefault: true },
  { key: 'ptera.carry.cooldown', group: 'ptera', label: 'Đang hồi', default: 'Gắp đang hồi: chờ {seconds} giây.', vars: ['seconds'], offByDefault: true },
  // --- small dinos only (mods/ZoneGuard) ---
  { key: 'guard.warn', group: 'guard', label: 'Dino quá lớn vào vùng chỉ dino nhỏ (cảnh báo)', default: 'Dino của bạn quá lớn cho “{zone}” ({growth}%, tối đa {max}%). Rời khỏi trong {seconds} giây, nếu không sẽ bị ong đốt!', vars: ['zone', 'growth', 'max', 'seconds'] },
  { key: 'guard.sting', group: 'guard', label: 'Bắt đầu bị ong đốt', default: 'Bạn đang bị ong đốt ở “{zone}”, mất {pct}% máu mỗi {every} giây cho tới khi rời đi.', vars: ['zone', 'pct', 'every'] },
  // --- the species limit (mods/DinoGarage garage/speciescap.lua, species-cap.ts) ---
  { key: 'cap.over', group: 'cap', label: 'Vào bằng loài đã đủ số lượng (cảnh báo)', default: '{species} trên server đã đủ số lượng cho phép. Dino này sẽ bị xoá sau {seconds} giây, hãy chọn loài khác.', vars: ['species', 'seconds'] },
  { key: 'cap.killed', group: 'cap', label: 'Dino vượt số lượng đã bị xoá', default: '{species} đã đủ số lượng: dino đã được xoá, hãy chọn loài khác.', vars: ['species'] },
  { key: 'cap.redeem', group: 'cap', label: 'Lấy dino từ gara khi loài đã đủ số lượng (bị chặn)', default: 'Loài này đã đủ số lượng: không lấy dino từ gara được lúc này, hãy chọn loài khác.', vars: [] },
  { key: 'ptera.carry.nothing', group: 'ptera', label: '!drop khi không gắp gì', default: 'Bạn không gắp con nào.', vars: [] },
  { key: 'ptera.carry.inmate', group: 'ptera', label: 'Gắp tù nhân (bị chặn)', default: 'Không gắp được tù nhân.', vars: [], offByDefault: true },
  // --- prison: outsiders in the prison zone (mods/Prison) ---
  { key: 'prison.sting.warn', group: 'guard', label: 'Người ngoài vào khu nhà tù (cảnh báo)', default: 'Đây là khu nhà tù, rời khỏi trong {seconds} giây, nếu không sẽ bị ong đốt!', vars: ['seconds'] },
  { key: 'prison.noSleep', group: 'guard', label: 'Người ở tù cho dino ngủ (bị đánh thức)', default: 'Đang ở tù: không được ngủ.', vars: [] },
  { key: 'prison.sting', group: 'guard', label: 'Người ngoài bắt đầu bị ong đốt ở khu nhà tù', default: 'Bạn đang bị ong đốt ở khu nhà tù, mất {pct}% máu mỗi {every} giây cho tới khi rời đi.', vars: ['pct', 'every'] },
  // --- garage: storing (mods/DinoGarage) ---
  { key: 'garage.countdown', group: 'garage', label: 'Bắt đầu đếm ngược cất', default: 'Bắt đầu cất sau {seconds} giây, đứng yên trong bán kính 5 m, không đánh và không bị đánh.', vars: ['seconds'] },
  { key: 'garage.tenSeconds', group: 'garage', label: 'Còn 10 giây', default: 'Còn 10 giây là cất xong, đứng yên.', vars: [] },
  // Off by default: each task given back is told by prime.conditionDone (prime-notify.ts).
  { key: 'garage.primeFixed', group: 'garage', label: 'Bù tiến độ prime (gara, vùng di cư), mặc định tắt: đã có tin "hoàn thành nhiệm vụ"', default: 'Đã cập nhật tiến độ prime của bạn (vùng di cư, tuần tra…).', vars: [], offByDefault: true },
  { key: 'garage.stored', group: 'garage', label: 'Cất xong', default: 'Đã cất dino vào gara. Respawn đúng loài rồi lấy ra trên trang web.', vars: [] },
  { key: 'garage.failed', group: 'garage', label: 'Cất thất bại ({reason} = một lý do bên dưới)', default: 'Cất thất bại: {reason}. Bạn có thể cất lại ngay.', vars: ['reason'] },
  ...REASONS.map(([k, label, def]): MessageDef => ({ key: `garage.reason.${k}`, group: 'garage', label: `Lý do thất bại: ${label}`, default: def, vars: [] })),
  { key: 'garage.busy', group: 'garage', label: 'Đang có lần cất khác', default: 'Đang có một lần cất đang đếm ngược.', vars: [] },
  { key: 'garage.cooldown', group: 'garage', label: 'Gara đang hồi', default: 'Gara đang hồi: chờ {seconds} giây.', vars: ['seconds'] },
  { key: 'garage.noDino', group: 'garage', label: 'Chưa điều khiển dino', default: 'Bạn cần đang điều khiển dino để cất.', vars: [] },
  { key: 'garage.full', group: 'garage', label: 'Gara đầy', default: 'Gara đã đầy ({maxSlots} slot). Lấy bớt một con ra trước.', vars: ['maxSlots'] },
  { key: 'garage.lowHealth', group: 'garage', label: 'Máu dưới mức tối thiểu để cất', default: 'Máu phải từ {minHealth}% trở lên mới cất được (đang {health}%).', vars: ['minHealth', 'health'] },
  { key: 'garage.lowGrowth', group: 'garage', label: 'Chưa đủ lớn để cất', default: 'Dino phải lớn từ {minGrowth}% trở lên mới cất được (đang {growth}%).', vars: ['minGrowth', 'growth'] },
  { key: 'garage.noLocation', group: 'garage', label: 'Không đọc được vị trí', default: 'Không đọc được vị trí dino. Thử lại.', vars: [] },
  { key: 'garage.prison', group: 'garage', label: 'Đang ở tù: không cất / lấy được', default: 'Bạn đang ở tù: không dùng được gara.', vars: [] },
  { key: 'garage.useWeb', group: 'garage', label: 'Gõ !store / !redeem trong game', default: 'Gara giờ dùng trên trang web của server (mục Gara): cất và lấy dino ở đó.', vars: [] },
  { key: 'garage.guard.putBack', group: 'garage', label: 'Server sập / khởi động lại khi đang lấy dino: dino được trả lại gara', default: 'Server vừa sập khi bạn lấy {species} ra nên game chưa kịp lưu: dino đã được trả lại vào gara (slot {slot}).', vars: ['species', 'slot'], fromBridge: true },
  { key: 'garage.guard.undoStore', group: 'garage', label: 'Server sập / khởi động lại trước khi game lưu lần cất: lần cất không tính', default: 'Server vừa sập trước khi game lưu lần cất {species}: dino vẫn ở với bạn, lần cất đó không tính (slot {slot} trống).', vars: ['species', 'slot'], fromBridge: true },
  // --- garage: taking out ---
  { key: 'redeem.restoring', group: 'redeem', label: 'Đang lấy ra (tại chỗ)', default: "Restoring '{slot}'. Hold still for a few seconds.", vars: ['slot'] },
  { key: 'redeem.restoringStored', group: 'redeem', label: 'Đang lấy ra (về chỗ đã cất)', default: "Restoring '{slot}' at the spot you stored it. Hold still for a few seconds.", vars: ['slot'] },
  { key: 'redeem.done', group: 'redeem', label: 'Lấy ra xong', default: "Restored '{slot}'. The slot is now empty.", vars: ['slot'] },
  { key: 'redeem.failed', group: 'redeem', label: 'Lấy ra không xong (trả lại gara)', default: 'Restore did not finish. Your slot is back in the garage.', vars: [] },
  { key: 'redeem.moveFailed', group: 'redeem', label: 'Không dịch chuyển được về chỗ cất', default: 'Could not move you to the stored spot, restoring here.', vars: [] },
  { key: 'redeem.noStoredSpot', group: 'redeem', label: 'Slot không có vị trí đã cất', default: "Slot '{slot}' has no stored position, restoring where you stand.", vars: ['slot'] },
  { key: 'redeem.cooldown', group: 'redeem', label: 'Gara đang hồi', default: 'Garage cooldown: wait {seconds} s.', vars: ['seconds'] },
  { key: 'redeem.empty', group: 'redeem', label: 'Gara trống', default: 'Your garage is empty.', vars: [] },
  { key: 'redeem.unknownSlot', group: 'redeem', label: 'Slot không hợp lệ', default: 'Unknown slot.', vars: [] },
  { key: 'redeem.slotEmpty', group: 'redeem', label: 'Slot trống / hỏng', default: "Slot '{slot}' is empty or unreadable.", vars: ['slot'] },
  { key: 'redeem.noDino', group: 'redeem', label: 'Chưa respawn', default: 'Respawn first, then type !redeem.', vars: [] },
  { key: 'redeem.unknownSpecies', group: 'redeem', label: 'Không nhận ra loài hiện tại', default: 'Could not identify your current dino. Try again.', vars: [] },
  { key: 'redeem.wrongSpecies', group: 'redeem', label: 'Sai loài', default: 'Wrong species, respawn as the one you stored.', vars: [] },
  { key: 'redeem.takeFailed', group: 'redeem', label: 'Không lấy slot ra được', default: "Slot '{slot}' could not be taken out ({error}).", vars: ['slot', 'error'] },
  // --- chat commands (mods/PlayerCommands) ---
  { key: 'cmd.food.done', group: 'commands', label: '!food: xong', default: 'Đã nhả thứ trong mồm. Nếu vẫn kẹt, thoát ra vào lại hoặc dùng !unstuck.', vars: [] },
  { key: 'cmd.food.cooldown', group: 'commands', label: '!food: đang hồi', default: '!food: chờ thêm {wait}.', vars: ['wait'] },
  { key: 'cmd.food.noDino', group: 'commands', label: '!food: chưa có dino', default: '!food: bạn chưa điều khiển dino nào.', vars: [] },
  { key: 'cmd.food.failed', group: 'commands', label: '!food: không được', default: '!food không thực hiện được, thử lại sau.', vars: [] },
  { key: 'cmd.slay.done', group: 'commands', label: '!slay: xong', default: 'Dino của bạn đã chết. Chọn loài để spawn lại.', vars: [] },
  { key: 'cmd.slay.cooldown', group: 'commands', label: '!slay: đang hồi', default: '!slay: chờ thêm {wait}.', vars: ['wait'] },
  { key: 'cmd.slay.noDino', group: 'commands', label: '!slay: chưa có dino', default: '!slay: bạn chưa điều khiển dino nào.', vars: [] },
  { key: 'cmd.slay.failed', group: 'commands', label: '!slay: lỗi', default: '!slay không thực hiện được, thử lại sau.', vars: [] },
  { key: 'cmd.unstuck.done', group: 'commands', label: '!unstuck: xong', default: 'Đã đưa bạn về điểm an toàn cách {meters} m.', vars: ['meters'] },
  { key: 'cmd.unstuck.cooldown', group: 'commands', label: '!unstuck: đang hồi', default: '!unstuck: chờ thêm {wait}.', vars: ['wait'] },
  { key: 'cmd.unstuck.noDino', group: 'commands', label: '!unstuck: chưa có dino', default: '!unstuck: bạn chưa điều khiển dino nào.', vars: [] },
  { key: 'cmd.unstuck.noSafeSpot', group: 'commands', label: '!unstuck: chưa có điểm an toàn', default: '!unstuck: chưa có điểm an toàn trên mặt đất, đi bộ trên mặt đất vài giây rồi thử lại.', vars: [] },
  { key: 'cmd.unstuck.failed', group: 'commands', label: '!unstuck: lỗi', default: '!unstuck không thực hiện được, thử lại sau.', vars: [] },
  { key: 'cmd.prime.info', group: 'commands', label: '!prime: kết quả', default: 'Nhiệm vụ prime: {done}/10 xong (cần {needed}) · Đủ điều kiện: {eligible} · Prime: {status} · Growth {growth}.', vars: ['done', 'needed', 'eligible', 'status', 'prime', 'growth'] },
  { key: 'cmd.prime.noDino', group: 'commands', label: '!prime: chưa có dino', default: '!prime: bạn chưa điều khiển dino nào.', vars: [] },
  { key: 'cmd.status.noDino', group: 'commands', label: '!status: chưa có dino', default: '!status: bạn chưa điều khiển dino nào.', vars: [] },
  { key: 'cmd.disabled', group: 'commands', label: 'Lệnh đang bị tắt', default: '!{command} đang bị tắt trên server này.', vars: ['command'] },
  { key: 'cmd.prison', group: 'commands', label: '!slay / !unstuck / !food khi đang ở tù', default: '!{command} không dùng được khi đang ở tù.', vars: ['command'] },
  // --- admin actions (mods/DinoGarage inbox) ---
  { key: 'item.mutationClear', group: 'admin', label: 'Người chơi dùng Phiếu bỏ mutation', default: 'Đã bỏ mutation {mutation} khỏi ô {slot}.', vars: ['mutation', 'slot'] },
  { key: 'item.growth', group: 'admin', label: 'Người chơi dùng Túi tăng trưởng', default: 'Dino của bạn đã lớn từ {from}% lên {to}%.', vars: ['from', 'to'] },
  { key: 'item.cure', group: 'admin', label: 'Người chơi dùng Đá muối', default: 'Dino của bạn đã liếm đá muối: dạ dày dịu lại, hết ốm sau khi nôn.', vars: [] },
  { key: 'item.food', group: 'admin', label: 'Người chơi dùng Hộp food', default: 'Dino của bạn đã được cho ăn: thức ăn {from}% → {to}%.', vars: ['from', 'to'] },
  { key: 'item.prime', group: 'admin', label: 'Người chơi dùng Phiếu Prime', default: 'Dino của bạn đã lên prime, chỉ số prime được áp sau vài giây.', vars: [] },
  { key: 'item.mutationUpgrade', group: 'admin', label: 'Người chơi nâng cấp mutation bằng vật phẩm trùng (+1 đời)', default: 'Dino của bạn đã lên đời {generation} nhờ {mutation}, mọi mutation mạnh hơn.', vars: ['generation', 'mutation'] },
  { key: 'item.mutation', group: 'admin', label: 'Người chơi dùng vật phẩm mutation (từ túi đồ trên web)', default: 'Đã thêm mutation {mutation} vào dino của bạn (ô {slot}).', vars: ['mutation', 'slot'] },
  { key: 'admin.action', group: 'admin', label: 'Admin thao tác lên dino (heal, chỉ số, tăng trưởng, dịch chuyển)', default: 'Admin đã {action} cho dino của bạn.', vars: ['action'] },
  { key: 'admin.kill', group: 'admin', label: 'Admin xoá dino (không lý do)', default: 'An admin removed your dino.', vars: [] },
  { key: 'admin.killReason', group: 'admin', label: 'Admin xoá dino (có lý do)', default: 'An admin removed your dino. Reason: {reason}', vars: ['reason'] },
  // --- skin from the web (mods/DinoGarage garage/skin.lua) ---
  { key: 'skin.applied', group: 'skin', label: 'Đổi màu dino thành công', default: 'Đã đổi màu dino của bạn.', vars: [] },
  { key: 'skin.noDino', group: 'skin', label: 'Đổi màu: chưa điều khiển dino', default: 'Bạn cần đang điều khiển một con dino còn sống để đổi màu.', vars: [] },
  { key: 'skin.failed', group: 'skin', label: 'Đổi màu thất bại', default: 'Không đổi được màu dino. Thử lại sau.', vars: [] },
  { key: 'skin.kept', group: 'skin', label: 'Tô lại màu đã giữ (dino mới cùng loài)', default: 'Đã tô lại màu bạn giữ cho loài này.', vars: [] },
  // --- tele con non from the web (mods/DinoGarage garage/tele.lua) ---
  { key: 'tele.countdown', group: 'tele', label: 'Bắt đầu đếm ngược tele', default: 'Dịch chuyển sau {seconds} giây: đứng yên trong bán kính 5 m, không đánh và không bị đánh.', vars: ['seconds'] },
  { key: 'tele.done', group: 'tele', label: 'Tele xong (cho người dịch chuyển)', default: 'Đã dịch chuyển tới chỗ người đưa mã.', vars: [] },
  { key: 'tele.arrived', group: 'tele', label: 'Có người tele tới (cho người đưa mã)', default: 'Một người vừa dịch chuyển tới chỗ bạn bằng mã tele.', vars: [] },
  { key: 'tele.failed', group: 'tele', label: 'Tele thất bại khi đang đếm ngược ({reason} = lý do)', default: 'Tele thất bại: {reason}. Mã vẫn dùng được nếu chưa hết hạn.', vars: ['reason'] },
  { key: 'tele.combat', group: 'tele', label: 'Vừa giao tranh', default: 'Bạn vừa giao tranh: chờ {seconds} giây nữa mới tele được.', vars: ['seconds'] },
  { key: 'tele.cooldown', group: 'tele', label: 'Tele đang hồi', default: 'Tele đang hồi: chờ {seconds} giây.', vars: ['seconds'] },
  { key: 'tele.tooBig', group: 'tele', label: 'Dino người dịch chuyển quá lớn', default: 'Chỉ dino từ {max}% tăng trưởng trở xuống mới tele được (dino của bạn {growth}%).', vars: ['max', 'growth'] },
  { key: 'tele.targetBig', group: 'tele', label: 'Dino người đưa mã quá lớn', default: 'Dino của người đưa mã đã lớn hơn {max}%: không tele tới được.', vars: ['max'] },
  { key: 'tele.otherSpecies', group: 'tele', label: 'Khác loài với người đưa mã', default: 'Chỉ tele tới dino cùng loài.', vars: [] },
  { key: 'tele.targetGone', group: 'tele', label: 'Người đưa mã không còn trong game', default: 'Người đưa mã không còn trong game hoặc dino đã chết.', vars: [] },
  { key: 'tele.noDino', group: 'tele', label: 'Tele: chưa điều khiển dino', default: 'Bạn cần đang điều khiển một con dino còn sống để tele.', vars: [] },
  { key: 'tele.busy', group: 'tele', label: 'Đang có lần tele khác', default: 'Đang có một lần tele đếm ngược.', vars: [] },
  { key: 'tele.prison', group: 'tele', label: 'Đang ở tù', default: 'Bạn đang ở tù: không tele được.', vars: [] },
  { key: 'tele.targetPrison', group: 'tele', label: 'Người đưa mã đang ở tù', default: 'Người đưa mã đang ở tù: không tele tới được.', vars: [] },
  // --- prime tasks (prime-notify.ts): sent by the bridge when a task turns on ---
  { key: 'prime.conditionDone', group: 'prime', label: 'Hoàn thành một nhiệm vụ prime ({task} = tên nhiệm vụ)', default: '✅ Đã hoàn thành nhiệm vụ prime: {task} ({done}/10, cần {needed} để đủ điều kiện prime).', vars: ['task', 'n', 'done', 'needed'] },
  { key: 'prime.eligible', group: 'prime', label: 'Dino vừa đủ điều kiện prime', default: '🌟 Dino của bạn đã đủ điều kiện prime ({done}/10)! Game xét prime khi dino đạt 75% growth.', vars: ['done', 'needed'] },
  // --- prison (prison.ts): sent by the bridge ---
  { key: 'prison.jailed.announce', group: 'prison', label: 'Thông báo toàn server khi có người bị bỏ tù', default: '🔒 {name} bị bỏ tù {duration}. Lý do: {reason}', vars: ['name', 'duration', 'reason', 'offense', 'prior', 'times'] },
  { key: 'prison.jailed.player', group: 'prison', label: 'Tin riêng cho người bị bỏ tù', default: 'Bạn bị bỏ tù {duration}. Lý do: {reason}. Án chỉ trừ khi bạn online và ở trong nhà tù.', vars: ['name', 'duration', 'reason', 'offense', 'prior', 'times'] },
  { key: 'prison.moved.player', group: 'prison', label: 'Dino được đưa vào tù (tin riêng)', default: '🔒 Bạn đang ở tù, còn {left}. Ra khỏi khu tù là vượt ngục: cả server sẽ thấy vị trí của bạn.', vars: ['left', 'reason'] },
  { key: 'prison.escape.announce', group: 'prison', label: 'Vượt ngục (toàn server)', default: '🚨 VƯỢT NGỤC: {name} ({species}) vừa trốn khỏi nhà tù! Án còn {left}. Vị trí đang hiện trên bản đồ, ai hạ được sẽ được ghi công Thợ săn.', vars: ['name', 'species', 'left', 'escapes'] },
  { key: 'prison.escape.player', group: 'prison', label: 'Vượt ngục (tin riêng cho kẻ trốn)', default: '🚨 Bạn đã ra khỏi nhà tù: cả server được báo và thấy vị trí của bạn trên bản đồ. Án tạm dừng (còn {left}) cho tới khi bạn quay lại.', vars: ['left'] },
  { key: 'prison.escape.remind', group: 'prison', label: 'Nhắc lại khi còn đang trốn (toàn server)', default: '🚨 TRUY NÃ: {name} ({species}) vẫn đang trốn ngục đã {minutes} phút. Án còn {left}. Xem vị trí trên bản đồ.', vars: ['name', 'species', 'minutes', 'left'] },
  { key: 'prison.returned.announce', group: 'prison', label: 'Kẻ vượt ngục quay lại tù (toàn server)', default: '🔒 {name} đã quay lại nhà tù, án tiếp tục (còn {left}).', vars: ['name', 'left'] },
  { key: 'prison.bounty.announce', group: 'prison', label: 'Có người bắt được kẻ vượt ngục (toàn server)', default: '🏹 BẮT ĐƯỢC KẺ VƯỢT NGỤC: {hunter} đã bắt được {name}! Phần thưởng sẽ được cập nhật sau.', vars: ['hunter', 'name', 'count'] },
  { key: 'prison.caught.announce', group: 'prison', label: 'Kẻ vượt ngục bị bắt lại, không rõ ai bắt (toàn server)', default: '🔒 Kẻ vượt ngục {name} đã bị bắt lại và đưa về nhà tù (án còn {left}).', vars: ['name', 'left'] },
  { key: 'prison.caught.player', group: 'prison', label: 'Bị bắt lại, đưa về tù (tin riêng)', default: '🔒 Bạn đã bị bắt lại và đưa về nhà tù. Án còn {left}.', vars: ['left'] },
  { key: 'prison.died.player', group: 'prison', label: 'Chết khi đang trốn (tin riêng)', default: '💀 Dino của bạn đã chết khi trốn ngục. Spawn lại đúng loài {species} để được tạo lại chính con đó trong nhà tù (loài khác thì con mới vào tù). Án còn {left}.', vars: ['species', 'left'] },
  { key: 'prison.recreated.player', group: 'prison', label: 'Dino được tạo lại trong tù (tin riêng)', default: '🔒 Dino của bạn đã được tạo lại trong nhà tù. Tiếp tục thi hành án: còn {left}.', vars: ['left'] },
  { key: 'prison.killPenalty.player', group: 'prison', label: 'Giết bạn tù: bị cộng án (tin riêng)', default: '⚖️ Bạn đã giết bạn tù {name}: án +{minutes} phút (còn {left}).', vars: ['minutes', 'name', 'left'] },
  { key: 'prison.extended.player', group: 'prison', label: 'Admin đổi thời gian án (tin riêng)', default: 'Án tù của bạn đổi {minutes} phút, còn {left}.', vars: ['minutes', 'left'] },
  { key: 'prison.released.player', group: 'prison', label: 'Mãn hạn tù (tin riêng)', default: '🔓 Bạn đã MÃN HẠN TÙ và được đưa về chỗ bị bắt. Chơi đúng luật nhé!', vars: ['name', 'served'] },
  { key: 'prison.releasedEarly.player', group: 'prison', label: 'Được admin thả sớm (tin riêng)', default: '🔓 Admin đã THẢ SỚM bạn khỏi nhà tù. Bạn được đưa về chỗ bị bắt.', vars: ['name', 'served', 'by'] },
  { key: 'prison.released.announce', group: 'prison', label: 'Mãn hạn tù (toàn server)', default: '🔓 RA TÙ: {name} đã mãn hạn tù ({served} trong tù) và được thả.', vars: ['name', 'served'] },
  { key: 'prison.releasedEarly.announce', group: 'prison', label: 'Được admin thả sớm (toàn server)', default: '🔓 RA TÙ: {name} được admin thả sớm khỏi nhà tù.', vars: ['name', 'served', 'by'] },
  // --- greeting (mods/HelloIsle) ---
  { key: 'hello.welcome', group: 'hello', label: 'Chào khi vào game / spawn', default: 'Welcome to the island. Type !ping to check the mods.', vars: [] },
  { key: 'hello.pong', group: 'hello', label: 'Trả lời !ping', default: 'pong, mods are alive', vars: [] },
];

export const MESSAGE_BY_KEY: ReadonlyMap<string, MessageDef> = new Map(MESSAGES.map((m) => [m.key, m]));
/** Sent by the bridge itself (RCON announce); the rest by the mods. */
const BRIDGE_GROUPS: ReadonlySet<MessageGroup> = new Set(['server', 'corpses', 'ai', 'ban', 'prime', 'prison']);

export interface Periodic {
  id: string;
  text: string;
  everyMin: number;
  enabled: boolean;
}

export interface MessagesSettings {
  /** Only the texts an admin changed; "" = do not send. */
  texts: Record<string, string>;
  /** Seconds left at which a restart / stop countdown announces, largest first. */
  countdownMarks: number[];
  periodic: Periodic[];
  /** Clear corpses every `everyMin` minutes (0 = off), announced `warnSec` before. */
  corpseWipe: { everyMin: number; warnSec: number };
}

export const MESSAGES_DEFAULTS: MessagesSettings = {
  texts: {},
  countdownMarks: [900, 600, 300, 180, 120, 60, 30, 10],
  periodic: [],
  corpseWipe: { everyMin: 0, warnSec: 60 },
};

const MAX_TEXT = 300;
const MAX_PERIODIC = 10;
const settingsPath = (): string => join(config.dataDir, 'messages.json');

function cleanText(v: unknown, what: string, vars: readonly string[] | null): string {
  if (typeof v !== 'string') throw new ValidationError(`${what} must be text`);
  // One line in the game's chat: no control characters.
  const text = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (text.length > MAX_TEXT) throw new ValidationError(`${what}: at most ${MAX_TEXT} characters`);
  if (vars !== null) {
    for (const [, name] of text.matchAll(/\{(\w+)\}/g)) {
      if (!vars.includes(name as string)) {
        throw new ValidationError(`${what}: {${name}} is not available here${vars.length ? ` (use ${vars.map((x) => `{${x}}`).join(', ')})` : ''}`);
      }
    }
  }
  return text;
}

function int(v: unknown, lo: number, hi: number, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new ValidationError(`${what} must be a whole number ${lo}–${hi}`);
  return v;
}

export function validateMessages(raw: unknown): MessagesSettings {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('body must be an object');
  const r = raw as Record<string, unknown>;
  const texts: Record<string, string> = {};
  const rawTexts = r['texts'] ?? {};
  if (typeof rawTexts !== 'object' || rawTexts === null || Array.isArray(rawTexts)) throw new ValidationError('texts must be an object');
  for (const [key, v] of Object.entries(rawTexts)) {
    const def = MESSAGE_BY_KEY.get(key);
    if (!def) throw new ValidationError(`unknown message "${key}"`);
    const text = cleanText(v, key, def.vars);
    if (def.offByDefault) {
      // Off unless the admin wrote a text (the suggested one counts): "" = off = none.
      if (text !== '') texts[key] = text;
    } else if (text !== def.default) {
      // The default itself is not an edit: kept out, so a later new default applies.
      texts[key] = text;
    }
  }
  const marksRaw = r['countdownMarks'] ?? MESSAGES_DEFAULTS.countdownMarks;
  if (!Array.isArray(marksRaw) || marksRaw.length > 20) throw new ValidationError('countdownMarks must be a list of at most 20');
  const countdownMarks = [...new Set(marksRaw.map((m, i) => int(m, 5, 1800, `countdownMarks[${i}]`)))].sort((a, b) => b - a);
  const periodicRaw = r['periodic'] ?? [];
  if (!Array.isArray(periodicRaw) || periodicRaw.length > MAX_PERIODIC) throw new ValidationError(`periodic must be a list of at most ${MAX_PERIODIC}`);
  const periodic = periodicRaw.map((p, i): Periodic => {
    if (typeof p !== 'object' || p === null) throw new ValidationError(`periodic ${i + 1} is not an object`);
    const o = p as Record<string, unknown>;
    const text = cleanText(o['text'], `periodic ${i + 1}`, []);
    if (text === '') throw new ValidationError(`periodic ${i + 1}: the text is empty`);
    return {
      id: typeof o['id'] === 'string' && /^[a-z0-9]{1,16}$/.test(o['id']) ? o['id'] : randomBytes(4).toString('hex'),
      text,
      everyMin: int(o['everyMin'], 5, 1440, `periodic ${i + 1}: everyMin`),
      enabled: o['enabled'] !== false,
    };
  });
  const cw = (r['corpseWipe'] ?? MESSAGES_DEFAULTS.corpseWipe) as Record<string, unknown>;
  if (typeof cw !== 'object' || cw === null) throw new ValidationError('corpseWipe must be an object');
  const corpseWipe = { everyMin: int(cw['everyMin'], 0, 1440, 'corpseWipe.everyMin'), warnSec: int(cw['warnSec'], 0, 600, 'corpseWipe.warnSec') };
  if (corpseWipe.everyMin > 0 && corpseWipe.everyMin < 5) throw new ValidationError('corpseWipe.everyMin: 0 (off) or at least 5');
  return { texts, countdownMarks, periodic, corpseWipe };
}

// Read on every announcement: kept in memory, loaded at start and on save.
let current: MessagesSettings = structuredClone(MESSAGES_DEFAULTS);

export function currentMessages(): MessagesSettings { return current; }

export async function loadMessages(): Promise<MessagesSettings> {
  try {
    current = validateMessages(JSON.parse(await readFile(settingsPath(), 'utf8')));
  } catch {
    current = structuredClone(MESSAGES_DEFAULTS);
  }
  return current;
}

/** Fill {name} from `vars`; the admin's text, else the default. Null = turned off. */
export function renderMessage(key: string, vars: Record<string, string | number> = {}, s: MessagesSettings = current): string | null {
  const def = MESSAGE_BY_KEY.get(key);
  if (!def) throw new Error(`unknown message ${key}`);
  const text = s.texts[key] ?? (def.offByDefault ? '' : def.default);
  if (text === '') return null;
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (vars[name] === undefined ? all : String(vars[name])))
    .replace(/\s+/g, ' ').trim();
}

/** "5 phút" / "5 min" (or seconds under a minute), for {left} / {leftEn}. */
export function leftVars(seconds: number): { left: string; leftEn: string } {
  const m = Math.round(seconds / 60);
  return seconds >= 60 ? { left: `${m} phút`, leftEn: `${m} min` } : { left: `${seconds} giây`, leftEn: `${seconds} s` };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value)}\n`, 'utf8');
  await rename(tmp, path);
}

/**
 * What the mods read: only their own texts (the bridge renders the rest). A
 * message off by default and not turned on is written as "" (= do not send):
 * the mod only knows its default text.
 */
export function modTexts(s: MessagesSettings): { texts: Record<string, string> } {
  const texts: Record<string, string> = {};
  for (const def of MESSAGES) {
    if (BRIDGE_GROUPS.has(def.group) || def.fromBridge === true) continue;
    const own = s.texts[def.key];
    if (own !== undefined) texts[def.key] = own;
    else if (def.offByDefault) texts[def.key] = '';
  }
  return { texts };
}

export async function saveMessages(raw: unknown): Promise<MessagesSettings> {
  const s = validateMessages(raw);
  await writeJson(settingsPath(), s);
  await writeJson(config.messagesModPath, modTexts(s));
  current = s;
  return s;
}

/** At start: make sure the mods' file matches what the panel saved (a redeploy does not touch it). */
export async function syncModTexts(): Promise<void> {
  await writeJson(config.messagesModPath, modTexts(current));
}
