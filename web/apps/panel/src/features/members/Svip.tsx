import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson, type SvipData } from '@isle/api';
import { Button, Card, CardBody, CardHead, Hint, TextInput, useToast } from '@isle/ui';
import { PlayerLink } from '../../components/dino/Identity';
import { dateTime } from '../../lib/format';
import { useConfirm } from '../../app/confirm';
import { useSession } from '../../app/session';
import t from '../../components/table/Table.module.css';
import s from './Members.module.css';

const LEVELS: NonNullable<SvipData['modes']> = [
  { key: 'admin', label: 'Chỉ admin', note: 'Đang phát triển' },
  { key: 'testing', label: 'SVip', note: 'Ưu tiên dùng trước' },
  { key: 'all', label: 'Công khai', note: 'Đã phát hành' },
];
const LEVEL_WHAT: Record<string, string> = {
  admin: 'Chỉ admin dùng được. Người chơi khác, kể cả SVip, không thấy chức năng này.',
  testing: 'Admin và SVip dùng được. Người chơi khác thấy chức năng nhưng bị khoá ("SVip dùng trước").',
  all: 'Mọi người chơi dùng được ngay.',
};

/** Thành viên → SVip: who tries the features being tested, and each feature's release level. */
export function Svip() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { withToken } = useSession();
  const q = useQuery({ queryKey: ['/api/svip'], queryFn: () => getJson<SvipData>('/api/svip'), refetchInterval: 15_000 });
  const d = q.data;
  const [id, setId] = useState('');
  const [note, setNote] = useState('');
  const body = (players: SvipData['players'], features: SvipData['features']) => ({
    players: players.map((p) => ({ steamId: p.steamId, note: p.note ?? '' })), features: Object.fromEntries(features.map((f) => [f.key, f.mode])),
  });
  const save = (players: SvipData['players'], features: SvipData['features'], label: string): Promise<boolean> => withToken(label, async (token) => {
    const saved = await adminFetch<SvipData>('/api/svip', 'PUT', token, body(players, features));
    qc.setQueryData(['/api/svip'], saved);
    toast('Đã lưu SVip.');
  });
  const add = async (): Promise<void> => {
    if (!d) return;
    const v = id.trim();
    if (!/^7656\d{13}$/.test(v)) { toast('SteamID: 17 chữ số, bắt đầu bằng 7656…', 'err'); return; }
    if (d.players.some((p) => p.steamId === v)) { toast('Người này đã là SVip', 'err'); return; }
    if (await save([...d.players, { steamId: v, note: note.trim(), addedAt: 0, by: null }], d.features, 'thêm SVip')) { setId(''); setNote(''); }
  };
  const level = (f: SvipData['features'][number], m: NonNullable<SvipData['modes']>[number]): void => {
    if (!d || f.mode === m.key) return;
    confirm({
      title: `"${f.label}": ${m.label} (${m.note})?`, body: LEVEL_WHAT[m.key] ?? '', danger: false,
      okLabel: m.key === 'all' ? 'Phát hành' : `Chuyển sang ${m.label}`,
      run: async (token) => {
        const saved = await adminFetch<SvipData>('/api/svip', 'PUT', token, body(d.players, d.features.map((x) => (x.key === f.key ? { ...x, mode: m.key } : x))));
        qc.setQueryData(['/api/svip'], saved);
        toast('Đã lưu SVip.');
      },
    });
  };
  return (
    <>
      <Card>
        <CardHead title="SVip" sub="dùng trước các chức năng ở mức SVip (cùng admin), có hiệu lực ngay" />
        <CardBody stack>
          <form className={s.addRow} onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <div className={s.addField}><label htmlFor="sv-id" className={s.label}>SteamID</label>
              <TextInput id="sv-id" inputMode="numeric" maxLength={17} placeholder="7656119…" className={t.mono} autoComplete="off" value={id} onChange={(e) => setId(e.target.value)} /></div>
            <div className={`${s.addField} ${s.note}`}><label htmlFor="sv-note" className={s.label}>Ghi chú (không bắt buộc)</label>
              <TextInput id="sv-note" maxLength={80} placeholder="vd. tester túi đồ" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <Button type="submit">Thêm SVip</Button>
          </form>
          {!d ? <Hint>Đang tải…</Hint> : d.players.length === 0 ? <Hint>Chưa có SVip nào.</Hint> : (
            <div className={t.wrap}><table className={t.table}>
              <thead><tr><th>Người chơi</th><th>SteamID</th><th>Ghi chú</th><th>Thêm lúc</th><th /></tr></thead>
              <tbody>{d.players.map((p) => (
                <tr key={p.steamId}>
                  <td>{p.name ? <PlayerLink id={p.steamId} name={p.name} /> : <span className={t.muted}>chưa vào game</span>}</td>
                  <td className={t.mono}>{p.steamId}</td><td>{p.note}</td>
                  <td className={t.muted}>{p.addedAt ? dateTime(p.addedAt) : ''}{p.by ? ` · ${p.by}` : ''}</td>
                  <td className={t.right}><Button variant="ghost" small className={t.del}
                    onClick={() => void save(d.players.filter((x) => x.steamId !== p.steamId), d.features, 'bỏ SVip')}>Bỏ</Button></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </CardBody>
      </Card>
      <Card style={{ marginTop: 16 }}>
        <CardHead title="Mức phát hành chức năng" sub="Chỉ admin: người khác không thấy · SVip: người khác thấy nhưng khoá · Công khai: mọi người" />
        <CardBody className={s.features}>
          {d?.features.map((f) => (
            <div key={f.key} className={s.route}><span>{f.label}</span>
              <div className={s.lvl} role="group" aria-label="Mức phát hành">
                {(d.modes ?? LEVELS).map((m) => (
                  <button key={m.key} type="button" data-level={m.key} className={f.mode === m.key ? s.on : undefined} aria-pressed={f.mode === m.key} onClick={() => level(f, m)}>
                    {m.label}<small>{m.note}</small></button>
                ))}
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
    </>
  );
}
