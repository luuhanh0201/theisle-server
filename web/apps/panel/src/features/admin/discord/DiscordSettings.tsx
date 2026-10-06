import { useState, type ReactNode } from 'react';
import { adminFetch, getJson, type DiscordView } from '@isle/api';
import { Button, Card, CardBody, CardHead, Field, Hint, SectionTitle, Select, Switch, TextInput, useToast } from '@isle/ui';
import { useSession } from '../../../app/session';
import { dateTime } from '../../../lib/time';
import { FreshBar } from '../../settings-form/FreshBar';
import { useSettingsForm } from '../../settings-form/useSettingsForm';
import { bodyOf, draftOf, newId, withoutChannel, type DiscordDraft } from './form';
import styles from './Discord.module.css';

/** A secret's box: shown as dots until the eye is clicked (never the browser's password box, which managers fill). */
function Secret({ value, onChange, placeholder, label, onReveal }: {
  value: string; onChange: (v: string) => void; placeholder: string; label: string; onReveal?: () => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <span className={styles.urlWrap}>
      <TextInput className={`${styles.url}${shown ? '' : ` ${styles.masked}`}`} value={value} placeholder={placeholder} aria-label={label}
        autoComplete="off" spellCheck={false} data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other"
        onChange={(e) => onChange(e.target.value.trim())} />
      <button type="button" className={`${styles.eye}${shown ? ` ${styles.on}` : ''}`} title="Hiện / ẩn" aria-label={`Hiện / ẩn ${label}`}
        onClick={() => { if (!shown) onReveal?.(); setShown(!shown); }}>👁</button>
    </span>
  );
}

