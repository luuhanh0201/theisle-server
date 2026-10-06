import styles from './Slider.module.css';

/** The system's slider (as ui-inputs.js draws it: the filled part in the accent colour). */
export function Slider({ id, value, min, max, step = 1, onChange, disabled = false, 'aria-label': ariaLabel }: {
  id?: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; disabled?: boolean; 'aria-label'?: string;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input id={id} type="range" className={styles.range} min={min} max={max} step={step} value={value} disabled={disabled} aria-label={ariaLabel}
      style={{ ['--pct' as string]: `${pct}%` }} onChange={(e) => onChange(Number(e.target.value))} />
  );
}
