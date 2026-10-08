import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { popupHost } from '../popupHost';
import styles from './ColorInput.module.css';

const hexToRgb = (h: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return null;
  const n = parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (r: number, g: number, b: number): string => `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
}
export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number): number => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return rgbToHex(f(5) * 255, f(3) * 255, f(1) * 255);
}

/**
 * The system's colour box (as ui-inputs.js draws it, never the OS colour dialog): a swatch button,
 * and beside it a picker (saturation / value square, hue bar, hex code, Xong). Every move calls
 * `onChange` with "#rrggbb"; Esc puts back the colour it opened with, a click outside keeps it.
 */
export function ColorInput({ id, value, onChange, disabled = false, 'aria-label': ariaLabel = 'Chọn màu', size }: {
  id?: string; value: string; onChange: (hex: string) => void; disabled?: boolean; 'aria-label'?: string; size?: { width: number; height: number };
}) {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<[number, number, number]>([0, 0, 0]);
  const [hexText, setHexText] = useState('');
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const start = useRef(value);
  const cb = useRef(onChange);
  cb.current = onChange;

  const show = (next: [number, number, number], fromHex = false): void => {
    setHsv(next);
    const v = hsvToHex(...next);
    if (!fromHex) setHexText(v.toUpperCase());
    if (v !== value.toLowerCase()) cb.current(v);
  };
  const openIt = (): void => {
    if (disabled) return;
    start.current = value;
    const rgb = hexToRgb(value) ?? [0, 0, 0];
    setHsv(rgbToHsv(...rgb));
    setHexText(value.toUpperCase());
    setOpen(true);
  };
  useLayoutEffect(() => {
    if (!open) return;
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const w = 232, h = pop.current?.offsetHeight || 230;
    setPos({ left: Math.max(8, Math.min(window.innerWidth - w - 8, r.left)), top: r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6 });
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e: Event): void => {
      const t = e.target as Node;
      if (pop.current?.contains(t) || btn.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (start.current.toLowerCase() !== value.toLowerCase()) cb.current(start.current);
      setOpen(false);
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true); };
  }, [open, value]);

  const drag = (at: (x: number, y: number) => [number, number, number]) => (e: RPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture?.(e.pointerId);
    const move = (ev: { clientX: number; clientY: number }): void => {
      const r = el.getBoundingClientRect();
      show(at(Math.min(1, Math.max(0, (ev.clientX - r.left) / (r.width || 1))), Math.min(1, Math.max(0, (ev.clientY - r.top) / (r.height || 1)))));
    };
    move(e);
    const onMove = (ev: PointerEvent): void => move(ev);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', () => el.removeEventListener('pointermove', onMove), { once: true });
  };
  const [h, s, v] = hsv;
  return (
    <>
      <button ref={btn} id={id} type="button" className={styles.btn} disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel}
        style={{ background: value || '#000000', ...(size ? { width: size.width, height: size.height } : {}) }}
        onClick={() => (open ? setOpen(false) : openIt())} />
      {open && createPortal(
        <div ref={pop} className={styles.pop} role="dialog" aria-label={ariaLabel} style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}>
          <div className={styles.sv} style={{ ['--cp-hue' as string]: `hsl(${h}, 100%, 50%)` }} onPointerDown={drag((x, y) => [hsv[0], x, 1 - y])}>
            <span className={styles.knob} style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }} />
          </div>
          <div className={styles.hue} onPointerDown={drag((x) => [Math.min(359.9, x * 360), hsv[1], hsv[2]])}>
            <span className={`${styles.knob} ${styles.hueKnob}`} style={{ left: `${(h / 360) * 100}%` }} />
          </div>
          <div className={styles.row}>
            <span className={styles.prev} style={{ background: hsvToHex(h, s, v) }} />
            <input className={styles.hex} maxLength={7} spellCheck={false} aria-label="Mã màu" value={hexText}
              onChange={(e) => { setHexText(e.target.value); const c = hexToRgb(e.target.value); if (c) show(rgbToHsv(...c), true); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setOpen(false); } }} />
            <button type="button" className={styles.ok} onClick={() => setOpen(false)}>Xong</button>
          </div>
        </div>,
        popupHost(btn.current),
      )}
    </>
  );
}
