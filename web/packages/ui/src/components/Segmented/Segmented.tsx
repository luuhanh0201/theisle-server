import styles from './Segmented.module.css';

export interface SegmentOption<V extends string> { value: V; label: string; note?: string; tone?: 'neutral' | 'warn' | 'good' }

/** A choice of a few shown side by side (the panel's .lvl-seg); the chosen one is pressed. */
export function Segmented<V extends string>({ value, options, onChange, label, disabled = false }: {
  value: V; options: ReadonlyArray<SegmentOption<V>>; onChange: (v: V) => void; label: string; disabled?: boolean;
}) {
  return (
    <div className={styles.seg} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} disabled={disabled}
          className={`${o.value === value ? styles.on : ''} ${styles[o.tone ?? 'neutral']}`}
          onClick={() => { if (o.value !== value) onChange(o.value); }}>
          {o.label}{o.note !== undefined && <small>{o.note}</small>}
        </button>
      ))}
    </div>
  );
}
