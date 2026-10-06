import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson } from '@isle/api';
import { Button, Card, CardBody, CardHead, Icon, useToast } from '@isle/ui';
import { useConfirm } from '../../../app/confirm';
import { can } from '../../../app/nav';
import { useSession } from '../../../app/session';
import { Avatar, Chip } from '../../../components/dino/Identity';
import { StoredDinoCard, type StoredSlot } from '../../../components/dino/StoredDinoCard';
import { VitalItem } from '../../../components/dino/Vitals';
import d from '../../../components/dino/dino.module.css';
import { Feed } from '../../../components/feed/Feed';
import { KILL_ERRORS, type FeedEvent } from '../../../components/feed/describe';
import { dinoName, num, pct } from '../../../lib/format';
import { ago, dur } from '../../../lib/time';
import { useGarageDelete } from './garage';
import { Lives, type Life } from './Lives';
import { PlayerAdmin, type LivePlayer } from './PlayerAdmin';
import s from './Player.module.css';

/** GET /api/player/<id> (bridge/src/server.ts): the player (null: only a garage), the log, the lives, the garage. */
export interface PlayerDetail {
  steamId: string;
  player: (LivePlayer & {
    name: string | null; lastSeen: number; loc: { x: number; y: number; z: number } | null;
    kills: number; deaths: number; damageDealt: number; damageTaken: number; hits: number; playtime: number; sessions: number; spawns: number;
    longestLife: number; longestLifeSpecies: string | null; longestLifeAlive: boolean; biggestKill: { species: string; growth: number } | null;
    stored: number; redeemed: number; chats: number; prime: { prime?: boolean; eligible?: boolean } | null;
  }) | null;
  timeline: FeedEvent[];
  lives: Life[];
  garage: StoredSlot[];
}

/** The last kill command sent per player (kept across pages, as the panel before React did). */
const pendingKills = new Map<string, { id: number; at: number }>();

/** #player/<SteamID>: who they are, their dino now, admin actions, stats, their log, garage and lives. */
export function PlayerPage({ id }: { id: string }) {
  const url = `/api/player/${encodeURIComponent(id)}`;
  const q = useQuery({ queryKey: [url], queryFn: () => getJson<PlayerDetail>(url), refetchInterval: 2000, retry: false });
  const back = (): void => { if (history.length > 1) history.back(); else location.hash = 'overview'; };
  if (q.isError && q.data === undefined) {
    return (
      <div>
        <button type="button" className={s.back} onClick={back}><Icon name="back" /> Quay lại</button>
        <Card className={s.heroCard}><div className={s.hero}><div><h1>Chưa thấy người chơi này</h1><div className={`${s.sub} ${d.mono}`}>{id}</div></div></div></Card>
      </div>
    );
  }
  const det = q.data;
  return (
    <div>
      <button type="button" className={s.back} onClick={back}><Icon name="back" /> Quay lại</button>
      <Card className={s.heroCard}><Hero id={id} det={det} /></Card>
      <div className={s.split}>
        <div className={s.col}>
          <Current det={det} />
          {det?.player && <PlayerAdminGate p={det.player} />}
          <Card>
            <CardHead title="Thành tích" />
            <CardBody><Stats det={det} /></CardBody>
          </Card>
        </div>
        <Card>
          <CardHead title="Nhật ký" sub="300 sự kiện gần nhất" />
          <CardBody><Feed events={det?.timeline ?? []} /></CardBody>
        </Card>
      </div>
      <Garage id={id} det={det} />
      <Lives id={id} lives={det?.lives ?? []} online={det?.player?.online ?? false} />
    </div>
  );
}

function PlayerAdminGate({ p }: { p: LivePlayer }) {
  const { access } = useSession();
  return can(access, 'players.admin') ? <PlayerAdmin p={p} /> : null;
}

