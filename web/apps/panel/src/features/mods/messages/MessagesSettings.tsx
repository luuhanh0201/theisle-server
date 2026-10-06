import { useMemo, useRef, useState } from 'react';
import type { MessageDef, MessagesSettings as Settings } from '@isle/api';
import { Button, Card, CardBody, CardHead, GroupLabel, Hint, Mono, NumberInput, Switch, TextArea, TextInput } from '@isle/ui';
import { FreshBar } from '../../settings-form/FreshBar';
import { useSettingsForm } from '../../settings-form/useSettingsForm';
import { MSG_GROUPS, TAG_LABEL, fmtMark, msgExample, msgState, parseMarks, withSend, withText } from './logic';
import styles from './MessagesSettings.module.css';

/** Mods → Thông báo: every text players get, and how often (bridge/src/messages.ts). */
export function MessagesSettings() {
  const form = useSettingsForm<Settings>('/api/messages', {
    label: 'Thông báo', href: '#mods/messages',
    toBody: ({ texts, countdownMarks, periodic, corpseWipe }) => ({ texts, countdownMarks, periodic, corpseWipe }),
  });
  const d = form.draft;
  if (form.error) return <Card><CardBody><Hint>Không tải được thông báo: {form.error.message}</Hint></CardBody></Card>;
  if (d === null) return <Card><CardBody><Hint>Đang tải…</Hint></CardBody></Card>;
  return (
    <>
      <Timing d={d} update={form.update} />
      <Texts d={d} update={form.update} />
      <div className={styles.savebar}>
        {form.dirty && <b className={styles.dirty}>Có thay đổi chưa lưu.</b>}
        <Button onClick={() => void form.save()} disabled={!form.dirty || form.saving}>{form.saving ? 'Đang lưu…' : 'Lưu thông báo'}</Button>
      </div>
      <FreshBar show={form.serverChanged} dirty={form.dirty} onReload={form.reload} />
    </>
  );
}

type Update = (fn: (d: Settings) => Settings) => void;

