import type { ReactNode } from 'react';
import type { MutationsData } from '@isle/api';
import { PlayerLink } from '../dino/Identity';
import { MutIcon } from '../dino/Mutations';
import { refFor } from '../../features/mutations/reference';
import { dinoName, isNum, mutName, num, pct } from '../../lib/format';
import { dur } from '../../lib/time';
import s from './Feed.module.css';

/** One line of the game's log, as the bridge's store sends it (bridge/src/store.ts FeedEntry). */
export interface FeedEvent { id: number; t: number; type: string; [k: string]: any }

/** Each type's icon and tone, and what the "Loại" column calls it. */
export const EV: Record<string, [string, string]> = {
  damage: ['damage', 'tone-dmg'], death: ['death', 'tone-kill'], spawn: ['spawn', 'tone-accent'],
  session_start: ['in', 'tone-neutral'], session_end: ['out', 'tone-neutral'], chat: ['chat', 'tone-chat'],
  growth: ['growth', 'tone-grow'], growth_set: ['warn', 'tone-dmg'], mutation: ['spawn', 'tone-grow'],
  admin_kill: ['warn', 'tone-kill'], garage_store: ['garage', 'tone-gar'], garage_redeem: ['garage', 'tone-gar'], portal_command: ['garage', 'tone-gar'],
};
export const EV_LABEL: Record<string, string> = {
  damage: 'Sát thương', death: 'Chết', spawn: 'Spawn', session_start: 'Vào game', session_end: 'Thoát game',
  chat: 'Chat', growth: 'Tăng trưởng', growth_set: 'Đặt growth', mutation: 'Mutation', admin_kill: 'Admin xoá',
  garage_store: 'Cất gara', garage_redeem: 'Lấy gara', portal_command: 'Lệnh web',
};
export const KILL_ERRORS: Record<string, string> = {
  offline: 'người chơi đã offline', no_dino: 'người chơi không có dino lúc lệnh chạy', expired: 'server không nhận lệnh trong 60 giây',
  no_game_thread: 'UE4SS thiếu ExecuteInGameThread, lệnh bị từ chối để an toàn', set_health_failed: 'game từ chối SetHealth', unknown_command: 'mod không hiểu lệnh',
};
const WEB_CMD_ERRORS: Record<string, string> = { offline: 'người chơi không online', expired: 'game không nhận kịp', bad_arguments: 'tham số sai', failed: 'lỗi trong game' };
export const SLOT_LABEL = (k: string): string => k.replace('ParentSlot', 'Cha mẹ ').replace('ElderSlot', 'Elder ').replace(/^Slot/, 'Slot ');

const W = ({ id, name }: { id: string | null | undefined; name?: string | null }) => <PlayerLink id={id ?? null} name={name} />;
const loc = (l: { x: number; y: number } | undefined): string => (l ? ` · ${num(l.x)}, ${num(l.y)}` : '');
const lastLine = (e: FeedEvent): string => (Array.isArray(e.messages) && e.messages.length ? String(e.messages[e.messages.length - 1]) : '');

