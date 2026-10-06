import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson, type FeatureMode, type SvipView } from '@isle/api';
import { Button, Card, CardBody, CardHead, Dialog, Field, Hint, Mono, Segmented, Table, TextInput, useToast } from '@isle/ui';
import { useSession } from '../../../app/session';
import { PlayerLink } from '../../../components/PlayerLink';
import { dateTime } from '../../../lib/time';
import styles from './Svip.module.css';

const URL = '/api/svip';
const TONE = { admin: 'neutral', testing: 'warn', all: 'good' } as const;
const WHAT: Record<FeatureMode, string> = {
  admin: 'Chỉ admin dùng được. Người chơi khác, kể cả SVip, không thấy chức năng này.',
  testing: 'Admin và SVip dùng được. Người chơi khác thấy chức năng nhưng bị khoá ("SVip dùng trước").',
  all: 'Mọi người chơi dùng được ngay.',
};
export const isSteamId = (s: string): boolean => /^7656\d{13}$/.test(s);

/** Thành viên → SVip: who uses features early, and each feature's release level. Every change saves at once (bridge/src/svip.ts). */
export function SvipPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { withToken } = useSession();
  const q = useQuery({ queryKey: [URL], queryFn: () => getJson<SvipView>(URL), refetchInterval: 15_000 });
  const [id, setId] = useState('');
  const [note, setNote] = useState('');
  const [ask, setAsk] = useState<{ key: string; label: string; mode: FeatureMode } | null>(null);
  const [busy, setBusy] = useState(false);
  const d = q.data;
  if (q.error && !d) return <Hint>Không tải được SVip: {(q.error as Error).message}</Hint>;
  if (!d) return <Hint>Đang tải…</Hint>;

  const save = async (players: SvipView['players'], features: SvipView['features'], label: string): Promise<boolean> => {
    setBusy(true);
    try {
      return await withToken(label, async (token) => {
        const saved = await adminFetch<SvipView>(URL, 'PUT', token, {
          players: players.map((p) => ({ steamId: p.steamId, note: p.note ?? '' })),
          features: Object.fromEntries(features.map((f) => [f.key, f.mode])),
        });
        qc.setQueryData([URL], saved);
        toast('Đã lưu SVip.');
      });
    } finally { setBusy(false); }
  };
  const add = (): void => {
    const sid = id.trim();
    if (!isSteamId(sid)) { toast('SteamID: 17 chữ số, bắt đầu bằng 7656…', 'err'); return; }
    if (d.players.some((p) => p.steamId === sid)) { toast('Người này đã là SVip', 'err'); return; }
    void save([...d.players, { steamId: sid, note: note.trim(), addedAt: 0, by: null, name: null }], d.features, 'thêm SVip')
      .then((ok) => { if (ok) { setId(''); setNote(''); } });
  };
  const level = ask ? d.modes.find((m) => m.key === ask.mode) : undefined;

  return (
    <div className={styles.page}>
      <Card>
        <CardHead title="SVip" sub="dùng trước các chức năng ở mức SVip (cùng admin), có hiệu lực ngay" />
        <CardBody stack>
          <form className={styles.add} onSubmit={(e) => { e.preventDefault(); add(); }}>
            <div className={styles.id}><Field label="SteamID" htmlFor="sv-id">
              <TextInput id="sv-id" inputMode="numeric" maxLength={17} placeholder="7656119…" autoComplete="off" style={{ fontFamily: 'var(--font-mono)' }}
                value={id} onChange={(e) => setId(e.target.value)} />
            </Field></div>
            <div className={styles.note}><Field label="Ghi chú (không bắt buộc)" htmlFor="sv-note">
              <TextInput id="sv-note" maxLength={80} placeholder="vd. tester túi đồ" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field></div>
            <Button type="submit" disabled={busy}>Thêm SVip</Button>
          </form>
          {d.players.length === 0 ? <Hint>Chưa có SVip nào.</Hint> : (
            <Table cards>
              <thead><tr><th>Người chơi</th><th>SteamID</th><th>Ghi chú</th><th>Thêm lúc</th><th /></tr></thead>
              <tbody>
                {d.players.map((p) => (
                  <tr key={p.steamId}>
                    <td data-label="Người chơi">{p.name ? <PlayerLink steamId={p.steamId} name={p.name} /> : <span className={styles.muted}>chưa vào game</span>}</td>
                    <td data-label="SteamID"><Mono>{p.steamId}</Mono></td>
                    <td data-label="Ghi chú">{p.note}</td>
                    <td data-label="Thêm lúc" className={styles.muted}>{p.addedAt ? dateTime(p.addedAt) : ''}{p.by ? ` · ${p.by}` : ''}</td>
                    <td className={styles.end}><Button variant="ghost" small className={styles.del} disabled={busy}
                      onClick={() => void save(d.players.filter((x) => x.steamId !== p.steamId), d.features, 'bỏ SVip')}>Bỏ</Button></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Mức phát hành chức năng" sub="Chỉ admin: người khác không thấy · SVip: người khác thấy nhưng khoá · Công khai: mọi người" />
        <CardBody>
          <div className={styles.features}>
            {d.features.map((f) => (
              <div key={f.key} className={styles.feature}>
                <span>{f.label}</span>
                <Segmented label={`Mức phát hành: ${f.label}`} value={f.mode} disabled={busy}
                  options={d.modes.map((m) => ({ value: m.key, label: m.label, note: m.note, tone: TONE[m.key] }))}
                  onChange={(mode) => setAsk({ key: f.key, label: f.label, mode })} />
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Dialog open={ask !== null} title={ask && level ? `"${ask.label}": ${level.label} (${level.note})?` : ''}
        okLabel={ask?.mode === 'all' ? 'Phát hành' : `Chuyển sang ${level?.label ?? ''}`} busy={busy}
        onClose={() => setAsk(null)}
        onOk={() => {
          if (!ask) return;
          void save(d.players, d.features.map((x) => (x.key === ask.key ? { ...x, mode: ask.mode } : x)), `mức phát hành: ${level?.label ?? ask.mode}`)
            .then(() => setAsk(null));
        }}>
        {ask ? WHAT[ask.mode] : null}
      </Dialog>
    </div>
  );
}
