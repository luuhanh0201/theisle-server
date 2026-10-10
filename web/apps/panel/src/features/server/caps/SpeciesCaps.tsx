import { Button, Card, CardBody, CardHead, NumberInput, Switch } from '@isle/ui';
import { can } from '../../../app/nav';
import { useSession } from '../../../app/session';
import { dinoName } from '../../../lib/format';
import { FreshBar } from '../../settings-form/FreshBar';
import { useSettingsForm } from '../../settings-form/useSettingsForm';
import s from './SpeciesCaps.module.css';

/** bridge/src/species-cap.ts as the panel reads it. */
export interface SpeciesRule { cap: number }
export interface SpeciesCapSettings { enabled: boolean; species: Record<string, SpeciesRule> }
interface SpeciesCapView {
  settings: SpeciesCapSettings;
  counts: Array<{ species: string; alive: number; free: number; cap: number; hidden: boolean }>;
  species: string[]; allowed: string[]; rcon: boolean;
}

const URL = '/api/species-cap';

/** The rules with one species' limit set; 0 = no limit (taken away). */
export function withCap(all: Record<string, SpeciesRule>, species: string, cap: number): Record<string, SpeciesRule> {
  const out = { ...all };
  if (cap > 0) out[species] = { cap }; else delete out[species];
  return out;
}

/**
 * Server → Giới hạn loài (owner, 2026-10-10): N dinos of a species alive (plain players, VIP included;
 * SVip and admins not counted) and it goes off the game's picker, back once there is room. Nothing is
 * removed. Every species free by default (0).
 */
export function SpeciesCaps() {
  const { access } = useSession();
  const edit = can(access, 'config.edit');
  const f = useSettingsForm<SpeciesCapView, SpeciesCapSettings>(URL, { label: 'Giới hạn loài', href: '#server/caps', select: (r) => r.settings, saved: 'Đã lưu giới hạn loài.' });
  const d = f.draft;
  const v = f.latest;
  const setCap = (sp: string, cap: number): void => f.update((x) => ({ ...x, species: withCap(x.species, sp, cap) }));
  const list = v ? [...new Set([...v.species, ...Object.keys(d?.species ?? {})])].sort() : [];
  const count = (sp: string) => v?.counts.find((c) => c.species === sp);
  return (
    <Card>
      <CardHead title="🦖 Giới hạn loài" sub="số con tối đa mỗi loài được chơi cùng lúc trên toàn server" />
      <CardBody stack>
        {d === null || v === undefined ? <span className={s.muted}>{f.error ? `Không tải được: ${f.error.message}` : 'Đang tải…'}</span> : <>
          <Switch checked={d.enabled} disabled={!edit} onChange={(on) => f.set('enabled', on)} label="Bật giới hạn loài (tắt: mọi loài hiện lại trên bảng chọn)" />
          {!v.rcon && <p className={s.warn}>RCON chưa cấu hình: không ẩn / hiện loài trên bảng chọn được.</p>}
          <p className={s.hint}>
            <b>0 = không giới hạn</b> (mặc định mọi loài). Ví dụ T-Rex 5: khi người chơi thường (kể cả VIP) đang có đủ 5 con T-Rex, T-Rex <b>biến khỏi bảng chọn dino</b> của server, người vào sau không chọn được; có con chết, thoát game hoặc cất gara là T-Rex hiện lại.{' '}
            <b>Không xoá dino nào</b>: ai vào lại game bằng dino đã có (hoặc lấy từ gara) vẫn chơi bình thường. <b>SVip và admin không tính</b> vào số lượng, nhưng lúc loài đang ẩn thì bảng chọn của họ cũng không có loài đó (bảng chọn là chung cả server).
            Loài đã tắt trong Cấu hình game không bao giờ được bật lại ở đây.
          </p>
          <div className={s.grid} role="list" aria-label="Giới hạn từng loài">
            {list.map((sp) => {
              const cap = d.species[sp]?.cap ?? 0;
              const c = count(sp);
              return (
                <div key={sp} className={`${s.row}${cap > 0 ? ` ${s.limited}` : ''}`} role="listitem">
                  <span className={s.name}>{dinoName(sp)}{!v.allowed.includes(sp) && <small className={s.muted}> (đã tắt trong Game.ini)</small>}</span>
                  <NumberInput aria-label={`Tối đa ${dinoName(sp)}`} min={0} max={500} value={cap} disabled={!edit} onChange={(x) => setCap(sp, Math.round(x))} />
                  <span className={s.live}>{cap === 0 ? <span className={s.muted}>không giới hạn</span>
                    : c ? <>đang có <b>{c.alive}</b> / {c.cap}{c.free > 0 && <> <span className={`${s.muted} ${s.nowrap}`}>(+{c.free} SVip / admin)</span></>}
                      {c.hidden && <> <span className={s.hidden}>đã ẩn khỏi bảng chọn</span></>}</> : <span className={s.muted}>lưu để đếm</span>}</span>
                </div>
              );
            })}
          </div>
          <div className={s.foot}><span className={s.dirty}>{f.dirty ? '● Có thay đổi chưa lưu' : 'Đã lưu'}</span>
            {edit && <Button onClick={() => void f.save()} disabled={f.saving}>Lưu giới hạn loài</Button>}</div>
        </>}
      </CardBody>
      <FreshBar show={f.serverChanged} dirty={f.dirty} onReload={f.reload} />
    </Card>
  );
}
