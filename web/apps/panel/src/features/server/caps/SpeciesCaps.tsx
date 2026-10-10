import { Button, Card, CardBody, CardHead, NumberInput, Switch } from '@isle/ui';
import { can } from '../../../app/nav';
import { useSession } from '../../../app/session';
import { dinoName } from '../../../lib/format';
import { FreshBar } from '../../settings-form/FreshBar';
import { useSettingsForm } from '../../settings-form/useSettingsForm';
import s from './SpeciesCaps.module.css';

/** bridge/src/species-cap.ts as the panel reads it. */
export interface SpeciesRule { cap: number; reserve: number }
export interface SpeciesCapSettings { enabled: boolean; graceS: number; species: Record<string, SpeciesRule> }
interface SpeciesCapView {
  settings: SpeciesCapSettings;
  counts: Array<{ species: string; alive: number; cap: number; reserve: number; hidden: boolean }>;
  over: Array<{ steamId: string; name: string | null; species: string; killAt: number }>;
  species: string[]; allowed: string[]; rcon: boolean;
}

const URL = '/api/species-cap';
/** A limit switched on: 8 common slots, no priority one, as the owner's example. */
export const DEFAULT_RULE: SpeciesRule = { cap: 8, reserve: 0 };

/** The rules with one species' limit set, or taken away (null). */
export function withRule(all: Record<string, SpeciesRule>, species: string, rule: SpeciesRule | null): Record<string, SpeciesRule> {
  const out = { ...all };
  if (rule === null) delete out[species]; else out[species] = rule;
  return out;
}

/**
 * Server → Giới hạn loài (owner, 2026-10-10): at most N of a species alive at once, + priority slots for
 * VIP / SVip / admins. Full: off the game's picker for everyone; a plain player who still came in past
 * the common slots has that new dino removed after a few seconds.
 */
export function SpeciesCaps() {
  const { access } = useSession();
  const edit = can(access, 'config.edit');
  const f = useSettingsForm<SpeciesCapView, SpeciesCapSettings>(URL, { label: 'Giới hạn loài', href: '#server/caps', select: (r) => r.settings, saved: 'Đã lưu giới hạn loài.' });
  const d = f.draft;
  const v = f.latest;
  const now = Math.floor(Date.now() / 1000);
  const setRule = (sp: string, rule: SpeciesRule | null): void => f.update((x) => ({ ...x, species: withRule(x.species, sp, rule) }));
  const list = v ? [...new Set([...v.species, ...Object.keys(d?.species ?? {})])].sort() : [];
  const count = (sp: string) => v?.counts.find((c) => c.species === sp);
  return (
    <Card>
      <CardHead title="🦖 Giới hạn loài" sub="số con mỗi loài được chơi cùng lúc trên toàn server" />
      <CardBody stack>
        {d === null || v === undefined ? <span className={s.muted}>{f.error ? `Không tải được: ${f.error.message}` : 'Đang tải…'}</span> : <>
          {!v.rcon && <p className={s.warn}>RCON chưa cấu hình: không ẩn / hiện loài trên bảng chọn được.</p>}
          <Switch checked={d.enabled} disabled={!edit} onChange={(on) => f.set('enabled', on)} label="Bật giới hạn loài (tắt: mọi loài hiện lại, không xoá dino nào)" />
          <div className={s.fields}>
            <label>Xoá dino vượt suất sau (giây)<NumberInput aria-label="Xoá dino vượt suất sau (giây)" min={5} max={300} value={d.graceS} disabled={!edit} onChange={(x) => f.set('graceS', Math.round(x))} /></label>
          </div>
          <p className={s.hint}>
            <b>Suất chung</b>: ai cũng chơi được. <b>Suất ưu tiên</b>: thêm cho VIP, SVip và admin. Đủ <b>chung + ưu tiên</b> con đang sống thì loài <b>biến khỏi bảng chọn dino</b> của cả server; có con chết, thoát game hoặc cất gara là hiện lại.
            Mọi con đều được đếm, kể cả của VIP / SVip / admin. Người thường vào làm con vượt suất chung (vào suất ưu tiên, hoặc chọn đúng lúc loài vừa đủ) thì được báo và <b>dino mới đó bị xoá</b> sau số giây trên để chọn loài khác; trong lúc chờ không lấy dino từ gara được.
            Không bao giờ xoá: dino đang chơi sẵn (vào lại game, chuyển sinh, lấy từ gara) và dino không phải vừa chọn ở bảng (lớn hơn 25%). Hạ giới hạn thì ai đang chơi vẫn giữ. Loài đã tắt trong Cấu hình game không bao giờ được bật lại ở đây.
          </p>
          {v.over.length > 0 && (
            <div className={s.over}>
              <b>Đang chờ xoá (vượt suất):</b>
              {v.over.map((o) => <span key={o.steamId}>{o.name ?? o.steamId} ({dinoName(o.species)}) còn {Math.max(0, o.killAt - now)} giây</span>)}
            </div>
          )}
          <div className={s.table} role="table" aria-label="Giới hạn từng loài">
            <div className={`${s.row} ${s.headRow}`} role="row">
              <span role="columnheader">Loài</span><span role="columnheader">Giới hạn</span><span role="columnheader">Suất chung</span>
              <span role="columnheader">Suất ưu tiên</span><span role="columnheader">Đang có</span>
            </div>
            {list.map((sp) => {
              const rule = d.species[sp];
              const c = count(sp);
              const off = !v.allowed.includes(sp);
              return (
                <div key={sp} className={`${s.row}${rule ? '' : ` ${s.free}`}`} role="row">
                  <span className={s.name} role="cell">{dinoName(sp)}{off && <small className={s.muted}> (đã tắt trong Game.ini)</small>}</span>
                  <span role="cell"><Switch checked={rule !== undefined} disabled={!edit} aria-label={`Giới hạn ${dinoName(sp)}`}
                    onChange={(on) => setRule(sp, on ? DEFAULT_RULE : null)} /></span>
                  <span role="cell" className={s.cell}>{rule ? <><span className={s.narrow}>Suất chung</span><NumberInput aria-label={`Suất chung ${dinoName(sp)}`} min={0} max={500} value={rule.cap} disabled={!edit}
                    onChange={(x) => setRule(sp, { ...rule, cap: Math.round(x) })} /></> : <span className={s.muted}>không giới hạn</span>}</span>
                  <span role="cell" className={s.cell}>{rule ? <><span className={s.narrow}>Suất ưu tiên</span><NumberInput aria-label={`Suất ưu tiên ${dinoName(sp)}`} min={0} max={100} value={rule.reserve} disabled={!edit}
                    onChange={(x) => setRule(sp, { ...rule, reserve: Math.round(x) })} /></> : null}</span>
                  <span role="cell" className={s.live}>{c ? <>{c.alive} / {c.cap + c.reserve}{c.hidden && <span className={s.hidden}>đã ẩn khỏi bảng chọn</span>}</> : rule ? <span className={s.muted}>lưu để đếm</span> : null}</span>
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
