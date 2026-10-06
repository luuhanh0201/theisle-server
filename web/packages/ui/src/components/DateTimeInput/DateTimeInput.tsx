import { useEffect, useRef, useState } from 'react';
import styles from './DateTimeInput.module.css';

type Kind = 'time' | 'date' | 'datetime';
interface Pick { y: number | null; m: number | null; d: number | null; h: number; mi: number }

const pad = (n: number): string => String(n).padStart(2, '0');
const DOW = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

/** "2026-10-06T21:30" / "2026-10-06" / "21:30" → its parts (missing ones null). */
export function parseDateTime(v: string): { y: number | null; m: number | null; d: number | null; h: number | null; mi: number | null } {
  const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  const tm = /(?:^|T)(\d{2}):(\d{2})/.exec(v);
  return { y: dm ? +dm[1]! : null, m: dm ? +dm[2]! - 1 : null, d: dm ? +dm[3]! : null, h: tm ? +tm[1]! : null, mi: tm ? +tm[2]! : null };
}

/** What the box shows: "06/10/2026 21:30", "06/10/2026", "21:30" ('' when empty). */
export function shownDateTime(kind: Kind, v: string): string {
  const p = parseDateTime(v);
  const date = p.y !== null ? `${pad(p.d!)}/${pad(p.m! + 1)}/${p.y}` : '';
  const time = p.h !== null ? `${pad(p.h)}:${pad(p.mi!)}` : '';
  if (kind === 'time') return time;
  if (kind === 'date') return date;
  return date && time ? `${date} ${time}` : '';
}

/**
 * The system's date / time box (never the browser's own, AGENTS.md "UI"; the React twin of
 * portal/public/ui-inputs.js's): a button showing the value, a month calendar and a time row.
 * The value is the native input's text: "HH:MM" (time), "YYYY-MM-DD" (date), "YYYY-MM-DDTHH:MM".
 */
