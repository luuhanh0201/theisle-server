import { useRef, useState } from 'react';
import type { MessageDef } from '@isle/api';
import { Button, Card, CardBody, CardHead, Hint, Mono, Switch, TextArea, TextInput } from '@isle/ui';
import { MSG_GROUPS, example, sent, typed, view } from './texts';
import styles from './Messages.module.css';

/** "Nội dung": every text there is, by group, with a search. */
export function TextsCard({ catalog, texts, setText }: {
  catalog: ReadonlyArray<MessageDef>; texts: Record<string, string>; setText: (key: string, own: string | undefined) => void;
}) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = catalog.filter((m) => !needle || [m.key, m.label, m.default, texts[m.key] ?? ''].some((v) => v.toLowerCase().includes(needle)));
  // The panel's groups first, then any group the bridge added since.
  const groups = [...MSG_GROUPS, ...[...new Set(catalog.map((m) => m.group))].filter((g) => !MSG_GROUPS.some(([id]) => id === g)).map((g) => [g, g] as const)];
  const blocks = groups.map(([g, title]) => [g, title, shown.filter((m) => m.group === g)] as const).filter(([, , items]) => items.length > 0);
  return (
    <Card>
      <CardHead title="Nội dung" sub={`${catalog.length} tin · ${Object.keys(texts).length} đã sửa`}>
        <TextInput type="search" className={styles.search} placeholder="Tìm tin…" aria-label="Tìm tin" value={q} onChange={(e) => setQ(e.target.value)} />
      </CardHead>
      <CardBody>
        <Hint className={styles.lead}>Bỏ tích <b>Gửi</b> để tắt hẳn một tin. <Mono>{'{tên}'}</Mono> được điền khi gửi, bấm để chèn.
          Tin của mod đổi trong vòng vài giây, không cần restart. Ban/kick làm trong admin panel của game nên không có tin ở đây.</Hint>
        {blocks.length === 0 ? <Hint>Không có tin nào khớp.</Hint> : blocks.map(([g, title, items]) => (
          <div key={g} className={styles.group}>
            <div className={styles.groupLabel}>{title}</div>
            {items.map((m) => <MessageItem key={m.key} def={m} own={texts[m.key]} onChange={(own) => setText(m.key, own)} />)}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function MessageItem({ def, own, onChange }: { def: MessageDef; own: string | undefined; onChange: (own: string | undefined) => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const v = view(def, own);
  // What is being typed, as typed: emptying the box turns the text off ("" = not sent), but the
  // box stays open and empty until it is left.
  const [editing, setEditing] = useState<string | null>(null);
  const text = editing ?? v.text;
  const off = v.off && editing === null;
  const write = (t: string): void => { setEditing(t); onChange(typed(def, t)); };
  // Put {name} where the cursor is.
  const insert = (name: string): void => {
    const el = area.current;
    const ins = `{${name}}`;
    const at = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? at;
    write(text.slice(0, at) + ins + text.slice(end));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + ins.length, at + ins.length); });
  };
  return (
    <div className={styles.item}>
      <div>
        <div className={styles.what}>{def.label}</div>
        <div className={styles.key}>{def.key}</div>
        {v.tag && <div className={styles.tags}><span className={`${styles.tag} ${styles[v.tag.kind]}`}>{v.tag.label}</span></div>}
      </div>
      <div>
        <TextArea ref={area} rows={1} maxLength={300} disabled={off} aria-label={def.label} value={text}
          onChange={(e) => write(e.target.value)} onBlur={() => setEditing(null)} />
        <div className={styles.tools}>
          <Switch checked={!v.off} onChange={(on) => { setEditing(null); onChange(sent(def, own, on)); }} label="Gửi" />
          {def.vars.map((name) => (
            // mousedown kept off the button: the text box keeps its focus and cursor.
            <button key={name} type="button" className={styles.var} title="Chèn" disabled={off}
              onMouseDown={(e) => e.preventDefault()} onClick={() => insert(name)}>{`{${name}}`}</button>
          ))}
          {own !== undefined && <Button variant="ghost" small className={styles.reset} onClick={() => { setEditing(null); onChange(undefined); }}>Về mặc định</Button>}
        </div>
        {!v.off && <div className={styles.ex}>Ví dụ: <span>{example(text)}</span></div>}
      </div>
    </div>
  );
}
