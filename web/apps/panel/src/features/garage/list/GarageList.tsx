import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson, type GarageIndex, type PlayerRow } from '@isle/api';
import { Button, Card, CardBody, CardHead, Icon, useToast } from '@isle/ui';
import { Avatar, Chip, PlayerLink } from '../../../components/dino/Identity';
import { Meter } from '../../../components/dino/Vitals';
import { dateTime, dinoName, pct } from '../../../lib/format';
import { ago } from '../../../lib/time';
import { useConfirm } from '../../../app/confirm';
import s from './GarageList.module.css';
import d from '../../../components/dino/dino.module.css';

interface Row { steamId: string; slot: string; m: GarageIndex['players'][string][string] }

/** Gara → Dino đang cất: every stored slot (the index), searchable, deletable (into deleted/ on the server). */
export function GarageList() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const index = useQuery({ queryKey: ['/api/garage'], queryFn: () => getJson<GarageIndex>('/api/garage'), refetchInterval: 2000 });
  const players = useQuery({ queryKey: ['/api/players'], queryFn: () => getJson<{ players: PlayerRow[] }>('/api/players'), refetchInterval: 5000 });
  const [q, setQ] = useState('');
  const names = useMemo(() => new Map((players.data?.players ?? []).map((p) => [p.steamId, p.name])), [players.data]);
  const rows: Row[] = useMemo(() => Object.entries(index.data?.players ?? {})
    .flatMap(([steamId, slots]) => Object.entries(slots ?? {}).map(([slot, m]) => ({ steamId, slot, m }))), [index.data]);
  const owners = new Set(rows.map((r) => r.steamId)).size;
  const summary = `${rows.length} slot · ${owners} người chơi`;
  const want = q.trim().toLowerCase();
  const shown = want ? rows.filter((r) => r.steamId.includes(want) || r.slot.toLowerCase().includes(want)
    || dinoName(r.m.classPath).toLowerCase().includes(want) || (names.get(r.steamId) ?? '').toLowerCase().includes(want)) : rows;

  const del = (r: Row): void => confirm({
    title: 'Xoá dino khỏi gara?',
    body: <>Xoá <b>{dinoName(r.m.classPath)}</b> ở slot <span className={d.mono}>{r.slot}</span> của <span className={d.mono}>{r.steamId}</span>.
      File được chuyển vào thư mục <span className={d.mono}>deleted/</span> trên server, nên vẫn khôi phục được nếu xoá nhầm.</>,
    okLabel: 'Xoá khỏi gara',
    run: async (token) => {
      await adminFetch(`/api/garage/${encodeURIComponent(r.steamId)}/${encodeURIComponent(r.slot)}`, 'DELETE', token);
      toast(`Đã xoá ${dinoName(r.m.classPath)} (slot ${r.slot}) khỏi gara.`);
      await qc.invalidateQueries({ queryKey: ['/api/garage'] });
    },
  });

  return (
    <Card className={s.card}>
      <CardHead title="Dino đang cất trong gara" sub={summary}>
        <a href="#garage/stored" onClick={(e) => { e.preventDefault(); document.getElementById('creator-card')?.scrollIntoView({ behavior: 'smooth' }); }} className={s.toCreator}>
          <Button small><Icon name="plus" /> Tạo dino vào gara</Button>
        </a>
      </CardHead>
      <CardBody>
        <div className={s.toolbar}>
          <div className={s.searchWrap}>
            <Icon name="search" />
            <input type="search" className={s.search} placeholder="Tìm theo tên người chơi, SteamID hoặc loài dino…" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm trong gara" />
          </div>
          <span className={s.pill}>{summary}</span>
        </div>
        {index.isPending ? <div className={d.empty}>Đang tải…</div>
          : rows.length === 0 ? <div className={d.empty}>Gara đang trống - chưa có người chơi nào cất dino</div>
            : shown.length === 0 ? <div className={d.empty}>Không tìm thấy dino nào phù hợp với từ khoá "{q}"</div>
              : (
                <div className={s.grid}>
                  {shown.map((r) => (
                    <div key={`${r.steamId}/${r.slot}`} className={s.slot}>
                      <div className={s.top}>
                        <div className={s.tags}><Chip tone="gar"><b>Slot: {r.slot}</b></Chip>{r.m.isPrime && <Chip tone="accent" title="Prime Elder">👑 Prime</Chip>}</div>
                        <span className={s.right}>
                          <span className={d.muted} style={{ fontSize: '11.5px' }} title={r.m.capturedAt ? dateTime(r.m.capturedAt) : ''}>{r.m.capturedAt ? ago(r.m.capturedAt) : ''}</span>
                          <button type="button" className={d.iconBtn} title="Xoá khỏi gara" onClick={() => del(r)}><Icon name="trash" /></button>
                        </span>
                      </div>
                      <div>
                        <div className={s.speciesRow}><div className={s.species}>{dinoName(r.m.classPath)}</div><span className={s.growth}>{pct(r.m.growth ?? 1)}</span></div>
                        <div className={s.meter}><Meter value={r.m.growth ?? null} max={1} kind="grow" /></div>
                      </div>
                      <div className={`${s.owner} ${d.who}`}>
                        <Avatar id={r.steamId} name={names.get(r.steamId)} size="sm" />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}><PlayerLink id={r.steamId} name={names.get(r.steamId)} /></div>
                          <div className={`${d.mono} ${d.muted}`} style={{ fontSize: 11, marginTop: 1 }}>{r.steamId}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
      </CardBody>
    </Card>
  );
}
