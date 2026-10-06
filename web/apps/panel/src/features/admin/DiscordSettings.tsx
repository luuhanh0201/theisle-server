import { useState } from 'react';
import { adminFetch, getJson, type DiscordData } from '@isle/api';
import { Button, Card, CardBody, CardHead, Field, Hint, SectionTitle, Select, Switch, TextInput, useToast } from '@isle/ui';
import { dateTime } from '../../lib/format';
import { useSession } from '../../app/session';
import { FreshBar } from '../settings-form/FreshBar';
import { useSettingsForm } from '../settings-form/useSettingsForm';
import s from './Admin.module.css';

interface Draft {
  enabled: boolean;
  routes: Record<string, string>;
  mentions: Record<string, string>;
  channels: Array<{ id: string; name: string; hint: string; url: string }>;
  relay: { url: string; secret: string; hasSecret: boolean };
  board: string | null;
}
const newId = (): string => Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, '') || `c${Date.now().toString(36)}`;

/** A secret text box (shown as dots) with its eye; `onReveal` when shown empty (the saved URL fetched to look at). */
function Secret({ id, value, placeholder, onChange, onReveal, label }: {
  id?: string; value: string; placeholder?: string; onChange: (v: string) => void; onReveal?: () => void; label: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <span className={s.urlWrap}>
      <TextInput id={id} className={shown ? undefined : s.masked} value={value} placeholder={placeholder} aria-label={label} autoComplete="off" spellCheck={false}
        data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" onChange={(e) => onChange(e.target.value.trim())} />
      <button type="button" className={`${s.eye}${shown ? ` ${s.eyeOn}` : ''}`} title="Hiện / ẩn" aria-label="Hiện / ẩn"
        onClick={() => { if (!shown && value === '') onReveal?.(); setShown(!shown); }}>👁</button>
    </span>
  );
}

