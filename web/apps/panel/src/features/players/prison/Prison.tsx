import { useRef, useState, type MutableRefObject } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson, type MessagesSettings, type PlayerRow } from '@isle/api';
import { Button, Card, CardBody, CardHead, Field, NumberInput, Select, Switch, TextArea, TextInput, useToast } from '@isle/ui';
import { useConfirm } from '../../../app/confirm';
import { Avatar, PlayerLink } from '../../../components/dino/Identity';
import t from '../../../components/table/Table.module.css';
import { dateTime, dinoName } from '../../../lib/format';
import { prDur } from '../../../lib/players';
import { ago } from '../../../lib/time';
import { FreshBar } from '../../settings-form/FreshBar';
import { useSettingsForm } from '../../settings-form/useSettingsForm';
import { isSteamId } from '../bans/Bans';
import b from '../bans/Bans.module.css';
import r from '../leaderboard/Leaderboard.module.css';
import s from './Prison.module.css';

/** bridge/src/prison.ts: the settings, a sentence as view() gives it, a past one, a hunter. */
export interface Offense { id: string; name: string; minutes: number }
export interface PrisonSettings {
  enabled: boolean; killPenaltyMin: number; remindMin: number; repeatStep: number;
  stingGraceSec: number; stingEverySec: number; stingPct: number; caughtMode: 'teleport' | 'respawn'; catchPct: number; offenses: Offense[];
}
export interface ActiveSentence {
  id: string; steamId: string; name: string; offense: string; reason: string; multiplier: number; minutes: number; totalSec: number; prior: number;
  by: string; at: number; release?: boolean; log?: Array<{ t: number; text: string }>;
  remainingSec: number; escaped: boolean; escapes: number; inside: boolean; online: boolean; jailed: boolean;
}
interface PastSentence { id: string; steamId: string; name: string; offense: string; reason: string; totalSec: number; by: string; endedAt: number; outcome: 'served' | 'released'; escapes: number }
export interface PrisonView {
  settings: PrisonSettings;
  zone: { id: string; name: string; enabled: boolean; drops: number } | null;
  modState: { t: number | null };
  active: ActiveSentence[];
  history: PastSentence[];
  priors: Record<string, number>;
  hunters: Array<{ steamId: string; name: string; count: number; last: number }>;
}
const URL = '/api/prison';

/** The repeat multiplier: × (1 + step × earlier sentences), two decimals. */
export const multiplierOf = (step: number, prior: number): number => Math.round((1 + step * prior) * 100) / 100;

/** What the sentence's row says of where the inmate is. */
export function stateOf(x: Pick<ActiveSentence, 'release' | 'escaped' | 'online' | 'jailed' | 'inside'>): { text: string; tone: 'alert' | 'muted' | 'plain' } {
  if (x.release) return { text: '🔓 chờ thả (khi online)', tone: 'plain' };
  if (x.escaped) return { text: '🚨 đang trốn', tone: 'alert' };
  if (!x.online) return { text: 'offline · dừng đếm', tone: 'muted' };
  if (!x.jailed) return { text: 'chưa vào tù', tone: 'muted' };
  if (x.inside) return { text: '🔒 trong tù', tone: 'plain' };
  return { text: '-', tone: 'muted' };
}

