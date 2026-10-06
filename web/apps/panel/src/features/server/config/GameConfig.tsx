import { useRef, useState } from 'react';
import { adminFetch, type GameConfig as Config, type GameKeySpec } from '@isle/api';
import { Button, Card, CardBody, CheckGrid, Checkbox, Field, FieldGrid, Hint, NumberInput, SectionTitle, Select, TextInput, useToast } from '@isle/ui';
import { useConfirm } from '../../../app/confirm';
import { useHashRoute } from '../../../app/router';
import { useSession } from '../../../app/session';
import { dinoName } from '../../../lib/format';
import { useMutationData } from '../../mutations/useMutationData';
import { FreshBar } from '../../settings-form/FreshBar';
import { useSettingsForm } from '../../settings-form/useSettingsForm';
import { CountdownPick } from '../ops/CountdownPick';
import { NAME, defaultText, dirtyGroups, draftOf, keysOf, settingsOf, type CfgDraft } from './form';
import s from './GameConfig.module.css';

const URL = '/api/game-config';
let lastGroup: string | null = null;

/**
 * Server → Cấu hình game: the Game.ini keys the panel owns, a group at a time (#server/cfg:<group>),
 * ONE form for every group: edits in several groups survive switching and are saved together.
 */
export function GameConfig() {
  const toast = useToast();
  const confirm = useConfirm();
  const { withToken } = useSession();
  const route = useHashRoute();
  // The schema the body is built with (the GET's), read when saving.
  const cfgRef = useRef<Config | undefined>(undefined);
  const form = useSettingsForm<Config, CfgDraft>(URL, {
    label: 'Cấu hình game', href: '#server/cfg', select: draftOf, saved: 'Đã lưu cấu hình, có hiệu lực từ lần khởi động sau.',
    toBody: (d: CfgDraft): unknown => ({ settings: settingsOf(cfgRef.current ?? { schema: {} }, d) }),
  });
  const cfg: Config | undefined = form.latest;
  cfgRef.current = cfg;
  const countdown = useRef(300);
  const [playables, setPlayables] = useState<string[]>([]);
  const catalog = useMutationData().catalog;

  if (form.error) return <Hint>Không tải được cấu hình: {form.error.message}</Hint>;
  const d = form.draft;
  if (!cfg || !d) return <Hint>Đang tải…</Hint>;
  const groups = Object.entries(cfg.groups).filter(([g]) => keysOf(cfg, g).length > 0);
  const asked = route.sub?.startsWith('cfg:') ? route.sub.slice(4) : '';
  const group = groups.some(([g]) => g === asked) ? asked : groups.some(([g]) => g === lastGroup) ? lastGroup! : groups[0]?.[0] ?? '';
  lastGroup = group;
  const dirty = form.base ? dirtyGroups(cfg, form.base, d) : new Set<string>();
  const setValue = (k: string, v: unknown): void => form.update((x) => ({ ...x, values: { ...x.values, [k]: v } }));
  const keys = keysOf(cfg, group);
  const known = new Set(cfg.knownPlayables);

  const saveRestart = (): void => {
    countdown.current = 300;
    confirm({
      title: 'Lưu và khởi động lại?', danger: true, withReason: true, okLabel: 'Lưu & khởi động lại',
      body: <>Cấu hình được ghi vào Game.ini rồi server khởi động lại để áp dụng.<CountdownPick pick={countdown} id="cfg-cd" /></>,
      run: async (_token, reason) => {
        const ok = await form.save({ extra: { restart: { countdownSeconds: countdown.current, reason } }, saved: 'Đã lưu, server sẽ khởi động lại.' });
        if (!ok) throw new Error('chưa lưu được');
      },
    });
  };
  const loadPlayables = (): void => void withToken('tải danh sách loài', async (token) => {
    const r = await adminFetch<{ response?: string }>('/api/rcon/getPlayables', 'POST', token, {});
    const list = String(r.response ?? '').split(/[\s,]+/).map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_]+$/.test(x));
    setPlayables(list);
    toast(`Đã tải ${list.length} loài.`);
  });

  const field = (k: string) => {
    const spec = cfg.schema[k]!;
    const v = d.values[k];
    const id = `cfg-f-${k}`;
    const badge = spec.verified === false
      ? <span className={s.unverified} title="Game đọc key này theo tên (có trong file game) nhưng chưa đọc ngược được giá trị để kiểm chứng">chưa xác minh</span> : null;
    const help = [spec.help, defaultText(spec)].filter(Boolean).join(' · ');
    if (spec.type === 'list') {
      const selected = v as string[];
      const options = k === 'AllowedClasses'
        ? [...new Set([...cfg.knownPlayables, ...playables, ...catalog.map((c) => dinoName(c.species)), ...selected])].filter((n) => NAME.test(n)).sort()
        : [...new Set([...(spec.suggest ?? []), ...selected])].sort();
      return (
        <div key={k} className={s.wide} data-field={k}>
          <div className={s.listLabel}>{spec.label} <span className={s.key}>{k}</span>{badge}</div>
          {options.length === 0 ? <span className={s.muted}>Chưa có mục nào.</span> : (
            <CheckGrid>
              {options.map((n) => {
                const odd = k === 'AllowedClasses' && !known.has(n);
                return <Checkbox key={n} checked={selected.includes(n)} label={<span title={odd ? 'Không có trong danh sách loài server chấp nhận, kiểm tra lại tên' : undefined}>{n}{odd && <span className={s.kill}> ?</span>}</span>}
                  onChange={(on) => setValue(k, on ? [...selected, n] : selected.filter((x) => x !== n))} />;
              })}
            </CheckGrid>
          )}
          {k === 'AllowedClasses'
            ? <div style={{ marginTop: 8 }}><Button variant="ghost" small onClick={loadPlayables}>Tải danh sách loài từ server (RCON)</Button></div>
            : <TextInput className={s.extra} aria-label={`Thêm vào ${spec.label}`} placeholder="thêm tên khác, cách nhau bằng dấu phẩy" value={d.extra[k] ?? ''}
              onChange={(e) => form.update((x) => ({ ...x, extra: { ...x.extra, [k]: e.target.value } }))} />}
          <Hint className={s.hint}>{help}</Hint>
        </div>
      );
    }
    return (
      <Field key={k} label={<>{spec.label}{badge}</>} keyName={k} htmlFor={id} hint={help}>
        <Input id={id} spec={spec} value={v} onChange={(x) => setValue(k, x)} />
      </Field>
    );
  };

  return (
    <>
      <SectionTitle first tone="grow" icon="⚙" title={`Cấu hình game · ${cfg.groups[group] ?? ''}`} sub="ghi vào Game.ini, có hiệu lực từ lần khởi động sau" />
      <nav className={s.groups} aria-label="Nhóm cấu hình game">
        {groups.map(([g, t]) => (
          <a key={g} href={`#server/${encodeURIComponent(`cfg:${g}`)}`} className={g === group ? s.on : ''} aria-current={g === group ? 'page' : undefined}>
            {t}{dirty.has(g) && <span className={s.dot} title="Có thay đổi chưa lưu" />}</a>
        ))}
      </nav>
      <Card><CardBody stack>
        {cfg.pendingRestart && <div className={s.banner}>Cấu hình đã đổi sau lần khởi động gần nhất, cần <b>khởi động lại</b> để có hiệu lực.</div>}
        {cfg.error && <div className={s.warnbox}>{cfg.error}</div>}
        {group === 'ai' && (
          <div className={s.zones}>
            <span>🗺️ <b>Vùng AI</b> (sinh AI theo vùng, giới hạn tổng AI toàn server) chỉnh trên bản đồ: vẽ, kéo, đổi bán kính từng vùng.</span>
            <a href="#map" className={s.zonesLink}>Mở Vùng AI trên bản đồ →</a>
          </div>
        )}
        <FieldGrid>{keys.filter((k) => cfg.schema[k]!.type !== 'list').map(field)}</FieldGrid>
        {keys.filter((k) => cfg.schema[k]!.type === 'list').map(field)}
        <div className={s.actions}>
          <Button onClick={() => void form.save()} disabled={!form.dirty || form.saving}>{form.saving ? 'Đang lưu…' : 'Lưu cấu hình'}</Button>
          <Button variant="soft" onClick={saveRestart} disabled={form.saving}>Lưu &amp; khởi động lại…</Button>
          <Button variant="ghost" onClick={form.reload} disabled={!form.dirty}>Bỏ thay đổi</Button>
        </div>
        <Hint>Nút Lưu ghi <b>mọi nhóm</b> cấu hình cùng lúc (nhóm có chấm cam là nhóm đang có thay đổi chưa lưu). Mật khẩu server, RCON, các cổng, map, EOS
          và danh sách admin vẫn do file <span className={s.mono}>.env</span> quản lý (deploy), sửa sai những mục đó có thể khoá mất panel. Mọi mục trong các nhóm
          do panel quản lý: deploy và mỗi lần server khởi động đều giữ đúng giá trị panel đã lưu. Danh sách key lấy từ chính server (bản 0.21.784).
          Nhãn <span className={s.unverified}>chưa xác minh</span> = game đọc key này theo tên nhưng panel chưa đọc ngược được giá trị để kiểm chứng.</Hint>
      </CardBody></Card>
      <FreshBar show={form.serverChanged} dirty={form.dirty} onReload={form.reload} />
    </>
  );
}