/** Quản trị → Discord: the log by webhook, its channels, which log goes where (and tags), the relay outside the VPS. */
export function DiscordSettings() {
  const toast = useToast();
  const { withToken } = useSession();
  const form = useSettingsForm<DiscordData, Draft>('/api/discord', {
    label: 'Discord', href: '#admin/discord', saved: 'Đã lưu Discord.',
    select: (d) => ({ enabled: d.enabled, routes: { ...d.routes }, mentions: { ...(d.mentions ?? {}) }, channels: d.channels.map((c) => ({ id: c.id, name: c.name, hint: c.hint, url: '' })),
      relay: { url: d.relay?.url ?? '', secret: '', hasSecret: d.relay?.hasSecret === true }, board: d.board ?? null }),
    toBody: (d) => ({ enabled: d.enabled, routes: d.routes, mentions: Object.fromEntries(Object.entries(d.mentions).filter(([, v]) => v !== 'role')),
      channels: d.channels.map((c) => ({ id: c.id, name: c.name, ...(c.url ? { url: c.url } : {}) })),
      relay: d.relay.url ? { url: d.relay.url, ...(d.relay.secret ? { secret: d.relay.secret } : {}) } : null, board: d.board ?? null }),
  });
  const d = form.draft;
  const live = form.latest;
  const st = live?.status;
  const [appId, setAppId] = useState('');
  const [botToken, setBotToken] = useState('');
  if (form.error) return <Hint>Không tải được: {form.error.message}</Hint>;
  if (!d || !live || !st) return <Hint>Đang tải…</Hint>;
  const channelOpts = [{ value: '', label: 'không gửi' }, ...d.channels.map((c) => ({ value: c.id, label: c.name || '(chưa đặt tên)' }))];
  const byDiscord: Record<string, string[]> = {};
  for (const [id, cs] of Object.entries(st.channels)) { const ch = cs.webhook?.channelId; if (ch) (byDiscord[ch] ??= []).push(id); }
  const nameOf = (id: string): string => d.channels.find((c) => c.id === id)?.name || id;
  const setCh = (id: string, patch: Partial<Draft['channels'][number]>): void => form.update((x) => ({ ...x, channels: x.channels.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const rs = st.relay ?? { lastOkAt: null, lastError: null };
  let group: string | null = null;
  return (
    <>
      <SectionTitle first icon="💬" title="Log lên Discord" sub="gửi bằng webhook, có hiệu lực ngay" />
      <Card><CardBody stack>
        <Switch id="dc-enabled" checked={d.enabled} onChange={(v) => form.set('enabled', v)} label={<b>Bật gửi log lên Discord</b>} />
        <Hint>{!d.enabled ? 'Đang tắt, không gửi gì.' : d.channels.length === 0 ? 'Chưa có kênh nào: thêm webhook ở dưới.'
          : `Đang gửi · ${st.queued} tin đang chờ${st.dropped ? ` · đã bỏ ${st.dropped} tin (hàng chờ đầy)` : ''}.`}</Hint>
      </CardBody></Card>

      <Card className={s.gap}>
        <CardHead title="Kênh Discord" sub="mỗi kênh một webhook">
          <Button variant="soft" small style={{ marginLeft: 'auto' }} onClick={() => form.update((x) => ({ ...x, channels: [...x.channels, { id: newId(), name: '', hint: '', url: '' }] }))}>+ Thêm kênh</Button>
        </CardHead>
        <CardBody>
          <div className={s.channels}>
            {d.channels.length === 0 && <Hint>Chưa có kênh. Bấm <b>+ Thêm kênh</b>.</Hint>}
            {d.channels.map((c) => {
              const cs = st.channels[c.id];
              const wh = cs?.webhook;
              const same = wh?.channelId ? (byDiscord[wh.channelId] ?? []).filter((x) => x !== c.id) : [];
              const text = !cs ? 'chưa lưu' : [
                wh?.error ? `Webhook: ${wh.error}` : wh?.name ? `Webhook trong Discord: “${wh.name}” · kênh …${String(wh.channelId).slice(-4)}` : '',
                same.length ? `trùng kênh Discord với “${same.map(nameOf).join('”, “')}”, tạo webhook mới trong kênh kia` : '',
                cs.lastError ? `Lỗi: ${cs.lastError}` : cs.lastOkAt ? `Gửi được lúc ${dateTime(cs.lastOkAt)}` : 'Chưa gửi gì',
                cs.queued ? `${cs.queued} tin đang chờ` : ''].filter(Boolean).join(' · ');
              return (
                <div key={c.id} className={s.ch}>
                  <TextInput maxLength={40} value={c.name} placeholder="Tên kênh (vd. killfeed)" aria-label="Tên kênh" onChange={(e) => setCh(c.id, { name: e.target.value })} />
                  <Secret label="URL webhook" value={c.url} placeholder={c.hint ? `${c.hint}, dán URL mới để đổi` : 'Dán URL webhook: https://discord.com/api/webhooks/…'}
                    onChange={(v) => setCh(c.id, { url: v })}
                    onReveal={() => { if (live.channels.some((x) => x.id === c.id)) getJson<{ url: string }>(`/api/discord/url?channel=${encodeURIComponent(c.id)}`).then((r) => setCh(c.id, { url: r.url })).catch((err: Error) => toast(err.message, 'err')); }} />
                  <Button variant="soft" small onClick={() => {
                    if (form.dirty) { toast('Lưu trước rồi mới thử (kênh này chưa lưu).', 'err'); return; }
                    void withToken('thử kênh Discord', async (token) => { await adminFetch('/api/discord/test', 'POST', token, { channel: c.id }); toast('Đã gửi tin thử, xem trong kênh Discord.'); });
                  }}>Thử</Button>
                  <Button variant="ghost" small style={{ color: 'var(--kill)' }} onClick={() => form.update((x) => ({
                    ...x, channels: x.channels.filter((y) => y.id !== c.id), board: x.board === c.id ? null : x.board,
                    routes: Object.fromEntries(Object.entries(x.routes).filter(([, v]) => v !== c.id)),
                  }))}>Xoá</Button>
                  <div className={`${s.st}${cs?.lastError || wh?.error || same.length ? ` ${s.stErr}` : ''}`}>{text}</div>
                </div>
              );
            })}
          </div>
          <details className={s.howto}><summary>Lấy URL webhook thế nào?</summary>
            <p>Trong Discord: vào <b>đúng kênh muốn nhận log</b>, bấm ⚙ <b>Chỉnh sửa kênh</b> → <b>Tích hợp</b> → <b>Webhook</b> → <b>Webhook mới</b> → đặt tên
              (và ảnh) cho webhook, tin log sẽ hiện bằng tên đó → <b>Sao chép URL webhook</b>, rồi dán vào ô ở trên. Mỗi kênh Discord một webhook
              riêng: dán cùng một URL cho hai kênh thì cả hai đều về một chỗ.
              Mỗi kênh (vd. #killfeed, #chat-log, #admin-log) một webhook. URL là bí mật: panel chỉ lưu trên server, không bao giờ hiện lại đầy đủ.</p>
            <p>Log được xếp hàng trên server: Discord hoặc mạng gặp sự cố (kể cả khi VPS bị DDoS) thì log gửi bù sau, giữ đúng giờ gốc.</p>
          </details>
        </CardBody>
      </Card>

      <Card className={s.gap}>
        <CardHead title="Loại log → kênh · tag">
          <span className={s.allSel}>Tất cả vào <span className={s.sel}><Select aria-label="Tất cả vào kênh" value="" placeholder="Chọn kênh…"
            options={[{ value: '', label: 'Chọn kênh…' }, ...d.channels.map((c) => ({ value: c.id, label: c.name || '(chưa đặt tên)' }))]}
            onChange={(id) => { if (id) form.update((x) => ({ ...x, routes: Object.fromEntries(live.kinds.map((k) => [k.key, id])) })); }} /></span></span>
        </CardHead>
        <CardBody>
          <div className={s.route} style={{ marginBottom: 10 }}><span><b>Bảng trạng thái server</b>, một tin tự sửa mỗi phút: Online, người chơi, lần khởi động lại tới / trước</span>
            <span className={s.sel}><Select aria-label="Kênh của bảng trạng thái" value={d.board ?? ''} options={channelOpts.map((o) => (o.value === '' ? { ...o, label: 'không có bảng' } : o))}
              onChange={(v) => form.set('board', v || null)} /></span></div>
          <div className={s.routes}>
            {live.kinds.map((k) => {
              const head = k.group !== group ? <div key={`g-${k.group}`} className={s.g}>{k.group}</div> : null;
              group = k.group;
              const m = d.mentions[k.key] ?? '';
              const isRole = /^\d+$/.test(m);
              const tag = m === 'everyone' || m === 'here' ? m : isRole || m === 'role' ? 'role' : '';
              return [head, (
                <div key={k.key} className={s.route}>
                  <span>{k.label}</span>
                  <span className={s.sel}><Select aria-label={`Kênh: ${k.label}`} value={d.routes[k.key] ?? ''} options={channelOpts}
                    onChange={(v) => form.update((x) => { const r = { ...x.routes }; if (v) r[k.key] = v; else delete r[k.key]; return { ...x, routes: r }; })} /></span>
                  <span className={s.tag}><Select aria-label={`Tag: ${k.label}`} value={tag} options={[{ value: '', label: 'không tag' }, { value: 'everyone', label: '@everyone' }, { value: 'here', label: '@here' }, { value: 'role', label: 'tag role…' }]}
                    onChange={(v) => form.update((x) => { const mm = { ...x.mentions }; if (v === 'role') mm[k.key] = isRole ? m : 'role'; else if (v) mm[k.key] = v; else delete mm[k.key]; return { ...x, mentions: mm }; })} /></span>
                  {tag === 'role' && <span className={s.role}><TextInput inputMode="numeric" placeholder="ID role" aria-label="ID role" value={isRole ? m : ''}
                    onChange={(e) => form.update((x) => ({ ...x, mentions: { ...x.mentions, [k.key]: /^\d{15,22}$/.test(e.target.value.trim()) ? e.target.value.trim() : 'role' } }))} /></span>}
                </div>
              )];
            })}
          </div>
          <Hint style={{ marginTop: 10 }}>Tag: tin loại đó được gửi riêng kèm <b>@everyone</b> / <b>@here</b> / role. ID role: trong Discord bật
            {' '}<b>Cài đặt người dùng → Nâng cao → Chế độ nhà phát triển</b>, rồi <b>Cài đặt máy chủ → Vai trò</b> → chuột phải role → <b>Sao chép ID</b>.
            Chữ người chơi gõ (chat, tên) không bao giờ tag được ai.</Hint>
        </CardBody>
      </Card>

      <Card className={s.gap}>
        <CardHead title="Trạm ngoài VPS" sub="Cloudflare Worker · báo mất kết nối, lệnh /status /online" />
        <CardBody stack>
          <Hint>Bridge gửi nhịp tim lên trạm mỗi 2 phút. Trạm nằm ngoài VPS: VPS sập / mất mạng / bị DDoS thì trạm tự báo
            {' '}<b>"Mất kết nối"</b> vào kênh của log "Server bật / tắt / lỗi" (không có thì kênh đầu tiên), có lại thì báo <b>"Kết nối lại"</b>;
            lệnh <b>/status</b>, <b>/online</b> trong Discord vẫn trả lời.</Hint>
          <Field label="URL của trạm" htmlFor="dc-relay-url">
            <TextInput id="dc-relay-url" autoComplete="off" spellCheck={false} placeholder="https://theisle-discord-relay.<tên>.workers.dev" value={d.relay.url}
              onChange={(e) => form.update((x) => ({ ...x, relay: { ...x.relay, url: e.target.value.trim() } }))} />
          </Field>
          <Field label="Mã bí mật chung với trạm (BRIDGE_SECRET)" htmlFor="dc-relay-secret">
            <Secret id="dc-relay-secret" label="Mã bí mật" value={d.relay.secret} placeholder={d.relay.hasSecret ? 'đã đặt, dán mã mới để đổi' : 'dán mã bí mật (24+ ký tự)'}
              onChange={(v) => form.update((x) => ({ ...x, relay: { ...x.relay, secret: v } }))} />
          </Field>
          <Hint>{!d.relay.url ? 'Chưa đặt trạm.' : rs.lastError ? <span style={{ color: 'var(--kill)' }}>Lỗi: {rs.lastError}</span>
            : rs.lastOkAt ? `Nhịp tim gửi được lúc ${dateTime(rs.lastOkAt)}.` : 'Chưa gửi nhịp tim nào (gửi mỗi 2 phút sau khi lưu).'}</Hint>
        </CardBody>
      </Card>
      <div className={s.gap}><Button onClick={() => void form.save()} disabled={!form.dirty || form.saving}>{form.saving ? 'Đang lưu…' : 'Lưu Discord'}</Button></div>

      <Card className={s.gap}>
        <CardHead title="Đăng ký lệnh /status /online" sub="làm một lần" />
        <CardBody stack>
          <Hint>Lấy ở <a href="https://discord.com/developers/applications" target="_blank" rel="noopener">Discord Developer Portal</a> → ứng dụng của bạn.
            Bot token chỉ dùng cho lần đăng ký này, <b>không được lưu</b> ở đâu cả.</Hint>
          <div className={s.row}>
            <TextInput inputMode="numeric" placeholder="Application ID" aria-label="Application ID" autoComplete="off" value={appId} onChange={(e) => setAppId(e.target.value)} />
            <span style={{ flex: 2 }}><Secret label="Bot token" value={botToken} placeholder="Bot token" onChange={setBotToken} /></span>
            <Button variant="soft" style={{ flex: 'none' }} onClick={() => void withToken('đăng ký lệnh Discord', async (token) => {
              const r = await adminFetch<{ commands: string[] }>('/api/discord/register-commands', 'POST', token, { appId: appId.trim(), botToken: botToken.trim() });
              setBotToken('');
              toast(`Đã đăng ký ${r.commands.join(', ')}, vài phút sau sẽ hiện trong Discord.`);
            })}>Đăng ký lệnh</Button>
          </div>
        </CardBody>
      </Card>
      <FreshBar show={form.serverChanged} dirty={form.dirty} onReload={form.reload} />
    </>
  );
}