/** Người chơi → Nhà tù (bridge/src/prison.ts, mods/Prison): jail, the settings, who is inside, the history, the hunters. */
export function Prison() {
  const d = useQuery({ queryKey: [URL], queryFn: () => getJson<PrisonView>(URL), refetchInterval: 2000 }).data;
  const z = d?.zone;
  return (
    <>
      {d && (
        <div className={s.zone}>
          {!z ? <>⚠ Chưa có vùng nhà tù: vào <a href="#map">Bản đồ</a>, chọn (hoặc tạo) một vùng, tick <b>🔒 Nhà tù</b> rồi lưu các vùng.</>
            : !z.enabled ? <>⚠ Vùng nhà tù “{z.name}” đang tắt (bật lại ở <a href="#map">Bản đồ</a>).</>
              : z.drops === 0 ? <>⚠ Vùng “{z.name}” chưa có điểm thả: cần một người chơi hoặc AI đi qua vùng này (điểm mặt đất cập nhật 10 phút/lần).</>
                : !d.settings.enabled ? <><b className={b.warn}>⚠ Nhà tù đang TẮT, không ai bị đưa vào tù.</b> Tick "Bật nhà tù" ở Cài đặt nhà tù bên phải rồi bấm Lưu. (Vùng: {z.name}, {z.drops} điểm thả.)</>
                  : <>Nhà tù: <b>{z.name}</b> · {z.drops} điểm thả · đang <b>bật</b> · mod {d.modState.t ? `báo ${ago(d.modState.t)}` : 'chưa báo (mod nạp ở lần khởi động lại server kế tiếp)'}.</>}
        </div>
      )}
      <div className={b.grid}>
        <JailForm d={d} />
        <PrisonSettingsCard />
      </div>
      <Inmates d={d} />
      <div className={`${b.grid} ${b.list}`}>
        <Card>
          <CardHead title="Lịch sử" sub="200 án gần nhất" />
          <CardBody>
            <div className={t.wrap}><table className={t.table}>
              <thead><tr><th>Người chơi</th><th>Lỗi / lý do</th><th>Án</th><th>Kết thúc</th><th>Trốn</th></tr></thead>
              <tbody>
                {(d?.history ?? []).length === 0 && <tr><td colSpan={5} className={t.muted}>Chưa có.</td></tr>}
                {(d?.history ?? []).map((h) => (
                  <tr key={`${h.id}-${h.endedAt}`}>
                    <td><PlayerLink id={h.steamId} name={h.name} /></td>
                    <td><b>{h.offense}</b><div className={t.muted}>{h.reason}</div></td>
                    <td>{prDur(h.totalSec)}<div className={s.small}>bởi {h.by}</div></td>
                    <td>{h.outcome === 'released' ? 'thả sớm' : 'mãn hạn'}<div className={s.small}>{dateTime(h.endedAt)}</div></td>
                    <td>{h.escapes || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </CardBody>
        </Card>
        <Card>
          <CardHead title="🏹 Thợ săn" sub="hạ kẻ vượt ngục, trao thưởng tay nếu muốn" />
          <CardBody>
            <ul className={r.rankList}>
              {(d?.hunters ?? []).length === 0 && <li className={r.empty}>Chưa ai hạ kẻ vượt ngục.</li>}
              {(d?.hunters ?? []).map((h, i) => (
                <li key={h.steamId}>
                  <span className={`${r.rank}${i < 3 ? ` ${r[`r${i + 1}`]}` : ''}`}>{i + 1}</span>
                  <Avatar id={h.steamId} name={h.name} size="sm" />
                  <div className={r.who}><div className={r.nm}><PlayerLink id={h.steamId} name={h.name} /></div><div className={r.sp}>lần cuối {ago(h.last)}</div></div>
                  <div className={r.score}>{h.count}</div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

/** Bỏ tù: the player, the offense (its minutes × the repeat multiplier unless typed), the reason, the announce. */
function JailForm({ d }: { d: PrisonView | undefined }) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const players = useQuery({ queryKey: ['/api/players'], queryFn: () => getJson<{ players: PlayerRow[] }>('/api/players'), refetchInterval: 5000 }).data?.players ?? [];
  const msgs = useQuery({ queryKey: ['/api/messages'], queryFn: () => getJson<MessagesSettings>('/api/messages'), staleTime: 60_000 }).data;
  const online = players.filter((p) => p.online);
  // null: the first one online / the first offense (as the old selects opened); '': typed in / "Khác".
  const [who, setWho] = useState<string | null>(null);
  const [offId, setOffId] = useState<string | null>(null);
  const [steam, setSteam] = useState('');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  // The minutes the admin typed; null = the suggested ones.
  const [typed, setTyped] = useState<number | null>(null);
  const lastAuto = useRef(30);

  const picked = who === null ? online[0] : online.find((p) => p.steamId === who);
  const steamId = picked === undefined ? steam.trim() : picked.steamId;
  const shownName = picked === undefined ? name.trim() : picked.name ?? '';
  const offenses = d?.settings.offenses ?? [];
  const off = (offId === null ? offenses[0] : offenses.find((o) => o.id === offId)) ?? null;
  const prior = d?.priors[steamId] ?? 0;
  const mult = multiplierOf(d?.settings.repeatStep ?? 0, prior);
  if (off) lastAuto.current = Math.max(1, Math.round(off.minutes * mult));
  const minutes = typed ?? lastAuto.current;
  const inside = d?.active.find((x) => x.steamId === steamId);
  const why = reason.trim();
  const tpl = msgs ? msgs.texts['prison.jailed.announce'] ?? msgs.catalog.find((c) => c.key === 'prison.jailed.announce')?.default ?? null : null;
  const vars: Record<string, string> = {
    name: shownName || steamId || 'Rex', duration: prDur(minutes * 60), reason: why || off?.name || '(chưa ghi lý do)',
    offense: off?.name ?? 'Khác', prior: String(prior), times: String(prior + 1),
  };

  const go = (): void => {
    if (!d?.settings.enabled) { toast('Nhà tù đang tắt: tick "Bật nhà tù" ở Cài đặt nhà tù và bấm Lưu trước.', 'err'); return; }
    if (!d.zone?.enabled) { toast('Chưa có vùng nhà tù: tick "🔒 Nhà tù" cho một vùng trên Bản đồ và lưu.', 'err'); return; }
    if (!isSteamId(steamId)) { toast('Chọn người chơi hoặc nhập SteamID64 đúng.', 'err'); return; }
    if (!(minutes >= 1)) { toast('Số phút phải từ 1 trở lên.', 'err'); return; }
    if (!off && !why) { toast('Lỗi "Khác" cần ghi lý do.', 'err'); return; }
    const label = shownName || steamId;
    confirm({
      title: `Bỏ tù ${label}?`, okLabel: 'Bỏ tù',
      body: <>
        <p style={{ margin: '0 0 8px' }}>Bỏ tù <b>{label}</b> <span className={t.mono}>{steamId}</span>, <b>{prDur(minutes * 60)}</b>.</p>
        <p style={{ margin: '0 0 8px' }}>{off?.name ?? 'Khác'}{why ? `: ${why}` : ''}</p>
        <p style={{ margin: 0 }} className={t.muted}>Án chỉ trừ khi người chơi online và ở trong nhà tù. Đổi án / thả sớm ở danh sách bên dưới.</p>
      </>,
      run: async (token) => {
        await adminFetch('/api/prison/jail', 'POST', token, { steamId, name: shownName, offenseId: off?.id ?? null, minutes, reason: why });
        toast(`Đã bỏ tù ${label}.`);
        setReason('');
        setTyped(null);
        void qc.invalidateQueries({ queryKey: [URL] });
      },
    });
  };

  const playerOptions = [...online.map((p) => ({ value: p.steamId, label: `${p.name ?? p.steamId} · ${dinoName(p.species ?? '')} (online)` })), { value: '', label: 'Nhập SteamID khác…' }];
  const offenseOptions = [...offenses.map((o) => ({ value: o.id, label: `${o.name}, ${o.minutes} phút` })), { value: '', label: 'Khác (tự nhập phút)' }];
  return (
    <Card>
      <CardHead title="Bỏ tù người chơi" sub="án gắn SteamID · trừ khi online và ở trong tù" />
      <CardBody stack>
        <Field label="Người chơi" htmlFor="pr-player"><Select id="pr-player" value={picked?.steamId ?? ''} options={playerOptions} onChange={(v) => { setWho(v); setTyped(null); }} /></Field>
        {picked === undefined && (
          <div className={b.row}>
            <TextInput aria-label="SteamID64" placeholder="SteamID64 (7656119…)" inputMode="numeric" maxLength={17} value={steam} onChange={(e) => setSteam(e.target.value)} />
            <TextInput aria-label="Tên" placeholder="Tên (không bắt buộc)" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <Field label="Lỗi vi phạm" htmlFor="pr-offense"><Select id="pr-offense" value={off?.id ?? ''} options={offenseOptions} onChange={(v) => { setOffId(v); setTyped(null); }} /></Field>
        <Field label="Thời gian (phút)" htmlFor="pr-minutes">
          <NumberInput id="pr-minutes" value={minutes} min={1} max={100000} onChange={setTyped} />
          <div className={b.hint}>{inside ? <b className={b.warn}>Người này đang ở tù, dùng "Đổi án" ở danh sách bên dưới.</b>
            : off ? `${off.minutes} phút × ${mult} (tiền án: ${prior})${typed !== null ? ', đã sửa tay' : ''}` : `Tiền án: ${prior}. Nhập số phút.`}</div>
        </Field>
        <Field label="Lý do" htmlFor="pr-reason">
          <TextArea id="pr-reason" rows={2} maxLength={200} placeholder="Ghi lý do (người chơi và cả server sẽ thấy). Trống = tên lỗi." value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {tpl !== null && (
          <div className={b.preview}>
            {tpl === '' ? <span className={t.muted}>Thông báo toàn server khi bỏ tù đang tắt.</span>
              : <><span className={t.muted}>Cả server sẽ thấy:</span><br />{String(tpl).replace(/\{(\w+)\}/g, (all, k: string) => vars[k] ?? all)}</>}
          </div>
        )}
        <div><Button variant="dangerSolid" onClick={go}>Bỏ tù</Button></div>
        <div className={b.hint}>Người chơi được đưa vào tù khi đang có dino (offline thì lần vào sau). Trong tù: không lớn, không đói / khát,
          không mất máu, nhiệm vụ prime đứng yên; không dùng được !slay, !unstuck, gara; Ptera không gắp được. Ra khỏi vùng tù là
          {' '}<b>vượt ngục</b>: cả server được báo, vị trí hiện trên bản đồ của mọi người, ai hạ được thành "Thợ săn".
          Nội dung tin sửa ở <a href="#mods/messages">Tính năng mod → Thông báo → Nhà tù</a>.</div>
      </CardBody>
    </Card>
  );
}

const CAUGHT = [
  { value: 'teleport', label: 'Không chết, tụt tới ngưỡng máu thì bay về nhà tù' },
  { value: 'respawn', label: 'Chết, spawn lại đúng loài thì tạo lại chính con đó trong tù' },
];
/** The settings as the PUT takes them: offenses without a name dropped, a new one without an id. */
export const prisonBody = (st: PrisonSettings): PrisonSettings => ({
  ...st,
  offenses: st.offenses.map((o) => ({ ...(o.id ? { id: o.id } : {}), name: o.name.trim(), minutes: Math.round(o.minutes) }) as Offense).filter((o) => o.name !== ''),
});

function PrisonSettingsCard() {
  const f = useSettingsForm<PrisonView, PrisonSettings>(URL, {
    label: 'Cài đặt nhà tù', href: '#players/prison', select: (v) => v.settings, toBody: prisonBody, putUrl: '/api/prison/settings', saved: 'Đã lưu cài đặt nhà tù.',
  });
  const st = f.draft;
  const num = (key: 'killPenaltyMin' | 'remindMin' | 'repeatStep' | 'stingGraceSec' | 'stingEverySec' | 'stingPct' | 'catchPct', label: string, min: number, max: number, step = 1) => (
    <Field label={label} htmlFor={`prs-${key}`}><NumberInput id={`prs-${key}`} value={st![key]} min={min} max={max} step={step} onChange={(v) => f.set(key, v)} /></Field>
  );
  const setOff = (i: number, p: Partial<Offense>): void => f.update((x) => ({ ...x, offenses: x.offenses.map((o, j) => (j === i ? { ...o, ...p } : o)) }));
  return (
    <Card>
      <CardHead title="Cài đặt nhà tù" sub={'vùng tù: tick "🔒 Nhà tù" ở một vùng trên Bản đồ'} />
      <CardBody stack>
        {f.error ? <span className={t.muted}>Không tải được cài đặt: {f.error.message}</span> : st === null ? <span className={t.muted}>Đang tải…</span> : <>
          <Switch id="prs-enabled" checked={st.enabled} onChange={(v) => f.set('enabled', v)} label="Bật nhà tù" />
          {num('killPenaltyMin', 'Giết bạn tù trong tù: cộng án (phút)', 0, 10000)}
          {num('remindMin', 'Nhắc vượt ngục mỗi (phút, 0 = chỉ báo 1 lần)', 0, 600)}
          {num('repeatStep', 'Tái phạm: án × (1 + hệ số × số tiền án)', 0, 10, 0.1)}
          <div className={s.three}>
            {num('stingGraceSec', 'Người ngoài vào: chờ (giây)', 0, 600)}
            {num('stingEverySec', 'Ong đốt mỗi (giây)', 1, 60)}
            {num('stingPct', '% máu mỗi lần', 1, 100)}
          </div>
          <Field label="Kẻ vượt ngục bị hạ" htmlFor="prs-caught">
            <Select id="prs-caught" value={st.caughtMode ?? 'teleport'} options={CAUGHT} onChange={(v) => f.set('caughtMode', v as PrisonSettings['caughtMode'])} />
            <div className={b.hint}>Bị một đòn chết ngay (cả ở chế độ đầu): coi như đã chết, con spawn lại đúng loài được tạo lại y nguyên trong tù,
              loài khác thì con mới vào tù tiếp tục án. Ai đánh hạ / bắt được đều được ghi công Thợ săn.</div>
          </Field>
          {(st.caughtMode ?? 'teleport') === 'teleport' && num('catchPct', 'Ngưỡng máu để bắt (%)', 1, 90)}
          <Field label="Danh mục lỗi (tên · phút)">
            <div className={b.stack}>
              {st.offenses.map((o, i) => (
                <div key={i} className={s.off}>
                  <TextInput aria-label="Tên lỗi" placeholder="Tên lỗi" maxLength={60} value={o.name} onChange={(e) => setOff(i, { name: e.target.value })} />
                  <NumberInput aria-label="phút" value={o.minutes} min={1} max={100000} onChange={(v) => setOff(i, { minutes: v })} /><span className={t.muted}>phút</span>
                  <Button variant="soft" small aria-label="Xoá" title="Xoá" onClick={() => f.update((x) => ({ ...x, offenses: x.offenses.filter((_, j) => j !== i) }))}>✕</Button>
                </div>
              ))}
              <div><Button variant="soft" small onClick={() => f.update((x) => ({ ...x, offenses: [...x.offenses, { id: '', name: '', minutes: 30 }] }))}>+ Thêm lỗi</Button></div>
            </div>
          </Field>
          <div><Button variant="soft" onClick={() => void f.save()} disabled={f.saving}>{f.saving ? 'Đang lưu…' : 'Lưu cài đặt nhà tù'}</Button></div>
        </>}
      </CardBody>
      <FreshBar show={f.serverChanged} dirty={f.dirty} onReload={f.reload} />
    </Card>
  );
}

/** Đang ở tù: each sentence, change it (+/- minutes) or let them out. */
function Inmates({ d }: { d: PrisonView | undefined }) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const reload = (): void => { void qc.invalidateQueries({ queryKey: [URL] }); };
  const release = (x: ActiveSentence): void => confirm({
    title: `Thả ${x.name}?`, okLabel: 'Thả', danger: false,
    body: <>
      <p style={{ margin: '0 0 8px' }}>Thả sớm <b>{x.name}</b> (còn {prDur(x.remainingSec)}).</p>
      <p style={{ margin: 0 }} className={t.muted}>Đang online thì ra ngay và được đưa về chỗ bị bắt; offline thì ra ở lần vào sau.</p>
    </>,
    run: async (token) => { await adminFetch(`/api/prison/sentence/${x.id}/release`, 'POST', token, {}); toast(`${x.name} sẽ được thả.`); reload(); },
  });
  const extend = (x: ActiveSentence): void => {
    const box = { current: 10 };
    confirm({
      title: `Đổi án ${x.name}`, okLabel: 'Đổi án', danger: false,
      body: <ExtendBody x={x} box={box} />,
      run: async (token) => {
        const minutes = Math.round(box.current || 0);
        if (minutes === 0) throw new Error('Số phút phải khác 0');
        await adminFetch(`/api/prison/sentence/${x.id}/extend`, 'POST', token, { minutes });
        toast(`Đã đổi án ${x.name}: ${minutes > 0 ? '+' : ''}${minutes} phút.`);
        reload();
      },
    });
  };
  const active = d?.active ?? [];
  return (
    <Card className={b.list}>
      <CardHead title="Đang ở tù" sub={d ? `${active.length} người` : ''} />
      <CardBody>
        <div className={t.wrap}><table className={t.table}>
          <thead><tr><th>Người chơi</th><th>Lỗi / lý do</th><th>Còn lại</th><th>Trạng thái</th><th>Trốn</th><th>Bỏ tù bởi</th><th /></tr></thead>
          <tbody>
            {active.length === 0 && <tr><td colSpan={7} className={t.muted}>Không có ai ở tù.</td></tr>}
            {active.map((x) => {
              const st = stateOf(x);
              return (
                <tr key={x.id}>
                  <td><PlayerLink id={x.steamId} name={x.name} /><div className={`${t.mono} ${s.small}`}>{x.steamId}</div></td>
                  <td><b>{x.offense}</b><div className={t.muted}>{x.reason}</div>{x.prior > 0 && <div className={s.small}>tiền án {x.prior} · ×{x.multiplier}</div>}</td>
                  <td><b>{prDur(x.remainingSec)}</b><div className={s.small}>/ {prDur(x.totalSec)}</div>
                    {(x.log?.length ?? 0) > 0 && <div className={s.small}>{x.log!.map((l) => l.text).join(' · ')}</div>}</td>
                  <td>{st.tone === 'alert' ? <b className={b.warn}>{st.text}</b> : st.tone === 'muted' ? <span className={t.muted}>{st.text}</span> : st.text}</td>
                  <td>{x.escapes || 0}</td>
                  <td>{x.by}<div className={s.small}>{dateTime(x.at)}</div></td>
                  <td className={b.nowrap}>
                    <Button variant="soft" small onClick={() => extend(x)}>Đổi án</Button>
                    {!x.release && <>{' '}<Button variant="soft" small onClick={() => release(x)}>Thả</Button></>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </CardBody>
    </Card>
  );
}

function ExtendBody({ x, box }: { x: ActiveSentence; box: MutableRefObject<number> }) {
  const [v, setV] = useState(box.current);
  return (
    <>
      <p style={{ margin: '0 0 10px' }}><b>{x.name}</b>, còn {prDur(x.remainingSec)} / {prDur(x.totalSec)}.</p>
      <Field label="Cộng thêm (phút, số âm để giảm)" htmlFor="pr-x-min">
        <NumberInput id="pr-x-min" value={v} min={-100000} max={100000} onChange={(n) => { box.current = n; setV(n); }} />
      </Field>
    </>
  );
}