const BOOL = [{ value: 'false', label: 'Tắt' }, { value: 'true', label: 'Bật' }];
const BOOL_AUTO = [{ value: '', label: 'Theo mặc định của game' }, ...BOOL];

/** One key's box: on / off, a number (empty = the game's default for a key not verified), a text. */
function Input({ id, spec, value, onChange }: { id: string; spec: GameKeySpec; value: unknown; onChange: (v: unknown) => void }) {
  if (spec.type === 'bool') {
    return <Select id={id} value={value === null || value === undefined ? '' : String(value)} options={spec.verified === false ? BOOL_AUTO : BOOL}
      onChange={(v) => onChange(v === '' ? null : v === 'true')} />;
  }
  if (spec.type === 'int' || spec.type === 'float') {
    const step = spec.type === 'int' ? 1 : spec.step;
    if (spec.verified === false) return <OptionalNumber id={id} value={value as number | null} min={spec.min} max={spec.max} onChange={onChange} />;
    return <NumberInput id={id} value={Number(value ?? spec.default)} min={spec.min} max={spec.max} step={step} onChange={onChange} />;
  }
  if (spec.type === 'text') {
    return <TextInput id={id} maxLength={spec.maxLen} value={String(value ?? '')} placeholder={spec.default || 'để trống = mặc định'} onChange={(e) => onChange(e.target.value)} />;
  }
  return null;
}

/** A number that may be left empty ("theo mặc định của game"): typed, clamped to min..max when left. */
function OptionalNumber({ id, value, min, max, onChange }: { id: string; value: number | null; min: number; max: number; onChange: (v: number | null) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <TextInput id={id} inputMode="decimal" placeholder="theo mặc định của game" value={text ?? (value === null ? '' : String(value))}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text === null) return;
        const t = text.trim().replace(',', '.');
        const n = Number(t);
        onChange(t === '' || !Number.isFinite(n) ? null : Math.min(max, Math.max(min, n)));
        setText(null);
      }} />
  );
}