export function DateTimeInput({ id, kind, value, onChange, placeholder, required = false, disabled = false, 'aria-label': ariaLabel }: {
  id?: string; kind: Kind; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; disabled?: boolean; 'aria-label'?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<Pick>({ y: null, m: null, d: null, h: 0, mi: 0 });
  const [view, setView] = useState({ y: 2026, m: 0 });
  const wrap = useRef<HTMLDivElement>(null);
  const hasDate = kind !== 'time';
  const hasTime = kind !== 'date';

  const valueOf = (p: Pick): string | null => {
    const time = `${pad(p.h)}:${pad(p.mi)}`;
    if (kind === 'time') return time;
    if (p.y === null) return null;
    const date = `${p.y}-${pad(p.m! + 1)}-${pad(p.d!)}`;
    return kind === 'date' ? date : `${date}T${time}`;
  };
  const close = (keep: boolean, p = pick): void => {
    setOpen(false);
    if (!keep) return;
    const v = valueOf(p);
    if (v !== null && v !== value) onChange(v);
  };
  const show = (): void => {
    const p = parseDateTime(value);
    const now = new Date();
    setPick({ y: p.y, m: p.m, d: p.d, h: p.h ?? (kind === 'date' ? 0 : now.getHours()), mi: p.mi ?? 0 });
    setView({ y: p.y ?? now.getFullYear(), m: p.m ?? now.getMonth() });
    setOpen(true);
  };

  // A click outside keeps what was picked (as the old picker); Esc drops it.
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: PointerEvent): void => { if (!wrap.current?.contains(e.target as Node)) closeRef.current(true, pickRef.current); };
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); closeRef.current(false); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);

  const text = shownDateTime(kind, value);
  const today = new Date();
  const first = new Date(view.y, view.m, 1);
  const lead = (first.getDay() + 6) % 7;
  const setTime = (h: number, mi: number): void => setPick((p) => ({ ...p, h, mi }));

  return (
    <div className={styles.wrap} ref={wrap}>
      <button id={id} type="button" className={styles.btn} disabled={disabled} aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => (open ? close(true) : show())}>
        {kind === 'time'
          ? <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></svg>
          : <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2" /><path d="M2 6.5h12M5 1.5v3M11 1.5v3" /></svg>}
        <span className={`${styles.val}${text ? '' : ` ${styles.ph}`}`}>{text || placeholder || (kind === 'time' ? 'Chọn giờ' : kind === 'date' ? 'Chọn ngày' : 'Chọn ngày giờ')}</span>
      </button>
      {open && (
        <div className={styles.pop} role="dialog" aria-label={ariaLabel ?? 'Chọn ngày giờ'}>
          {hasDate && (
            <>
              <div className={styles.head}>
                <button type="button" className={styles.nav} aria-label="Tháng trước" onClick={() => { const d = new Date(view.y, view.m - 1, 1); setView({ y: d.getFullYear(), m: d.getMonth() }); }}>‹</button>
                <b>{first.toLocaleString('vi-VN', { month: 'long', year: 'numeric' })}</b>
                <button type="button" className={styles.nav} aria-label="Tháng sau" onClick={() => { const d = new Date(view.y, view.m + 1, 1); setView({ y: d.getFullYear(), m: d.getMonth() }); }}>›</button>
              </div>
              <div className={styles.grid}>
                {DOW.map((d) => <span key={d} className={styles.dow}>{d}</span>)}
                {Array.from({ length: 42 }, (_, i) => {
                  const d = new Date(view.y, view.m, 1 - lead + i);
                  const on = pick.y === d.getFullYear() && pick.m === d.getMonth() && pick.d === d.getDate();
                  const cls = [styles.day, d.getMonth() !== view.m ? styles.out : '', d.toDateString() === today.toDateString() ? styles.today : '', on ? styles.on : ''].filter(Boolean).join(' ');
                  return (
                    <button key={i} type="button" className={cls} aria-label={`${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`} aria-pressed={on}
                      onClick={() => {
                        const p = { ...pick, y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
                        setPick(p);
                        setView({ y: p.y, m: p.m });
                        if (kind === 'date') close(true, p);
                      }}>{d.getDate()}</button>
                  );
                })}
              </div>
            </>
          )}
          {hasTime && (
            <div className={styles.time}>
              <span className={styles.lbl}>Giờ</span>
              <Spin label="Giờ" text={pad(pick.h)} onDown={() => setTime((pick.h + 23) % 24, pick.mi)} onUp={() => setTime((pick.h + 1) % 24, pick.mi)}
                onType={(n) => setTime(Math.min(23, Math.max(0, n)), pick.mi)} />
              <span className={styles.colon}>:</span>
              <Spin label="Phút" text={pad(pick.mi)}
                onDown={() => { const x = (pick.mi + 55) % 60; setTime(pick.h, x - (x % 5)); }}
                onUp={() => setTime(pick.h, (Math.floor(pick.mi / 5) * 5 + 5) % 60)}
                onType={(n) => setTime(pick.h, Math.min(59, Math.max(0, n)))} />
              <div className={styles.quick}>
                {['00:00', '06:00', '12:00', '18:00'].map((t) => (
                  <button key={t} type="button" onClick={() => { const [h, mi] = t.split(':').map(Number); setTime(h!, mi!); }}>{t}</button>
                ))}
              </div>
            </div>
          )}
          <div className={styles.foot}>
            {hasDate && <button type="button" onClick={() => {
              const n = new Date();
              const p = { ...pick, y: n.getFullYear(), m: n.getMonth(), d: n.getDate() };
              setPick(p); setView({ y: p.y, m: p.m });
              if (kind === 'date') close(true, p);
            }}>Hôm nay</button>}
            <button type="button" onClick={() => {
              const n = new Date();
              close(true, { y: n.getFullYear(), m: n.getMonth(), d: n.getDate(), h: n.getHours(), mi: n.getMinutes() });
            }}>Bây giờ</button>
            {!required && <button type="button" onClick={() => { setOpen(false); if (value !== '') onChange(''); }}>Xoá</button>}
            <span className={styles.grow} />
            <button type="button" className={styles.ok} onClick={() => close(true)}>Xong</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Hours or minutes: − / + and the number typed. */
function Spin({ label, text, onDown, onUp, onType }: { label: string; text: string; onDown: () => void; onUp: () => void; onType: (n: number) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <span className={styles.spin}>
      <button type="button" aria-label={`${label} giảm`} onClick={onDown}>−</button>
      <input type="text" inputMode="numeric" aria-label={label} value={typed ?? text}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={() => { if (typed !== null) { const n = Math.floor(Number(typed)); if (Number.isFinite(n)) onType(n); setTyped(null); } }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <button type="button" aria-label={`${label} tăng`} onClick={onUp}>+</button>
    </span>
  );
}
