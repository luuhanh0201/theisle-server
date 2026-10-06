import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson } from '@isle/api';
import { Button, Card, CardBody, DateTimeInput, Icon, Select, useToast } from '@isle/ui';
import { useConfirm } from '../../../app/confirm';
import { Chip, PlayerLink } from '../../../components/dino/Identity';
import d from '../../../components/dino/dino.module.css';
import { Pager, Pill, Seg, pageOf } from '../../../components/list/List';
import l from '../../../components/list/List.module.css';
import { dateTime, dinoName, hue, num, pct } from '../../../lib/format';
import { dur } from '../../../lib/time';
import s from './Player.module.css';

/** A life as GET /api/player/<id> lists it (bridge/src/store.ts). */
export interface Life {
  species: string; spawnedAt: number; lastAt: number; endedAt: number | null; end: 'death' | 'garage' | 'admin' | 'rebirth' | null;
  growthStart: number | null; growth: number | null; kills: number; damageDealt: number; damageTaken: number;
  killer: string | null; killerName: string | null; killerSpecies: string | null; redeemedFrom: string | null; elderStacks: number | null;
}
/** What GET /api/lives/<id> adds per life (bridge/src/life-history.ts): its prime tasks, can it be put back. */
export interface LifeDetail {
  spawnedAt: number; species: string; classPath: string | null; growth: number | null; end: string | null; restoredTo: string | null;
  prime: { done: number; code: string; prime?: boolean; eligible?: boolean; elderStacks?: number | null } | null;
}

/** The bridge keeps the whole path of the last 5 lives. */
const PATH_LIVES = 5;
const LIMIT = 10;
type PrimeFilter = 'all' | 'prime' | 'non-prime';

