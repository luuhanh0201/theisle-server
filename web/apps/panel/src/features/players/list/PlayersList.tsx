import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getJson, type PlayerRow } from '@isle/api';
import { Card, CardBody, CardHead } from '@isle/ui';
import { Avatar, Chip } from '../../../components/dino/Identity';
import { ListTools, Pager, Pill, Seg, SortTh, pageOf, type SortDir } from '../../../components/list/List';
import l from '../../../components/list/List.module.css';
import { dinoName, num, shortId } from '../../../lib/format';
import { copyText, lastSeenText, pingTone, prDur } from '../../../lib/players';
import { dur } from '../../../lib/time';
import { firstDir, viewOf, type Status } from './sort';
import s from './PlayersList.module.css';

const LIMIT = 20;

/** Người chơi → Danh sách: everyone seen, searchable, filtered, sorted, 20 a page; a row opens the player's page. */
export function PlayersList() {
  const q = useQuery({ queryKey: ['/api/players'], queryFn: () => getJson<{ players: PlayerRow[]; garageMax: number }>('/api/players'), refetchInterval: 2000 });
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [sort, setSort] = useState<{ col: string | null; dir: SortDir }>({ col: null, dir: 'desc' });
  const [page, setPage] = useState(1);
  const [copied, setCopied] = useState<string | null>(null);
  const all = q.data?.players ?? [];
  const rows = viewOf(all, text, status, sort.col, sort.dir);
  const shown = pageOf(rows, page, LIMIT);
  const onSort = (col: string): void => { setSort((x) => (x.col === col ? { col, dir: x.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: firstDir(col) })); setPage(1); };
  const th = (col: string, label: string, title: string, cls?: string) => <SortTh col={col} sort={sort} onSort={onSort} title={title} className={cls}>{label}</SortTh>;

  return (
    <>
      <details className={l.notice}>
        <summary><span aria-hidden="true" style={{ color: 'var(--dmg)' }}>⚠</span> Giới hạn của game, số liệu nào có thể thiếu</summary>
        <p>Chỉ đếm được damage do người chơi đánh trực tiếp người chơi. Ngã, chết đuối, chảy máu và damage
          từ AI không sinh hook nào trong game nên <b>không thể ghi nhận</b>.</p>
        <p>Chết, spawn, phiên chơi và mốc growth được suy ra từ trạng thái giữa hai lần chụp (mỗi 5 giây),
          nên có thể trễ tới 5s và đôi khi không quy được ai là người giết.</p>
      </details>
      <Card>
        <CardHead title="Người chơi" sub={`${all.filter((p) => p.online).length} online / tổng ${all.length}`}><Pill>{rows.length} người chơi</Pill></CardHead>
        <CardBody>
          <ListTools q={text} onQ={(v) => { setText(v); setPage(1); }} placeholder="Tìm theo tên, SteamID hoặc loài dino…">
            <Seg label="Lọc trạng thái" value={status} onChange={(v) => { setStatus(v); setPage(1); }}
              options={[['all', 'Tất cả'], ['online', 'Đang online'], ['offline', 'Offline']]} />
          </ListTools>
          <div className={l.wrap}>
            <table className={l.table}>
              <thead><tr>
                {th('player', 'Người chơi', 'Bấm để sắp xếp theo Người chơi')}
                {th('steamId', 'SteamID', 'Bấm để sắp xếp theo SteamID')}
                {th('ping', 'Ping', 'Bấm để sắp xếp theo Ping (server đo, cập nhật mỗi 5 giây)')}
                {th('garage', 'Gara', 'Bấm để sắp xếp theo số dino trong gara / số slot tối đa')}
                {th('kd', 'K / D', 'Bấm để sắp xếp theo tỉ lệ K / D')}
                {th('damage', 'Damage', 'Bấm để sắp xếp theo Damage', l.hideSm)}
                {th('playtime', 'Giờ chơi', 'Bấm để sắp xếp theo Giờ chơi', l.hideSm)}
                {th('lastSeen', 'Online gần nhất', 'Bấm để sắp xếp theo thời gian Online gần nhất')}
              </tr></thead>
              <tbody>
                {shown.rows.length === 0 && <tr><td colSpan={8} className={l.empty}>{q.isLoading ? 'Đang tải…' : text ? 'Không tìm thấy người chơi nào phù hợp' : 'Chưa có người chơi nào'}</td></tr>}
                {shown.rows.map((p) => (
                  <tr key={p.steamId} className={l.rowLink} onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) location.hash = `player/${p.steamId}`; }}>
                    <td><div className={s.who}><Avatar id={p.steamId} name={p.name} />
                      <div className={s.meta}>
                        <div className={s.nm}><a href={`#player/${p.steamId}`} className={s.name}>{p.name ?? shortId(p.steamId)}</a>
                          {p.online && <Chip tone="accent"><span className={s.d} />online</Chip>}
                          {p.prison && <Chip tone="kill" title={`Đang ở tù: ${p.prison.offense}, còn ${prDur(p.prison.remainingSec)}`}>{p.prison.escaped ? '🚨 trốn' : '🔒 Tù'}</Chip>}</div>
                        <div className={s.sp}>{dinoName(p.species)}</div>
                      </div></div></td>
                    <td><span className={s.steam}>{p.steamId}</span>
                      <button type="button" className={s.copy} title="Sao chép SteamID" aria-label={`Sao chép SteamID ${p.steamId}`}
                        onClick={() => { copyText(p.steamId); setCopied(p.steamId); setTimeout(() => setCopied(null), 1200); }}>{copied === p.steamId ? '✓' : '📋'}</button></td>
                    <td>{p.online && typeof p.ping === 'number' ? <Chip tone={pingTone(p.ping)}>{Math.round(p.ping)} ms</Chip> : <span className={l.muted}>-</span>}</td>
                    <td className={p.garage ? '' : l.muted}>{p.garage ?? 0}/{p.garageMax === null ? '∞' : p.garageMax ?? q.data?.garageMax ?? 2}</td>
                    <td><b>{p.kills ?? 0}</b> <span className={l.muted}>/ {p.deaths ?? 0}</span></td>
                    <td className={l.hideSm}>{num(p.damageDealt)}</td>
                    <td className={`${l.hideSm} ${l.muted}`}>{dur(p.playtime)}</td>
                    <td>{p.online ? <Chip tone="accent"><span className={s.d} />online</Chip>
                      : lastSeenText(p.lastSeen) ? <span className={s.seen} title={new Date((p.lastSeen as number) * 1000).toLocaleString('vi-VN')}>{lastSeenText(p.lastSeen)}</span>
                        : <span className={l.muted}>-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager total={rows.length} page={shown.page} limit={LIMIT} unit="người chơi" onPage={setPage} />
        </CardBody>
      </Card>
    </>
  );
}
