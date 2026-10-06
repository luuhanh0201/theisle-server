import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getJson, type DamageReachView, type ReachGroup } from '@isle/api';
import { Card, CardBody, CardHead } from '@isle/ui';
import { PlayerLink } from '../../../components/dino/Identity';
import { Feed } from '../../../components/feed/Feed';
import type { FeedEvent } from '../../../components/feed/describe';
import { ListTools, Pager, Pill, Seg, pageOf } from '../../../components/list/List';
import t from '../../../components/table/Table.module.css';
import { clock, dateTime, dinoName, meters, num, pct } from '../../../lib/format';
import s from './Damage.module.css';

const LIMIT = 20;
type FarBite = DamageReachView['far'][number];
export interface Suspect { steamId: string; name: string | null; species: string | null; count: number; maxM: number; maxTimes: number; last: number }

/** The far bites by attacker (players only): how many, the farthest, how many times its limit; most first. */
export function suspectsOf(far: readonly FarBite[]): Suspect[] {
  const by = new Map<string, Suspect>();
  for (const b of far) {
    if (b.attacker === 'ai') continue;
    const times = b.reach.limitM > 0 ? b.reach.distM / b.reach.limitM : 0;
    const cur = by.get(b.attacker);
    if (cur === undefined) {
      by.set(b.attacker, { steamId: b.attacker, name: b.attackerName ?? null, species: b.attackerSpecies ?? null, count: 1, maxM: b.reach.distM, maxTimes: times, last: b.t });
    } else {
      cur.count += 1;
      cur.maxM = Math.max(cur.maxM, b.reach.distM);
      cur.maxTimes = Math.max(cur.maxTimes, times);
      if (b.t > cur.last) { cur.last = b.t; cur.name = b.attackerName ?? cur.name; cur.species = b.attackerSpecies ?? cur.species; }
    }
  }
  return [...by.values()].sort((a, b) => b.count - a.count || b.maxTimes - a.maxTimes);
}

/** The damage lines the search and the filter keep. */
export function damageMatch(e: FeedEvent, q: string, only: 'all' | 'far'): boolean {
  if (only === 'far' && !e.reach?.far) return false;
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return [e.attackerName ?? '', e.victimName ?? '', e.attacker ?? '', e.victim ?? '', dinoName(e.attackerSpecies), dinoName(e.victimSpecies)]
    .some((v) => String(v).toLowerCase().includes(n));
}

const SIZE: Record<ReachGroup['size'], string> = { young: 'con non', grown: 'con lớn', all: 'cả loài' };
const BASIS: Record<FarBite['reach']['basis'], string> = { learned: 'đã học', species: 'theo cả loài', default: 'mặc định' };
const at = (l: { x: number; y: number } | undefined): string => (l ? `${num(l.x)}, ${num(l.y)}` : '-');

/**
 * Người chơi → Sát thương: the damage log with each bite's reach (metres between the two dinos), the
 * bites far beyond their species' usual reach (bridge damage-reach.ts learns it), who made them, and
 * the reach learned per species.
 */
