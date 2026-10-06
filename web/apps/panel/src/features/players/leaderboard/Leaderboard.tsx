import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getJson } from '@isle/api';
import { Card, CardBody, CardHead, Icon, type IconName } from '@isle/ui';
import { Avatar, PlayerLink } from '../../../components/dino/Identity';
import { Pager, Pill, pageOf } from '../../../components/list/List';
import l from '../../../components/list/List.module.css';
import { dateTime, dinoName, num, pct } from '../../../lib/format';
import { dur } from '../../../lib/time';
import s from './Leaderboard.module.css';

type Row = { steamId: string; name: string | null; species: string | null; [k: string]: any };
interface Boards { kills: Row[]; kd: Row[]; damage: Row[]; playtime: Row[]; longestLife: Row[]; biggestPrey?: Row[] }
const LIMIT = 20;

/** Người chơi → Xếp hạng: five boards (bridge/src/store.ts leaderboard) and the biggest prey per species. */
export function Leaderboard() {
  const b = useQuery({ queryKey: ['/api/leaderboard'], queryFn: () => getJson<Boards>('/api/leaderboard'), refetchInterval: 2000 }).data;
  const [page, setPage] = useState(1);
  const prey = b?.biggestPrey ?? [];
  const shown = pageOf(prey, page, LIMIT);
  return (
    <>
      <div className={s.boards}>
        <Board title="Nhiều kill nhất" icon="death" tone="tone-kill" rows={b?.kills} value={(p) => p.kills} />
        <Board title="K/D (≥ 3 kill)" icon="killfeed" tone="tone-accent" rows={b?.kd} value={(p) => <>{Number(p.kd).toFixed(2)}<small>{p.kills} / {p.deaths}</small></>} />
        <Board title="Gây damage" icon="damage" tone="tone-dmg" rows={b?.damage} value={(p) => num(p.damageDealt)} />
        <Board title="Giờ chơi" icon="in" tone="tone-chat" rows={b?.playtime} value={(p) => dur(p.playtime)} />
        <Board title="Sống lâu nhất" icon="growth" tone="tone-grow" rows={b?.longestLife}
          value={(p) => <>{dur(p.longestLife)}<small>{p.longestLifeSpecies ? dinoName(p.longestLifeSpecies) : ''}{p.longestLifeAlive ? ' · còn sống' : ''}</small></>} />
      </div>
      <Card className={s.prey}>
        <CardHead title="Con mồi lớn nhất theo loài" sub="kỷ lục săn mồi theo từng loài dino"><Pill>{prey.length} loài</Pill></CardHead>
        <CardBody>
          <div className={l.wrap}><table className={l.table}>
            <thead><tr><th>Loài</th><th>Growth</th><th>Người giết</th><th className={l.hideSm}>Bằng</th><th className={l.hideSm}>Nạn nhân</th><th className={l.hideSm}>Lúc</th></tr></thead>
            <tbody>
              {shown.rows.length === 0 && <tr><td colSpan={6} className={l.empty}>Chưa có kill nào được quy cho người chơi</td></tr>}
              {shown.rows.map((k, i) => (
                <tr key={`${k.species}-${i}`}>
                  <td><b>{dinoName(k.species)}</b></td><td><Meter value={k.growth} /></td>
                  <td><PlayerLink id={k.killer} name={k.killerName} /></td><td className={`${l.hideSm} ${l.muted}`}>{dinoName(k.killerSpecies)}</td>
                  <td className={l.hideSm}><PlayerLink id={k.victim} name={k.victimName} /></td><td className={`${l.hideSm} ${l.muted}`}>{dateTime(k.t)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <Pager total={prey.length} page={shown.page} limit={LIMIT} unit="loài" onPage={setPage} />
        </CardBody>
      </Card>
    </>
  );
}

function Board({ title, icon, tone, rows, value }: { title: string; icon: string; tone: string; rows: Row[] | undefined; value: (p: Row) => ReactNode }) {
  return (
    <Card>
      <CardHead title={<span className={s.title}><span className={`${s.ico} ${s[tone]}`}><Icon name={icon as IconName} /></span>{title}</span>} />
      <CardBody>
        <ul className={s.rankList}>
          {(rows ?? []).length === 0 && <li className={s.empty}>{rows ? 'Chưa có dữ liệu' : 'Đang tải…'}</li>}
          {(rows ?? []).map((p, i) => (
            <li key={p.steamId}>
              <span className={`${s.rank}${i < 3 ? ` ${s[`r${i + 1}`]}` : ''}`}>{i + 1}</span>
              <Avatar id={p.steamId} name={p.name} size="sm" />
              <div className={s.who}><div className={s.nm}><PlayerLink id={p.steamId} name={p.name} /></div><div className={s.sp}>{dinoName(p.species)}</div></div>
              <div className={s.score}>{value(p)}</div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/** A growth bar with its percentage (the panel's .meter, kind "grow"). */
export function Meter({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className={l.muted}>-</span>;
  const w = Math.max(0, Math.min(100, value * 100));
  return <div className={s.meter}><div className={s.track}><div className={s.fill} style={{ width: `${w}%` }} /></div><span className={s.n}>{pct(value)}</span></div>;
}