/** [main line, meta line] for one event (the panel before React's describe()); `scene` draws a death's 📍. */
export function describe(e: FeedEvent, ref: MutationsData | null, scene: (e: FeedEvent) => ReactNode): [ReactNode, ReactNode] {
  const mico = (m: string) => (refFor(ref, m) ? <MutIcon name={refFor(ref, m)!.name} /> : null);
  switch (e.type) {
    case 'damage':
      // One entry per bite; the damage (a hold bite: its ticks summed) is in the value column.
      return [<><W id={e.attacker} name={e.attackerName} /> <span className={s.muted}>cắn</span> <W id={e.victim} name={e.victimName} /></>,
        `${dinoName(e.attackerSpecies)} → ${dinoName(e.victimSpecies)}${loc(e.loc)}`];
    case 'death': {
      if (e.cause === 'garage') return [<><W id={e.steamId} name={e.name} /> cất dino vào gara</>, 'cái chết này không được tính'];
      if (e.cause === 'admin') return [<><W id={e.steamId} name={e.name} />, dino bị admin xoá</>, 'cái chết này không được tính'];
      const life = e.lifeSeconds !== undefined ? ` · sống ${dur(e.lifeSeconds)}` : '';
      // Chuyển sinh (a prime at 100 % reborn, +1 đời): not a death nor a kill (bridge store.ts #rebirth).
      if (e.cause === 'rebirth') return [<><W id={e.steamId} name={e.name} /> chuyển sinh</>, `${dinoName(e.species)} ${pct(e.growth)} · không tính là chết${life}`];
      // Kept here; the players' boards leave it out (store.ts killCounts): an admin on either side, or small prey.
      const notCounted = e.uncounted === 'admin' ? <> · <b>không tính</b> (có admin)</> : e.uncounted === 'small' ? <> · <b>không tính</b> (con lớn giết con ≤ 40%)</> : null;
      if (e.attributed && e.killer) {
        const hit = e.lastHit !== undefined ? ` · đòn cuối ${num(e.lastHit)}` : '';
        return [<><span className={s.kill}><W id={e.killer} name={e.killerName} /></span> đã giết <W id={e.steamId} name={e.name} /></>,
          <>{dinoName(e.killerSpecies)} giết {dinoName(e.species)} {pct(e.growth)}{hit}{life}{notCounted}{scene(e)}</>];
      }
      return [<><W id={e.steamId} name={e.name} /> đã chết</>, <>{dinoName(e.species)} {pct(e.growth)} · không rõ nguyên nhân{life}{scene(e)}</>];
    }
    case 'spawn':
      return [<><W id={e.steamId} name={e.name} /> spawn <b>{dinoName(e.species)}</b></>, `growth ${pct(e.growth)}${loc(e.loc)}`];
    case 'session_start':
      return [<><W id={e.steamId} name={e.name} /> vào server</>, ''];
    case 'session_end':
      return [<><W id={e.steamId} name={e.name} /> rời server</>, `online ${dur(e.duration)}`];
    case 'chat':
      return [<><W id={e.steamId} name={e.name} />: {e.message}</>, ''];
    case 'growth':
      return [<><W id={e.steamId} name={e.name} /> đạt <b>{pct(e.milestone)}</b> growth</>,
        `${dinoName(e.species)}${e.lifeSeconds !== undefined ? ` · sau ${dur(e.lifeSeconds)}` : ''}`];
    case 'growth_set': {
      // `via` (bridge store.ts): the redeem / admin action / item just before made it.
      const why = ({ garage: 'lấy từ gara', admin: 'admin đặt', item: 'dùng vật phẩm' } as Record<string, string>)[e.via];
      return why
        ? [<><W id={e.steamId} name={e.name} /> growth {pct(e.from)} → <b>{pct(e.to)}</b> ({why})</>, dinoName(e.species)]
        : [<><W id={e.steamId} name={e.name} /> growth nhảy {pct(e.from)} → <b>{pct(e.to)}</b></>,
          `${dinoName(e.species)} · không rõ lý do (không có lấy gara / lệnh admin ngay trước)`];
    }
    case 'admin_kill':
      return e.ok
        ? [<>Admin xoá dino của <W id={e.steamId} name={e.name} />{e.species && <> <b>{dinoName(e.species)}</b></>}</>,
          `lệnh #${e.id}${e.growth !== undefined ? ` · growth ${pct(e.growth)}` : ''}${e.reason ? ` · lý do: ${e.reason}` : ''}`]
        : [<>Lệnh xoá dino của <W id={e.steamId} name={e.name} /> thất bại</>, `lệnh #${e.id} · ${KILL_ERRORS[e.error] ?? e.error ?? 'không rõ'}`];
    case 'portal_command': {
      const line = lastLine(e);
      // An admin's /adminpanel action from the panel (garage/admin.lua): the mod's own line.
      if (e.action === 'admin') {
        return [<>Admin thao tác lên dino của <W id={e.steamId} name={e.name} />{e.ok ? '' : <>, <span className={s.kill}>không thực hiện được</span></>}</>,
          e.ok ? line : (WEB_CMD_ERRORS[e.error] ?? (e.error || line))];
      }
      // A mutation item from the player's bag (garage/mutation.lua): the mod's own line.
      if (e.action === 'mutation') {
        return [<><W id={e.steamId} name={e.name} /> dùng vật phẩm mutation trên web{e.ok ? '' : <>, <span className={s.kill}>không dùng được</span></>}</>,
          e.ok ? line : (WEB_CMD_ERRORS[e.error] ?? (line || e.error || ''))];
      }
      const what = e.action === 'store' ? 'cất dino' : e.action === 'skin' ? 'đổi màu dino' : 'lấy dino ra';
      const reply = line ? ` · ${line}` : '';
      return e.ok
        ? [<><W id={e.steamId} name={e.name} /> {what} trên web</>, `game đã nhận${reply}`]
        : [<><W id={e.steamId} name={e.name} /> {what} trên web, bị từ chối</>, `${WEB_CMD_ERRORS[e.error] ?? (e.error || 'theo luật gara')}${reply}`];
    }
    case 'mutation': {
      const g = e.growth !== undefined ? ` · growth ${pct(e.growth)}` : '';
      if (e.via) {
        // Written by the garage / an admin / an item (store.ts #writtenBy), not picked by the player.
        const by = ({ garage: 'Gara khôi phục', admin: 'Admin đặt', item: 'Vật phẩm đặt' } as Record<string, string>)[e.via] ?? 'Đặt';
        return e.to
          ? [<>{by} mutation <b>{mico(e.to)}{mutName(e.to)}</b> cho <W id={e.steamId} name={e.name} /></>, `${dinoName(e.species)} · ${SLOT_LABEL(e.slot)}${g}`]
          : [<>{by}: bỏ mutation <b>{mutName(e.from ?? '')}</b> của <W id={e.steamId} name={e.name} /></>, `${dinoName(e.species)} · ${SLOT_LABEL(e.slot)}`];
      }
      return e.to
        ? [<><W id={e.steamId} name={e.name} /> chọn mutation <b>{mico(e.to)}{mutName(e.to)}</b></>,
          `${dinoName(e.species)} · ${SLOT_LABEL(e.slot)}${e.from ? ` · thay ${mutName(e.from)}` : ''}${g}`]
        : [<><W id={e.steamId} name={e.name} /> bỏ mutation <b>{mico(e.from ?? '')}{mutName(e.from ?? '')}</b></>, `${dinoName(e.species)} · ${SLOT_LABEL(e.slot)}`];
    }
    case 'garage_store':
      return [<><W id={e.steamId} name={e.name} /> cất <b>{dinoName(e.species)}</b></>, `slot ${e.slot} · growth ${pct(e.growth)}`];
    case 'garage_redeem':
      // The one line for a redeem: its young dino's spawn, the web command, the growth and
      // mutations it put back are not logged apart (bridge store.ts #prep / #pushVia).
      return [<><W id={e.steamId} name={e.name} /> lấy <b>{dinoName(e.species)}</b> từ gara{e.ok ? '' : <> <span className={s.kill}>thất bại</span></>}</>,
        `slot ${e.slot}${e.ok && isNum(e.growth) ? ` · growth ${pct(e.growth)}` : ''}`];
    default:
      return [e.type, ''];
  }
}

/** The number an event is about, for the "Giá trị" column. */
export function valueOf(e: FeedEvent): ReactNode {
  const pctOf = (g: unknown): string => (isNum(g) ? `${Math.round(g * 1000) / 10}%` : '');
  switch (e.type) {
    case 'damage':
      if (!isNum(e.amount)) return '';
      return <>−{num(e.amount)}{e.ticks > 1 && <small>cắn giữ ×{e.ticks}</small>}</>;
    // A store or an admin removal is not a death: the 25 % is the shrunk corpse, not the dino.
    case 'death': return e.cause === 'garage' || e.cause === 'admin' || e.cause === 'rebirth' || !isNum(e.growth) ? '' : <>{pctOf(e.growth)}<small>growth</small></>;
    case 'spawn': return isNum(e.growth) ? <>{pctOf(e.growth)}<small>growth</small></> : '';
    case 'growth': case 'growth_set': return pctOf(e.growth ?? e.to);
    default: return '';
  }
}