export function Damage() {
  const feed = useQuery({ queryKey: ['/api/feed', 'damage'], queryFn: () => getJson<{ events: FeedEvent[] }>('/api/feed?limit=500&type=damage'), refetchInterval: 2000 });
  const d = useQuery({ queryKey: ['/api/damage-reach'], queryFn: () => getJson<DamageReachView>('/api/damage-reach?limit=500'), refetchInterval: 5000 }).data;
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'all' | 'far'>('all');
  const [page, setPage] = useState(1);
  const [farPage, setFarPage] = useState(1);
  const all = feed.data?.events ?? [];
  const rows = all.filter((e) => damageMatch(e, q, only));
  const shown = pageOf(rows, page, LIMIT);
  const far = d?.far ?? [];
  const farShown = pageOf(far, farPage, LIMIT);
  const suspects = suspectsOf(far);
  const r = d?.rules;
  return (
    <div className={s.stack}>
      <Card>
        <CardHead title="Đòn xa bất thường" sub="đòn cắn từ xa hơn hẳn tầm cắn thường của loài đó, cả đòn cắn AI"><Pill>{far.length} đòn</Pill></CardHead>
        <CardBody>
          {r && <p className={s.hint}>Khoảng cách là từ tâm kẻ cắn tới tâm nạn nhân lúc game tính damage. Bridge tự học tầm cắn thường của từng loài
            (con non dưới {pct(r.YOUNG)} growth và con lớn tính riêng) từ các đòn cắn nó thấy. Một đòn là <b>xa bất thường</b> khi vượt
            Q3 + {r.FENCE} × IQR của các đòn đó (không dưới {meters(r.FLOOR_M)}); loài chưa đủ {r.MIN_SAMPLES} đòn dùng {meters(r.DEFAULT_M)};
            trên {meters(r.HARD_M)} luôn là bất thường. Đòn xa không được dùng để học, nên người gian lận không nới được giới hạn.</p>}
          {suspects.length > 0 && <>
            <h3 className={s.sub}>Người có đòn xa</h3>
            <div className={t.wrap}><table className={t.table}>
              <thead><tr><th>Người chơi</th><th className={t.right}>Số đòn xa</th><th className={t.right}>Xa nhất</th><th className={t.right}>Gấp giới hạn</th><th>Lần cuối</th></tr></thead>
              <tbody>{suspects.map((p) => (
                <tr key={p.steamId}>
                  <td><PlayerLink id={p.steamId} name={p.name} /><br /><span className={t.muted}>{dinoName(p.species)}</span></td>
                  <td className={t.right}><b>{p.count}</b></td>
                  <td className={t.right}>{meters(p.maxM)}</td>
                  <td className={t.right}>×{p.maxTimes.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}</td>
                  <td title={dateTime(p.last)}>{dateTime(p.last)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </>}
          <h3 className={s.sub}>Từng đòn</h3>
          <div className={t.wrap}><table className={t.table}>
            <thead><tr><th>Giờ</th><th>Kẻ cắn</th><th>Nạn nhân</th><th className={t.right}>Khoảng cách</th><th>Vị trí kẻ cắn → nạn nhân</th><th className={t.right}>Damage</th></tr></thead>
            <tbody>
              {farShown.rows.length === 0 && <tr><td colSpan={6} className={t.muted}>{d ? 'Chưa có đòn nào xa bất thường.' : 'Đang tải…'}</td></tr>}
              {farShown.rows.map((b) => (
                <tr key={`${b.id}-${b.t}-${b.attacker}`}>
                  <td title={dateTime(b.t)} className={s.nowrap}>{clock(b.t)}</td>
                  <td><PlayerLink id={b.attacker} name={b.attackerName} /><br /><span className={t.muted}>{dinoName(b.attackerSpecies)} {pct(b.attackerGrowth)}</span></td>
                  <td><PlayerLink id={b.victim} name={b.victimName} /><br /><span className={t.muted}>{dinoName(b.victimSpecies)} {pct(b.victimGrowth)}</span></td>
                  <td className={t.right}><b className={s.far}>{meters(b.reach.distM)}</b><br />
                    <span className={t.muted} title={`Giới hạn ${BASIS[b.reach.basis]}`}>giới hạn {meters(b.reach.limitM)}</span></td>
                  <td className={t.mono}>{at(b.attackerLoc)}<br />→ {at(b.loc)}</td>
                  <td className={t.right}>{num(b.amount)}{b.ticks > 1 && <><br /><span className={t.muted}>cắn giữ ×{b.ticks}</span></>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <Pager total={far.length} page={farShown.page} limit={LIMIT} unit="đòn" onPage={setFarPage} />
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Log sát thương" sub="mỗi đòn cắn giữa hai người chơi, kèm khoảng cách"><Pill>{rows.length} đòn</Pill></CardHead>
        <CardBody>
          <ListTools q={q} onQ={(v) => { setQ(v); setPage(1); }} placeholder="Tìm theo tên, SteamID hoặc loài…">
            <Seg label="Lọc đòn" value={only} options={[['all', 'Tất cả'], ['far', 'Chỉ đòn xa']]} onChange={(v) => { setOnly(v); setPage(1); }} />
          </ListTools>
          <Feed tall events={shown.rows} empty={feed.isLoading ? 'Đang tải…' : q || only === 'far' ? 'Không có đòn nào phù hợp' : 'Chưa có đòn cắn nào giữa người chơi'} />
          <Pager total={rows.length} page={shown.page} limit={LIMIT} unit="đòn" onPage={setPage} />
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Tầm cắn đã học theo loài" sub="từ các đòn cắn bình thường gần nhất (tối đa 1.000 đòn mỗi nhóm), mét, tâm tới tâm" />
        <CardBody>
          {(d?.groups ?? []).length === 0 ? <p className={s.hint}>{d ? 'Chưa có đòn cắn bình thường nào để học (cần mod StatsLogger bản mới, có từ lần khởi động lại server sau khi cập nhật).' : 'Đang tải…'}</p>
            : <div className={t.wrap}><table className={t.table}>
            <thead><tr><th>Loài</th><th>Cỡ</th><th className={t.right}>Số đòn</th><th className={t.right}>Trung vị</th><th className={t.right}>95% đòn trong</th><th className={t.right}>Giới hạn</th></tr></thead>
            <tbody>
              {(d?.groups ?? []).map((g) => (
                <tr key={`${g.species}|${g.size}`}>
                  <td>{dinoName(g.species)}</td><td className={t.muted}>{SIZE[g.size]}</td>
                  <td className={t.right}>{num(g.samples)}</td><td className={t.right}>{meters(g.medianM)}</td><td className={t.right}>{meters(g.p95M)}</td>
                  <td className={t.right}>{g.limitM === null ? <span className={t.muted} title={`Cần ${r?.MIN_SAMPLES ?? 30} đòn`}>chưa đủ đòn</span> : <b>{meters(g.limitM)}</b>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>}
        </CardBody>
      </Card>
    </div>
  );
}