function Hero({ id, det }: { id: string; det: PlayerDetail | undefined }) {
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  const [sent, setSent] = useState(0);
  if (det === undefined) return <div className={s.hero}><Avatar id={id} size="lg" /><div><h1>…</h1><div className={`${s.sub} ${d.mono}`}>{id}</div></div></div>;
  const p = det.player;
  if (p === null) {
    // Known only from the garage: an admin parked a dino for someone who has not joined since the logs began.
    return (
      <div className={s.hero}>
        <Avatar id={id} size="lg" />
        <div style={{ minWidth: 0 }}><h1>Chưa từng thấy online <Chip tone="neutral">chỉ có gara</Chip></h1><div className={s.sub}><span className={d.mono}>{id}</span></div></div>
      </div>
    );
  }
  const canKill = p.online && !!p.species;
  const kill = (): void => confirm({
    title: 'Xoá dino đang chơi?', okLabel: 'Xoá dino', withReason: true,
    body: <>Dino <b>{dinoName(p.species)} {pct(p.growth)}</b> của <b>{p.name ?? p.steamId}</b> sẽ chết ngay
      (như khi cất vào gara) và người chơi phải respawn. <b>Không hoàn tác được.</b> Cái chết này không bị tính vào thống kê.</>,
    run: async (token, reason) => {
      const { command } = await adminFetch<{ command: { id: number } }>(`/api/player/${encodeURIComponent(p.steamId)}/kill`, 'POST', token, { reason });
      pendingKills.set(p.steamId, { id: command.id, at: Date.now() });
      setSent((n) => n + 1);
      toast(`Đã gửi lệnh #${command.id}, chờ server thực hiện (vài giây).`);
      void qc.invalidateQueries({ queryKey: [`/api/player/${encodeURIComponent(id)}`] });
    },
  });
  return (
    <div className={s.hero}>
      <Avatar id={p.steamId} name={p.name} size="lg" />
      <div style={{ minWidth: 0 }}>
        <h1>{p.name ?? 'Không rõ tên'} {p.online ? <Chip tone="accent"><span className={s.dot} />online</Chip> : <Chip tone="neutral">offline</Chip>}</h1>
        <div className={s.sub}>
          <span className={d.mono}>{p.steamId}</span>
          <Chip tone="grow">{dinoName(p.species)} · {pct(p.growth)}</Chip>
          {p.loc && <span>@ {num(p.loc.x)}, {num(p.loc.y)}, {num(p.loc.z)}</span>}
          <span>thấy lần cuối {ago(p.lastSeen)}</span>
        </div>
      </div>
      <div className={s.actions}>
        <Button variant="danger" onClick={kill} disabled={!canKill} title={canKill ? undefined : 'Chỉ xoá được khi người chơi đang online và có dino'}>
          <Icon name="trash" />Xoá dino hiện tại</Button>
        <KillStatus steamId={p.steamId} timeline={det.timeline} sent={sent} />
      </div>
    </div>
  );
}