function Timing({ d, update }: { d: Settings; update: Update }) {
  const [marks, setMarks] = useState(() => d.countdownMarks.map(fmtMark).join(', '));
  const bad = parseMarks(marks) === null;
  return (
    <Card>
      <CardHead title="Tần suất" sub="chỉ gửi khi có người đang chơi" />
      <CardBody className={styles.timing}>
        <div className={styles.line}>
          <label htmlFor="msg-marks">Mốc đếm ngược khi khởi động lại / tắt server</label>
          <TextInput id="msg-marks" className={`${styles.marks}${bad ? ` ${styles.bad}` : ''}`} placeholder="15p, 10p, 5p, 3p, 2p, 1p, 30s, 10s" value={marks}
            title={bad ? 'Ví dụ: 15p, 5p, 1p, 30s' : undefined}
            onChange={(e) => {
              setMarks(e.target.value);
              const m = parseMarks(e.target.value);
              if (m !== null) update((x) => ({ ...x, countdownMarks: m }));
            }} />
          <Hint className={styles.full}>Phút (p) hoặc giây (s), cách nhau bằng dấu phẩy. Server báo ở mỗi mốc còn lại; thời gian đếm ngược tổng chọn lúc bấm khởi động lại (tab Server).</Hint>
        </div>
        <div className={styles.line}>
          <label htmlFor="msg-cw-every">Tự dọn xác mỗi (phút)</label>
          <span className={styles.num}><NumberInput id="msg-cw-every" value={d.corpseWipe.everyMin} min={0} max={1440} step={5}
            onChange={(v) => update((x) => ({ ...x, corpseWipe: { ...x.corpseWipe, everyMin: v } }))} /></span>
          <label htmlFor="msg-cw-warn" className={styles.inline}>báo trước (giây)</label>
          <span className={styles.num}><NumberInput id="msg-cw-warn" value={d.corpseWipe.warnSec} min={0} max={600} step={10}
            onChange={(v) => update((x) => ({ ...x, corpseWipe: { ...x.corpseWipe, warnSec: v } }))} /></span>
          <Hint className={styles.full}>0 = tắt. Dùng lệnh RCON dọn xác của game; khi bấm "Dọn xác" bằng tay ở tab Server cũng báo "Đã dọn xác".</Hint>
        </div>
        <div>
          <GroupLabel>Thông báo định kỳ</GroupLabel>
          <ul className={styles.periodic}>
            {d.periodic.length === 0 && <li><Hint>Chưa có thông báo định kỳ nào.</Hint></li>}
            {d.periodic.map((p, i) => {
              const set = (patch: Partial<typeof p>): void => update((x) => ({ ...x, periodic: x.periodic.map((q, j) => (j === i ? { ...q, ...patch } : q)) }));
              return (
                <li key={p.id ?? `new-${i}`}>
                  <Switch checked={p.enabled} onChange={(v) => set({ enabled: v })} />
                  <TextInput className={styles.ptext} maxLength={300} value={p.text} placeholder="Nội dung, ví dụ: Discord của server: …"
                    aria-label="Nội dung thông báo định kỳ" autoFocus={p.id === undefined && p.text === '' && i === d.periodic.length - 1}
                    onChange={(e) => set({ text: e.target.value })} />
                  <Hint>mỗi</Hint>
                  <span className={styles.pnum}><NumberInput value={p.everyMin} min={5} max={1440} step={5} aria-label="Mỗi bao nhiêu phút" onChange={(v) => set({ everyMin: v })} /></span>
                  <Hint>phút</Hint>
                  <Button variant="ghost" small className={styles.del} onClick={() => update((x) => ({ ...x, periodic: x.periodic.filter((_, j) => j !== i) }))}>Xoá</Button>
                </li>
              );
            })}
          </ul>
          <Button variant="soft" small className={styles.add} onClick={() => update((x) => ({ ...x, periodic: [...x.periodic, { text: '', everyMin: 30, enabled: true }] }))}>
            + Thêm thông báo định kỳ
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function Texts({ d, update }: { d: Settings; update: Update }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return d.catalog.filter((m) => !s || [m.key, m.label, m.default, d.texts[m.key] ?? ''].some((v) => v.toLowerCase().includes(s)));
  }, [d.catalog, d.texts, q]);
  const groups = MSG_GROUPS.map(([g, title]) => [title, shown.filter((m) => m.group === g)] as const).filter(([, items]) => items.length > 0);
  return (
    <Card className={styles.textsCard}>
      <CardHead title="Nội dung" sub={`${d.catalog.length} tin · ${Object.keys(d.texts).length} đã sửa`}>
        <TextInput type="search" className={styles.search} placeholder="Tìm tin…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm tin" />
      </CardHead>
      <CardBody>
        <Hint className={styles.intro}>Bỏ tích <b>Gửi</b> để tắt hẳn một tin. <Mono>{'{tên}'}</Mono> được điền khi gửi, bấm để chèn.
          Tin của mod đổi trong vòng vài giây, không cần restart. Ban/kick làm trong admin panel của game nên không có tin ở đây.</Hint>
        {groups.length === 0 && <Hint>Không có tin nào khớp.</Hint>}
        {groups.map(([title, items]) => (
          <div key={title} className={styles.group}>
            <GroupLabel>{title}</GroupLabel>
            {items.map((m) => <MessageItem key={m.key} def={m} own={d.texts[m.key]} update={update} />)}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function MessageItem({ def, own, update }: { def: MessageDef; own: string | undefined; update: Update }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const { off, text, tag } = msgState(def, own);
  const setText = (v: string): void => update((x) => ({ ...x, texts: withText(x.texts, def, v) }));
  const insert = (name: string): void => {
    const el = area.current;
    if (!el) return;
    const ins = `{${name}}`;
    const at = el.selectionStart ?? el.value.length;
    const value = el.value.slice(0, at) + ins + el.value.slice(el.selectionEnd ?? at);
    setText(value);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(at + ins.length, at + ins.length); });
  };
  return (
    <div className={styles.item}>
      <div>
        <div className={styles.what}>{def.label}</div>
        <div className={styles.key}>{def.key}</div>
        <div className={styles.tags}>{tag && <span className={`${styles.tag} ${tag === 'edited' || tag === 'on' ? styles.edited : styles.off}`}>{TAG_LABEL[tag]}</span>}</div>
      </div>
      <div>
        <TextArea ref={area} rows={1} maxLength={300} className={styles.area} disabled={off} aria-label={def.label} value={text} onChange={(e) => setText(e.target.value)} />
        <div className={styles.tools}>
          <Switch checked={!off} label="Gửi" onChange={(v) => update((x) => ({ ...x, texts: withSend(x.texts, def, v, text) }))} />
          {def.vars.map((v) => <button key={v} type="button" className={styles.var} title="Chèn" onClick={() => insert(v)}>{`{${v}}`}</button>)}
          {own !== undefined && <Button variant="ghost" small className={styles.reset} onClick={() => update((x) => { const t = { ...x.texts }; delete t[def.key]; return { ...x, texts: t }; })}>Về mặc định</Button>}
        </div>
        {!off && <div className={styles.ex}>Ví dụ: <span>{msgExample(text)}</span></div>}
      </div>
    </div>
  );
}