/** Quản trị → Discord: the log sent by webhook, its channels, routes and tags, the relay off the VPS (bridge/src/discord.ts). */
export function DiscordSettings() {
  const toast = useToast();
  const { withToken } = useSession();
  const form = useSettingsForm<DiscordDraft, DiscordView>('/api/discord', {
    label: 'Discord', href: '#admin/discord', select: draftOf, toBody: bodyOf, onSaved: () => toast('Đã lưu Discord.'),
  });
  const d = form.draft;
  const data = form.raw;
  if (form.error) return <Hint>Không tải được Discord: {form.error.message}</Hint>;
  if (d === null || data === undefined) return <Hint>Đang tải…</Hint>;
  const st = data.status;
  const opts = (none: string) => [{ value: '', label: none }, ...d.channels.map((c) => ({ value: c.id, label: c.name || '(chưa đặt tên)' }))];
  const setChannel = (id: string, p: Partial<DiscordDraft['channels'][number]>): void =>
    form.update((s) => ({ ...s, channels: s.channels.map((c) => (c.id === id ? { ...c, ...p } : c)) }));

  // Two panel channels on one Discord channel: both lists land in the same place.
  const byDiscordChannel: Record<string, string[]> = {};
  for (const [id, cs] of Object.entries(st.channels)) {
    const ch = cs.webhook?.channelId;
    if (ch) (byDiscordChannel[ch] ??= []).push(id);
  }
  const nameOf = (id: string): string => d.channels.find((c) => c.id === id)?.name || id;
  const channelLine = (id: string): { text: string; err: boolean } => {
    const cs = st.channels[id];
    if (!cs) return { text: 'chưa lưu', err: false };
    const wh = cs.webhook;
    const same = wh?.channelId ? (byDiscordChannel[wh.channelId] ?? []).filter((x) => x !== id) : [];
    return {
      err: Boolean(cs.lastError || wh?.error || same.length),
      text: [
        wh?.error ? `Webhook: ${wh.error}` : wh?.name ? `Webhook trong Discord: "${wh.name}" · kênh …${String(wh.channelId).slice(-4)}` : '',
        same.length ? `trùng kênh Discord với "${same.map(nameOf).join('", "')}", tạo webhook mới trong kênh kia` : '',
        cs.lastError ? `Lỗi: ${cs.lastError}` : cs.lastOkAt ? `Gửi được lúc ${dateTime(cs.lastOkAt)}` : 'Chưa gửi gì',
        cs.queued ? `${cs.queued} tin đang chờ` : '',
      ].filter(Boolean).join(' · '),
    };
  };
  const reveal = (id: string): void => {
    // Nothing typed and the channel saved: the saved URL, to look at (admins only; the bridge logs it).
    if (d.channels.find((c) => c.id === id)?.url || !data.channels.some((c) => c.id === id)) return;
    getJson<{ url: string }>(`/api/discord/url?channel=${encodeURIComponent(id)}`)
      .then((r) => form.update((s) => ({ ...s, channels: s.channels.map((c) => (c.id === id && c.url === '' ? { ...c, url: r.url } : c)) })))
      .catch((err: Error) => toast(err.message, 'err'));
  };
  const test = (id: string): void => {
    if (form.dirty) { toast('Lưu trước rồi mới thử (kênh này chưa lưu).', 'err'); return; }
    void withToken('thử kênh Discord', async (token) => {
      await adminFetch('/api/discord/test', 'POST', token, { channel: id });
      toast('Đã gửi tin thử, xem trong kênh Discord.');
    });
  };
  const rs = st.relay;
  let group: string | null = null;
  return (
    <div className={styles.page}>
      <SectionTitle first icon="💬" title="Log lên Discord" sub="gửi bằng webhook, có hiệu lực ngay" />
      <Card><CardBody stack>
        <Switch id="dc-enabled" checked={d.enabled} onChange={(v) => form.set('enabled', v)} label={<b>Bật gửi log lên Discord</b>} />
        <Hint>{!d.enabled ? 'Đang tắt, không gửi gì.' : d.channels.length === 0 ? 'Chưa có kênh nào: thêm webhook ở dưới.'
          : `Đang gửi · ${st.queued} tin đang chờ${st.dropped ? ` · đã bỏ ${st.dropped} tin (hàng chờ đầy)` : ''}.`}</Hint>
      </CardBody></Card>

      <Card>
        <CardHead title="Kênh Discord" sub="mỗi kênh một webhook">
          <Button variant="soft" small className={styles.right} disabled={d.channels.length >= 10}
            onClick={() => form.update((s) => ({ ...s, channels: [...s.channels, { id: newId(), name: '', hint: '', url: '' }] }))}>+ Thêm kênh</Button>
        </CardHead>
        <CardBody>
          <div className={styles.channels}>
            {d.channels.length === 0 && <Hint>Chưa có kênh. Bấm <b>+ Thêm kênh</b>.</Hint>}
            {d.channels.map((c) => {
              const line = channelLine(c.id);
              return (
                <div key={c.id} className={styles.ch}>
                  <TextInput className={styles.nm} maxLength={40} value={c.name} placeholder="Tên kênh (vd. killfeed)" aria-label="Tên kênh"
                    onChange={(e) => setChannel(c.id, { name: e.target.value })} />
                  <Secret value={c.url} label="URL webhook" onChange={(v) => setChannel(c.id, { url: v })} onReveal={() => reveal(c.id)}
                    placeholder={c.hint ? `${c.hint}, dán URL mới để đổi` : 'Dán URL webhook: https://discord.com/api/webhooks/…'} />
                  <Button variant="soft" small onClick={() => test(c.id)}>Thử</Button>
                  <Button variant="ghost" small className={styles.del} onClick={() => form.update((s) => withoutChannel(s, c.id))}>Xoá</Button>
                  <div className={`${styles.st}${line.err ? ` ${styles.err}` : ''}`}>{line.text}</div>
                </div>
              );
            })}
          </div>
          <details className={styles.howto}>
            <summary>Lấy URL webhook thế nào?</summary>
            <p>Trong Discord: vào <b>đúng kênh muốn nhận log</b>, bấm ⚙ <b>Chỉnh sửa kênh</b> → <b>Tích hợp</b> → <b>Webhook</b> → <b>Webhook mới</b> → đặt tên
              (và ảnh) cho webhook, tin log sẽ hiện bằng tên đó → <b>Sao chép URL webhook</b>, rồi dán vào ô ở trên. Mỗi kênh Discord một webhook
              riêng: dán cùng một URL cho hai kênh thì cả hai đều về một chỗ.
              Mỗi kênh (vd. #killfeed, #chat-log, #admin-log) một webhook. URL là bí mật: panel chỉ lưu trên server, không bao giờ hiện lại đầy đủ.</p>
            <p>Log được xếp hàng trên server: Discord hoặc mạng gặp sự cố (kể cả khi VPS bị DDoS) thì log gửi bù sau, giữ đúng giờ gốc.</p>
          </details>
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Loại log → kênh · tag">
          <span className={styles.all}><Hint>Tất cả vào</Hint>
            <Select aria-label="Gửi mọi loại log vào kênh" value="" options={opts('Chọn kênh…')}
              onChange={(id) => { if (id) form.update((s) => ({ ...s, routes: Object.fromEntries(data.kinds.map((k) => [k.key, id])) })); }} /></span>
        </CardHead>
        <CardBody>
          <div className={`${styles.route} ${styles.board}`}>
            <span><b>Bảng trạng thái server</b>, một tin tự sửa mỗi phút: Online, người chơi, lần khởi động lại tới / trước</span>
            <span className={styles.sel}><Select aria-label="Kênh của bảng trạng thái" value={d.board ?? ''} options={opts('không có bảng')}
              onChange={(v) => form.set('board', v || null)} /></span>
          </div>
          <div className={styles.routes}>
            {data.kinds.map((k) => {
              const head = k.group !== group ? <div className={styles.g}>{k.group}</div> : null;
              group = k.group;
              return (
                <RouteRow key={k.key} head={head} label={k.label} channel={d.routes[k.key] ?? ''} mention={d.mentions[k.key] ?? ''} channels={opts('không gửi')}
                  onChannel={(v) => form.update((s) => {
                    const routes = { ...s.routes };
                    if (v) routes[k.key] = v; else delete routes[k.key];
                    return { ...s, routes };
                  })}
                  onMention={(v) => form.update((s) => {
                    const mentions = { ...s.mentions };
                    if (v) mentions[k.key] = v; else delete mentions[k.key];
                    return { ...s, mentions };
                  })} />
              );
            })}
          </div>
          <Hint className={styles.after}>Tag: tin loại đó được gửi riêng kèm <b>@everyone</b> / <b>@here</b> / role. ID role: trong Discord bật
            {' '}<b>Cài đặt người dùng → Nâng cao → Chế độ nhà phát triển</b>, rồi <b>Cài đặt máy chủ → Vai trò</b> → chuột phải role → <b>Sao chép ID</b>.
            Chữ người chơi gõ (chat, tên) không bao giờ tag được ai.</Hint>
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Trạm ngoài VPS" sub="Cloudflare Worker · báo mất kết nối, lệnh /status /online" />
        <CardBody stack>
          <Hint>Bridge gửi nhịp tim lên trạm mỗi 2 phút. Trạm nằm ngoài VPS: VPS sập / mất mạng / bị DDoS thì trạm tự báo
            {' '}<b>"Mất kết nối"</b> vào kênh của log "Server bật / tắt / lỗi" (không có thì kênh đầu tiên), có lại thì báo <b>"Kết nối lại"</b>;
            lệnh <b>/status</b>, <b>/online</b> trong Discord vẫn trả lời.</Hint>
          <Field label="URL của trạm" htmlFor="dc-relay-url">
            <TextInput id="dc-relay-url" autoComplete="off" spellCheck={false} placeholder="https://theisle-discord-relay.<tên>.workers.dev"
              value={d.relay.url} onChange={(e) => form.update((s) => ({ ...s, relay: { ...s.relay, url: e.target.value.trim() } }))} />
          </Field>
          <Field label="Mã bí mật chung với trạm (BRIDGE_SECRET)">
            <Secret value={d.relay.secret} label="Mã bí mật của trạm" placeholder={d.relay.hasSecret ? 'đã đặt, dán mã mới để đổi' : 'dán mã bí mật (24+ ký tự)'}
              onChange={(v) => form.update((s) => ({ ...s, relay: { ...s.relay, secret: v } }))} />
          </Field>
          <Hint>{!d.relay.url ? 'Chưa đặt trạm.' : rs.lastError ? <span className={styles.errText}>Lỗi: {rs.lastError}</span>
            : rs.lastOkAt ? `Nhịp tim gửi được lúc ${dateTime(rs.lastOkAt)}.` : 'Chưa gửi nhịp tim nào (gửi mỗi 2 phút sau khi lưu).'}</Hint>
        </CardBody>
      </Card>

      <div><Button onClick={() => void form.save()} disabled={!form.dirty || form.saving}>{form.saving ? 'Đang lưu…' : 'Lưu Discord'}</Button></div>

      <RegisterCommands />
      <FreshBar show={form.serverChanged} dirty={form.dirty} onReload={form.reload} />
    </div>
  );
}

const TAGS = [{ value: '', label: 'không tag' }, { value: 'everyone', label: '@everyone' }, { value: 'here', label: '@here' }, { value: 'role', label: 'tag role…' }] as const;

/** One kind of log: its channel, and who it tags (a role: its ID, saved once it looks like one). */
function RouteRow({ head, label, channel, mention, channels, onChannel, onMention }: {
  head: ReactNode; label: string; channel: string; mention: string; channels: ReadonlyArray<{ value: string; label: string }>;
  onChannel: (v: string) => void; onMention: (v: string) => void;
}) {
  const isRole = /^\d+$/.test(mention);
  const [roleMode, setRoleMode] = useState(isRole);
  const [roleText, setRoleText] = useState(isRole ? mention : '');
  const tag = isRole || roleMode ? 'role' : mention;
  return (
    <>
      {head}
      <div className={styles.route}>
        <span>{label}</span>
        <span className={styles.sel}><Select aria-label={`Kênh: ${label}`} value={channel} options={channels} onChange={onChannel} /></span>
        <span className={styles.tag}><Select aria-label={`Tag: ${label}`} value={tag} options={TAGS} onChange={(v) => {
          setRoleMode(v === 'role');
          onMention(v === 'role' ? (/^\d{15,22}$/.test(roleText) ? roleText : '') : v);
        }} /></span>
        {tag === 'role' && (
          <TextInput className={styles.role} inputMode="numeric" placeholder="ID role" aria-label={`ID role: ${label}`} value={roleText}
            onChange={(e) => { const v = e.target.value.trim(); setRoleText(v); onMention(/^\d{15,22}$/.test(v) ? v : ''); }} />
        )}
      </div>
    </>
  );
}

/** The relay's /status /online, registered once with the bot's token (never saved). */
function RegisterCommands() {
  const toast = useToast();
  const { withToken } = useSession();
  const [appId, setAppId] = useState('');
  const [bot, setBot] = useState('');
  return (
    <Card>
      <CardHead title="Đăng ký lệnh /status /online" sub="làm một lần" />
      <CardBody stack>
        <Hint>Lấy ở <a href="https://discord.com/developers/applications" target="_blank" rel="noopener">Discord Developer Portal</a> → ứng dụng của bạn.
          Bot token chỉ dùng cho lần đăng ký này, <b>không được lưu</b> ở đâu cả.</Hint>
        <div className={styles.register}>
          <TextInput inputMode="numeric" placeholder="Application ID" aria-label="Application ID" autoComplete="off" value={appId} onChange={(e) => setAppId(e.target.value.trim())} />
          <Secret value={bot} onChange={setBot} placeholder="Bot token" label="Bot token" />
          <Button variant="soft" onClick={() => void withToken('đăng ký lệnh Discord', async (token) => {
            const r = await adminFetch<{ commands: string[] }>('/api/discord/register-commands', 'POST', token, { appId, botToken: bot });
            setBot('');
            toast(`Đã đăng ký ${r.commands.join(', ')}, vài phút sau sẽ hiện trong Discord.`);
          })}>Đăng ký lệnh</Button>
        </div>
      </CardBody>
    </Card>
  );
}
