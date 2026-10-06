import type { ReactNode } from 'react';
import { hue, initials, shortId } from '../../lib/format';
import s from './dino.module.css';

/** A player's square: a stable colour from the SteamID, the first letter of the name. */
export function Avatar({ id, name, size }: { id: string; name?: string | null; size?: 'sm' | 'lg' }) {
  const h = hue(id);
  return (
    <span className={`${s.avatar}${size ? ` ${s[size]}` : ''}`} style={{ background: `linear-gradient(135deg,hsl(${h} 70% 52%),hsl(${(h + 40) % 360} 70% 42%))` }}>
      {initials(name, id)}
    </span>
  );
}

/** A player by name (the SteamID's end when unknown), a link to their page; AI as plain text. */
export function PlayerLink({ id, name }: { id: string | null; name?: string | null }) {
  if (!id || id === 'ai') return <span className={s.muted}>AI</span>;
  return <a href={`#player/${id}`} className={s.plink}>{name ? name : <span className={s.mono}>{shortId(id)}</span>}</a>;
}

export type Tone = 'accent' | 'kill' | 'dmg' | 'chat' | 'grow' | 'gar' | 'neutral';
/** A small rounded label in one of the panel's tones. */
export function Chip({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return <span className={`${s.chip} ${s[`tone-${tone}`]}`} title={title}>{children}</span>;
}