/** What happened to the last kill command sent for this player. */
export function KillStatus({ steamId, timeline, sent }: { steamId: string; timeline: FeedEvent[]; sent: number }) {
  // Redrawn each second while a command waits (the seconds counted; the data may not change).
  const [, tick] = useState(0);
  const pending = pendingKills.get(steamId);
  const waiting = pending !== undefined && !timeline.some((e) => e.type === 'admin_kill' && e.id === pending.id);
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [waiting, sent]);
  if (!pending) return null;
  const done = timeline.find((e) => e.type === 'admin_kill' && e.id === pending.id);
  if (done) {
    return <div className={s.status}>{done.ok
      ? <Chip tone="accent">lệnh #{done.id}: đã xoá dino</Chip>
      : <Chip tone="kill">lệnh #{done.id} thất bại: {KILL_ERRORS[String(done.error)] ?? String(done.error)}</Chip>}</div>;
  }
  const waited = Math.floor((Date.now() - pending.at) / 1000);
  return <div className={s.status}>{waited < 70 ? <span className={d.muted}>lệnh #{pending.id} đang chờ server… {waited}s</span>
    : <Chip tone="dmg">lệnh #{pending.id} chưa có phản hồi, DinoGarage có đang chạy không?</Chip>}</div>;
}

function Current({ det }: { det: PlayerDetail | undefined }) {
  const p = det?.player ?? null;
  const title = p?.species
    ? `Dino hiện tại · ${dinoName(p.species)}${p.prime?.prime ? ' · 👑 Prime' : p.prime?.eligible ? ' · 👑 Đủ ĐK Prime' : ''}`
    : 'Dino hiện tại';
  const m = p?.max ?? {};
  return (
    <Card>
      <CardHead title={title} sub="snapshot gần nhất" />
      <CardBody>
        <div className={d.vitals}>
          {det === undefined ? <div className={d.empty}>Đang tải…</div>
            : p === null ? <div className={d.empty}>Chưa có snapshot nào</div>
              : !p.species && p.health === null && p.growth === null ? <div className={d.empty} style={{ gridColumn: '1/-1' }}>Người chơi chưa có dino trong game</div>
                : <>
                  <VitalItem label="Máu (HP)" cur={p.health} max={m.health} color="var(--kill)" />
                  <VitalItem label="Thể lực (Stamina)" cur={p.stamina} max={m.stamina} color="var(--dmg)" />
                  <VitalItem label="Dạ dày (Đói)" cur={p.hunger} max={m.hunger} color="var(--accent-2)" />
                  <VitalItem label="Nước (Khát)" cur={p.thirst} max={m.thirst} color="var(--chat)" />
                  <VitalItem label="Oxy" cur={p.oxygen} max={m.oxygen} color="var(--gar)" />
                  <VitalItem label="Huyết (Blood)" cur={p.blood} max={m.blood} color="#b91c1c" />
                  <VitalItem label="Tăng trưởng (Growth)" cur={p.growth} max={1} color="linear-gradient(90deg, var(--grow), var(--chat))" growth />
                </>}
        </div>
      </CardBody>
    </Card>
  );
}

function Stats({ det }: { det: PlayerDetail | undefined }) {
  const p = det?.player ?? null;
  if (!p) return <div className={d.empty}>{det === undefined ? 'Đang tải…' : 'Chưa có dữ liệu'}</div>;
  const tile = (k: string, v: React.ReactNode, tip: string) => <div className={s.tile} title={`${k}: ${tip}`}><div className={s.k} title={k}>{k}</div><div className={s.v}>{v}</div></div>;
  const longest = `${dur(p.longestLife)}${p.longestLifeSpecies ? ` ${dinoName(p.longestLifeSpecies)}${p.longestLifeAlive ? ' · còn sống' : ''}` : ''}`;
  const biggest = p.biggestKill ? `${dinoName(p.biggestKill.species)} ${pct(p.biggestKill.growth)}` : '–';
  return (
    <div className={s.tiles}>
      {tile('Kill', p.kills, String(p.kills))}
      {tile('Chết', p.deaths, String(p.deaths))}
      {tile('K/D', (p.kills / Math.max(1, p.deaths)).toFixed(2), (p.kills / Math.max(1, p.deaths)).toFixed(2))}
      {tile('Gây damage', num(p.damageDealt), num(p.damageDealt))}
      {tile('Chịu damage', num(p.damageTaken), num(p.damageTaken))}
      {tile('Số đòn', p.hits, String(p.hits))}
      {tile('Giờ chơi', dur(p.playtime), dur(p.playtime))}
      {tile('Số phiên', p.sessions, String(p.sessions))}
      {tile('Spawn', p.spawns, String(p.spawns))}
      {tile('Sống lâu nhất', <>{dur(p.longestLife)}{p.longestLifeSpecies && <span className={d.muted}> {dinoName(p.longestLifeSpecies)}{p.longestLifeAlive ? ' · còn sống' : ''}</span>}</>, longest)}
      {tile('Mồi lớn nhất', p.biggestKill ? <>{dinoName(p.biggestKill.species)} <span className={d.muted}>{pct(p.biggestKill.growth)}</span></> : '–', biggest)}
      {tile('Cất / lấy', `${p.stored} / ${p.redeemed}`, `${p.stored} / ${p.redeemed}`)}
      {tile('Tin chat', p.chats, String(p.chats))}
    </div>
  );
}

function Garage({ id, det }: { id: string; det: PlayerDetail | undefined }) {
  const del = useGarageDelete();
  const garage = det?.garage ?? [];
  return (
    <>
      <div className={s.sectionTitle}>
        <span className={`${s.secIco} ${s.gar}`}><Icon name="garage" /></span>
        <h2>Dino trong gara</h2>
        <span className={s.secSub}>{garage.length === 0 ? 'trống' : `${garage.length} dino`} · <a className={s.create} href={`#garage/${id}`}>+ tạo dino cho người này</a></span>
      </div>
      <div className={s.dinoGrid}>
        {det !== undefined && garage.length === 0 && <Card><div className={d.empty}>Người chơi này chưa cất dino nào</div></Card>}
        {garage.map((g) => <StoredDinoCard key={g.slot} {...g} onDelete={() => del(id, g.slot, dinoName(String(g.state?.['classPath'] ?? g.meta.classPath)))} />)}
      </div>
    </>
  );
}