/** "2026-10-06", the day a life began (this computer's time, as the date box). */
export function localIsoDate(t: number): string {
  const x = new Date(t * 1000);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

export function isPrimeLife(life: Life, det: LifeDetail | undefined): boolean {
  return Boolean(det?.prime?.prime || (det?.prime?.elderStacks != null && det.prime.elderStacks > 0) || (life.elderStacks != null && life.elderStacks > 0));
}

/** The filters of the table (a day, a species, prime or not). */
export function livesMatch(life: Life, det: LifeDetail | undefined, f: { date: string; species: string; prime: PrimeFilter }): boolean {
  if (f.date && localIsoDate(life.spawnedAt) !== f.date) return false;
  if (f.species !== 'all' && life.species !== f.species) return false;
  if (f.prime === 'prime' && !isPrimeLife(life, det)) return false;
  if (f.prime === 'non-prime' && isPrimeLife(life, det)) return false;
  return true;
}

/** Các đời dino: every dino the player played, newest first (filters, prime tasks, put back into the garage, the path). */
export function Lives({ id, lives, online }: { id: string; lives: Life[]; online: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const detailUrl = `/api/lives/${encodeURIComponent(id)}`;
  // The details (prime tasks, restorable) change slowly: read once a minute, as before React.
  const details = useQuery({ queryKey: [detailUrl], queryFn: () => getJson<{ lives: LifeDetail[] }>(detailUrl), staleTime: 60_000, refetchInterval: 60_000, enabled: lives.length > 0 }).data;
  const byAt = new Map((details?.lives ?? []).map((x) => [x.spawnedAt, x]));
  const [date, setDate] = useState('');
  const [species, setSpecies] = useState('all');
  const [prime, setPrime] = useState<PrimeFilter>('all');
  const [page, setPage] = useState(1);
  const kinds = [...new Set(lives.map((x) => x.species).filter(Boolean))].sort((a, b) => dinoName(a).localeCompare(dinoName(b), 'vi'));
  const sp = kinds.includes(species) ? species : 'all';
  const filtered = lives.filter((x) => livesMatch(x, byAt.get(x.spawnedAt), { date, species: sp, prime }));
  const shown = pageOf(filtered, page, LIMIT);
  const recent = new Set(lives.slice(0, PATH_LIVES).map((x) => x.spawnedAt));
  const current = lives[0]?.spawnedAt;

  const restore = (det: LifeDetail): void => {
    const label = `${dinoName(det.species)} ${pct(det.growth)}`;
    const name = qc.getQueryData<{ player: { name: string | null } | null }>([`/api/player/${encodeURIComponent(id)}`])?.player?.name;
    confirm({
      title: 'Khôi phục dino vào gara?', okLabel: 'Khôi phục', danger: false,
      text: { label: 'Slot gara', value: `khoiphuc-${det.spawnedAt}` },
      body: <>Đưa <b>{label}</b> (spawn {dateTime(det.spawnedAt)}) vào gara của {name ? <><b>{name}</b> (<span className={d.mono}>{id}</span>)</> : <span className={d.mono}>{id}</span>} như
        lúc trước khi chết: growth, đột biến, nhiệm vụ prime, prime, elder, giới tính, màu. Máu / dạ dày / dinh dưỡng không được ghi lại nên dino ra sẽ khoẻ và no.
        Mỗi đời chỉ khôi phục được một lần.</>,
      run: async (token, _reason, slot) => {
        const r = await adminFetch<{ slot?: string }>('/api/restore-life', 'POST', token, { steamId: id, spawnedAt: det.spawnedAt, slot: slot.trim() });
        toast(`Đã khôi phục ${label} vào gara (slot ${r.slot ?? slot}).`);
        void qc.invalidateQueries({ queryKey: [detailUrl] });
        void qc.invalidateQueries({ queryKey: [`/api/player/${encodeURIComponent(id)}`] });
      },
    });
  };

  return (
    <>
      <div className={s.sectionTitle}>
        <span className={`${s.secIco} ${s.growTone}`}><Icon name="growth" /></span>
        <h2>Các đời dino</h2><span className={s.secSub}>mọi dino người này đã chơi, mới nhất trước</span>
        <span className={s.pillRight}><Pill>{filtered.length === lives.length ? `${lives.length} đời dino` : `${filtered.length} / ${lives.length} đời dino`}</Pill></span>
      </div>
      <Card>
        <CardBody>
          <div className={s.livesTools}>
            <div className={s.filter}>
              <label htmlFor="lives-filter-date" className={s.filterLbl}>Ngày spawn:</label>
              <DateTimeInput id="lives-filter-date" kind="date" value={date} onChange={(v) => { setDate(v); setPage(1); }} />
              {date && <button type="button" className={s.clear} title="Xem tất cả ngày" onClick={() => { setDate(''); setPage(1); }}>✕</button>}
            </div>
            <div className={s.filter}>
              <label htmlFor="lives-filter-species" className={s.filterLbl}>Loài:</label>
              <div className={s.speciesSel}><Select id="lives-filter-species" value={sp} onChange={(v) => { setSpecies(v); setPage(1); }}
                options={[{ value: 'all', label: 'Tất cả loài' }, ...kinds.map((k) => ({ value: k, label: dinoName(k) }))]} /></div>
            </div>
            <Seg label="Lọc Prime" value={prime} onChange={(v) => { setPrime(v); setPage(1); }} options={[['all', 'Tất cả'], ['prime', '👑 Prime'], ['non-prime', 'Chưa Prime']]} />
          </div>
          <div className={l.wrap}><table className={l.table}>
            <thead><tr><th>Dino</th><th>Growth</th><th>Sống</th><th>Kill</th><th className={l.hideSm}>Gây / chịu dmg</th><th>Kết thúc</th><th>Nhiệm vụ</th><th className={l.hideSm}>Spawn lúc</th><th /></tr></thead>
            <tbody>
              {lives.length === 0 && <tr><td colSpan={9} className={l.empty}>Chưa thấy người này spawn dino nào</td></tr>}
              {lives.length > 0 && shown.rows.length === 0 && <tr><td colSpan={9} className={l.empty}>Không tìm thấy đời dino nào phù hợp với bộ lọc</td></tr>}
              {shown.rows.map((x) => {
                const det = byAt.get(x.spawnedAt);
                const alive = x.endedAt === null;
                const name = dinoName(x.species);
                return (
                  <tr key={x.spawnedAt}>
                    <td><div className={d.who}><span className={`${d.avatar} ${d.sm}`} style={{ background: `hsl(${hue(name)} 60% 45%)` }}>{name[0] ?? '?'}</span>
                      <div style={{ minWidth: 0 }}><div className={s.nm}>{name}</div>{x.redeemedFrom && <div className={s.sp}>lấy từ gara · {x.redeemedFrom}</div>}</div></div></td>
                    <td className={s.nowrap}>{pct(x.growthStart)} <span className={s.arrow}>→</span> <b>{pct(x.growth)}</b></td>
                    <td className={s.nowrap}>{dur((alive ? x.lastAt : (x.endedAt as number)) - x.spawnedAt)}{alive && <span className={d.muted}>+</span>}</td>
                    <td><b>{x.kills}</b></td>
                    <td className={l.hideSm}>{num(x.damageDealt)} <span className={d.muted}>/ {num(x.damageTaken)}</span></td>
                    <td><LifeEnd life={x} online={online} isCurrent={x.spawnedAt === current} /></td>
                    <td><LifeTasks det={det} /></td>
                    <td className={`${l.hideSm} ${d.muted}`}>{dateTime(x.spawnedAt)}</td>
                    <td><div className={s.rowActs}>
                      {det && <Restore det={det} onRestore={() => restore(det)} />}
                      {/* Bản đồ is still the panel before React: the path opens there. */}
                      {recent.has(x.spawnedAt) && <a className={s.softLink} href={`/#map/path/${encodeURIComponent(id)}/${x.spawnedAt}`}>Đường đi</a>}
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          <Pager total={filtered.length} page={shown.page} limit={LIMIT} unit="đời dino" onPage={setPage} />
        </CardBody>
      </Card>
    </>
  );
}

export function LifeEnd({ life, online, isCurrent }: { life: Life; online: boolean; isCurrent: boolean }) {
  if (life.end === 'garage') return <Chip tone="gar">cất vào gara</Chip>;
  if (life.end === 'admin') return <Chip tone="kill">admin xoá</Chip>;
  if (life.end === 'rebirth') return <Chip tone="gar">chuyển sinh</Chip>;
  if (life.end === 'death' && life.killer) {
    return <><span className={s.kill}>bị <PlayerLink id={life.killer} name={life.killerName} /> giết</span><div className={s.sp}>{dinoName(life.killerSpecies)}</div></>;
  }
  if (life.end === 'death') return <Chip tone="kill">chết · không rõ</Chip>;
  if (life.endedAt === null && isCurrent) return online ? <Chip tone="accent"><span className={s.dot} />đang chơi</Chip> : <Chip tone="neutral">còn sống · offline</Chip>;
  return <Chip tone="neutral">không rõ</Chip>;
}

/** "6/10 · 👑", the prime tasks a life had done when last read. */
function LifeTasks({ det }: { det: LifeDetail | undefined }) {
  if (!det?.prime) return <span className={d.muted}>–</span>;
  const p = det.prime;
  return <><span className={d.mono} title={`Nhiệm vụ ${p.code}${p.elderStacks ? ` · elder ${p.elderStacks}` : ''}`}>{p.done}/10</span>
    {p.prime ? <> <Chip tone="grow" title="Prime">👑 prime</Chip></> : p.eligible ? <> <Chip tone="neutral">đủ ĐK</Chip></> : null}</>;
}

/** A dead (or admin-removed) dino: a button that puts it back in the garage as it was. */
function Restore({ det, onRestore }: { det: LifeDetail; onRestore: () => void }) {
  if (det.restoredTo) return <span className={`${d.muted} ${s.nowrap}`} title="Đã khôi phục">↩ {det.restoredTo}</span>;
  if (det.end !== 'death' && det.end !== 'admin') return null;
  if (!det.classPath || det.growth === null) return null;
  return <Button variant="soft" small onClick={onRestore}>Khôi phục vào gara</Button>;
}
