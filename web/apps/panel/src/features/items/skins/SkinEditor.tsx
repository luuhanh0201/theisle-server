import { useEffect, useState } from 'react';
import { ColorInput, Slider } from '@isle/ui';
import { PRESETS, REGIONS, hex, lightSlider, lightText, linearOf, type LinearColor } from '@portal/skin-editor';
import s from './SkinEditor.module.css';

/** A light slider's value (log scale) → its factor; the ends are the exact limits (as skin-editor.js). */
export function factorOf(v: number): number {
  return lightSlider.value({ value: String(v), min: String(lightSlider.min), max: String(lightSlider.max) });
}
/** "#rrggbb" typed: taken once it is a full colour. */
export const typedHex = (v: string): string | null => { const m = /^#?([0-9a-f]{6})$/.exec(v.trim().toLowerCase()); return m ? `#${m[1]}` : null; };

/**
 * The skin colour editor (the React twin of portal skin-editor.js mountRegions): per region a
 * colour box, its hex code and, with `light`, a darker / brighter slider (double click: × 1).
 */
export function SkinRegions({ colors, light, onColor, onLight, femaleOff, disabled = false }: {
  colors: Record<string, LinearColor>; light: Record<string, number>; onColor: (id: string, c: LinearColor) => void;
  onLight: (id: string, f: number | null) => void; femaleOff: boolean; disabled?: boolean;
}) {
  return (
    <div className={s.regions}>
      {REGIONS.map(([id, label]) => (
        <Region key={id} id={id} label={label} value={hex(colors[id])} f={light[id] ?? 1} off={femaleOff && id === 'MaleDisplay'} disabled={disabled}
          onColor={(h) => onColor(id, linearOf(h))} onLight={(f) => onLight(id, Math.abs(f - 1) < 0.005 ? null : f)} />
      ))}
    </div>
  );
}

function Region({ id, label, value, f, off, disabled, onColor, onLight }: {
  id: string; label: string; value: string; f: number; off: boolean; disabled: boolean; onColor: (hex: string) => void; onLight: (f: number) => void;
}) {
  const [text, setText] = useState(value);
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(value); }, [value, focus]);
  const bad = typedHex(text) === null && text.trim().length >= 6;
  const [lt, cls] = lightText(f);
  return (
    <div className={`${s.region}${off ? ` ${s.off}` : ''}`} data-region={id}>
      <div className={s.row}>
        <ColorInput id={`itm-picker-${id}`} aria-label={label} value={value} disabled={disabled} onChange={onColor} />
        <span className={s.name}>{label}</span>
        <input type="text" className={`${s.hex}${bad ? ` ${s.bad}` : ''}`} maxLength={7} spellCheck={false} aria-label={`${label} (mã hex)`} value={text} disabled={disabled}
          onFocus={() => setFocus(true)} onBlur={() => { setFocus(false); setText(value); }}
          onChange={(e) => { setText(e.target.value); const h = typedHex(e.target.value); if (h) onColor(h); }} />
      </div>
      <div className={s.light} title="Kéo trái: tối hơn · phải: sáng hơn (phát sáng) · bấm đúp: về thường" onDoubleClick={() => !disabled && onLight(1)}>
        <Slider aria-label={`Độ sáng ${label}`} min={lightSlider.min} max={lightSlider.max} step={0.01} value={lightSlider.toSlider(f)} disabled={disabled} onChange={(v) => onLight(factorOf(v))} />
        <span className={`${s.v} ${cls ? s[cls] : ''}`}>{lt}</span>
      </div>
    </div>
  );
}

/** The themed palettes: a tile each with its first five colours; picking one sets the 10 regions. */
export function SkinPresets({ onPick, disabled = false }: { onPick: (colors: Record<string, string>) => void; disabled?: boolean }) {
  const [on, setOn] = useState<number | null>(null);
  return (
    <div className={s.presets}>
      {PRESETS.map((p, i) => (
        <button key={p.name} type="button" className={`${s.preset}${on === i ? ` ${s.on}` : ''}`} title={p.name} disabled={disabled} onClick={() => { setOn(i); onPick(p.colors); }}>
          <div className={s.stripe}>{REGIONS.slice(0, 5).map(([id]) => <i key={id} style={{ background: p.colors[id] }} />)}</div>
          <span>{p.name}</span>
        </button>
      ))}
    </div>
  );
}

