import { Button, Card, CardBody, CardHead, NumberInput, Switch } from '@isle/ui';
import { can } from '../../../app/nav';
import { useSession } from '../../../app/session';
import { dinoName } from '../../../lib/format';
import { FreshBar } from '../../settings-form/FreshBar';
import { useSettingsForm } from '../../settings-form/useSettingsForm';
import s from './SpeciesCaps.module.css';

/** bridge/src/species-cap.ts as the panel reads it. */
export interface SpeciesRule { cap: number }
export interface SpeciesCapSettings { enabled: boolean; graceS: number; species: Record<string, SpeciesRule> }
interface SpeciesCapView {
  settings: SpeciesCapSettings;
  counts: Array<{ species: string; alive: number; free: number; cap: number }>;
  over: Array<{ steamId: string; name: string | null; species: string; killAt: number }>;
  species: string[]; allowed: string[];
}

const URL = '/api/species-cap';

/** The rules with one species' limit set; 0 = no limit (taken away). */
export function withCap(all: Record<string, SpeciesRule>, species: string, cap: number): Record<string, SpeciesRule> {
  const out = { ...all };
  if (cap > 0) out[species] = { cap }; else delete out[species];
  return out;
}

/**
 * Server → Giới hạn loài (owner, 2026-10-10): at most N of a species alive at once on the whole server,
 * the SVip and the admins free of it. Every species free by default (0). The game's picker is left as
 * it is; a player past the limit has that new dino removed after a few seconds.
 */
export function SpeciesCaps() {
  const { access } = useSession();
  const edit = can(access, 'config.edit');
  const f = useSettingsForm<SpeciesCapView, SpeciesCapSettings>(URL, { label: 'Giới hạn loài', href: '#server/caps', select: (r) => r.settings, saved: 'Đã lưu giới hạn loài.' });
  const d = f.draft;
  const v = f.latest;
  const now = Math.floor(Date.now() / 1000);
  const setCap = (sp: string, cap: number): void => f.update((x) => ({ ...x, species: withCap(x.species, sp, cap) }));
  const list = v ? [...new Set([...v.species, ...Object.keys(d?.species ?? {})])].sort() : [];
  const count = (sp: string) => v?.counts.find((c) => c.species === sp);
  return (
    <Card>
      <CardHead title="🦖 Giới hạn loài" sub="số con tối đa mỗi loài được chơi cùng lúc trên toàn server" />
      <CardBody stack>
        {d === null || v === undefined ? <span className={s.muted}>{f.error ? `Không tải được: ${f.error.message}` : 'Đang tải…'}</span> : <>
          <Switch checked={d.enabled} disabled={!edit} onChange={(on) => f.set('enabled', on)} label="Bật giới hạn loài (tắt: chọn thoải mái, không xoá dino nào)" />
          <div className={s.fields}>
            <label>Xoá dino vượt số lượng sau (giây)<NumberInput aria-label="Xoá dino vượt số lượng sau (giây)" min={5} max={300} value={d.graceS} disabled={!edit} onChange={(x) => f.set('graceS', Math.round(x))} /></label>
          </div>
          <p className={s.hint}>
            <b>0 = không giới hạn</b> (mặc định mọi loài). Ví dụ T-Rex 5: cả server chỉ được 5 con T-Rex của người chơi thường (kể cả VIP) cùng lúc. <b>SVip và admin không tính</b> vào số đó và chọn thoải mái.
            Bảng chọn dino của game vẫn hiện đủ loài; ai chọn khi loài đã đủ thì được báo trong game và <b>dino mới đó bị xoá</b> sau số giây trên để chọn loài khác, trong lúc chờ không lấy dino từ gara được.
            Không bao giờ xoá: dino đang chơi sẵn (vào lại game, chuyển sinh, lấy từ gara) và dino không phải vừa chọn ở bảng (lớn hơn 25%). Hạ giới hạn thì ai đang chơi vẫn giữ.
          </p>
          {v.over.length > 0 && (
            <div className={s.over}>
              <b>Đang chờ xoá (vượt số lượng):</b>
              {v.over.map((o) => <span key={o.steamId}>{o.name ?? o.steamId} ({dinoName(o.species)}) còn {Math.max(0, o.killAt - now)} giây</span>)}
            </div>
          )}
          <div className={s.grid} role="list" aria-label="Giới hạn từng loài">
            {list.map((sp) => {
              const cap = d.species[sp]?.cap ?? 0;
              const c = count(sp);
              return (
                <div key={sp} className={`${s.row}${cap > 0 ? ` ${s.limited}` : ''}`} role="listitem">
                  <span className={s.name}>{dinoName(sp)}{!v.allowed.includes(sp) && <small className={s.muted}> (đã tắt trong Game.ini)</small>}</span>
                  <NumberInput aria-label={`Tối đa ${dinoName(sp)}`} min={0} max={500} value={cap} disabled={!edit} onChange={(x) => setCap(sp, Math.round(x))} />
                  <span className={s.live}>{cap === 0 ? <span className={s.muted}>không giới hạn</span>
                    : c ? <>đang có <b>{c.alive}</b> / {c.cap}{c.free > 0 && <> <span className={`${s.muted} ${s.nowrap}`}>(+{c.free} SVip / admin)</span></>}</> : <span className={s.muted}>lưu để đếm</span>}</span>
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
