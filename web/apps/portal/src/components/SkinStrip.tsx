import { REGIONS, hex } from '@portal/skin-editor';

/** Up to 5 of a skin's colours as small squares (app.js skinStrip). */
export function SkinStrip({ skin }: { skin: { colors?: Record<string, { r: number; g: number; b: number }> } | null | undefined }) {
  const colors = skin?.colors;
  if (!colors) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 3, verticalAlign: 'middle', marginLeft: 8 }}>
      {REGIONS.filter(([k]) => colors[k]).slice(0, 5).map(([k]) => (
        <i key={k} style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, border: '1px solid rgba(255,255,255,0.2)', background: hex(colors[k]) }} />
      ))}
    </span>
  );
}
