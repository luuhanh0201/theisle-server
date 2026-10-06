import type { DinoTier } from '../lib/dino';
import { TIER_NAME } from '../lib/dino';

/** The tier's moving decoration on a card (app.js renderSlotFx): amber gloss, DNA veins, rex flames, apex eye, fossil grit. */
export function TierFx({ tier }: { tier: DinoTier }) {
  if (tier.key === 'amber') {
    return (
      <div className="slot-tier-fx tier-amber-fx" aria-hidden="true">
        <div className="amber-gloss-sheen" />
        <div className="amber-specular-light" />
        <svg className="amber-crackle-svg" viewBox="0 0 320 200" preserveAspectRatio="none">
          <path d="M 0,35 L 50,60 L 85,45 L 125,80 L 145,70 M 85,45 L 100,18 M 125,80 L 160,125 L 195,115 L 245,160 M 195,115 L 215,90 L 280,75 M 245,160 L 285,195 M 160,125 L 145,170 L 170,195 M 215,90 L 250,40" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </div>
    );
  }
  if (tier.key === 'dna') {
    return (
      <div className="slot-tier-fx tier-dna-fx" aria-hidden="true">
        <svg className="dna-veins-svg" viewBox="0 0 320 200" preserveAspectRatio="none">
          <path className="dna-capillary c1" d="M -10,120 Q 35,95 65,115 T 135,88 T 215,118 T 330,80" fill="none" />
          <path className="dna-capillary c2" d="M 40,-5 Q 65,50 115,65 T 185,48 T 265,78 T 325,25" fill="none" />
          <path className="dna-capillary c3" d="M 75,205 Q 120,150 170,162 T 255,138 T 315,175" fill="none" />
          <path className="dna-capillary c4" d="M 115,65 Q 145,105 135,88" fill="none" />
          <circle className="dna-node n1" cx="65" cy="115" r="3.2" />
          <circle className="dna-node n2" cx="185" cy="48" r="3.2" />
          <circle className="dna-node n3" cx="255" cy="138" r="3.2" />
        </svg>
      </div>
    );
  }
  if (tier.key === 'rex') {
    return (
      <div className="slot-tier-fx tier-rex-fx" aria-hidden="true">
        <div className="rex-flame-aura" />
        <svg className="rex-cracks-svg" viewBox="0 0 320 120" preserveAspectRatio="none">
          <path d="M 160,120 L 148,88 L 115,72 L 78,82 M 148,88 L 175,62 L 162,35 L 202,15 M 175,62 L 218,72 L 260,55 M 115,72 L 95,45 L 60,38" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </div>
    );
  }
  if (tier.key === 'apex') {
    return (
      <div className="slot-tier-fx tier-apex-fx" aria-hidden="true">
        <div className="apex-fire-sweep" />
        <div className="apex-eye-box">
          <svg className="apex-eye-svg" viewBox="0 0 100 50">
            <defs>
              <radialGradient id="apexIrisGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#fef08a" />
                <stop offset="40%" stopColor="#f97316" />
                <stop offset="80%" stopColor="#dc2626" />
                <stop offset="100%" stopColor="#450a0a" />
              </radialGradient>
            </defs>
            <path className="eye-lid-upper" d="M 6,25 Q 50,-4 94,25" fill="none" stroke="rgba(239,68,68,0.75)" strokeWidth="1.6" />
            <path className="eye-lid-lower" d="M 6,25 Q 50,54 94,25" fill="none" stroke="rgba(239,68,68,0.75)" strokeWidth="1.6" />
            <ellipse className="eye-sclera" cx="50" cy="25" rx="36" ry="16" fill="rgba(185,28,28,0.32)" />
            <ellipse className="eye-iris" cx="50" cy="25" rx="18" ry="15" fill="url(#apexIrisGrad)" />
            <polygon className="eye-pupil" points="49,11 51,11 52,25 51,39 49,39 48,25" fill="#050101" />
            <ellipse className="eye-glint" cx="44" cy="20" rx="3" ry="1.5" fill="#ffffff" />
          </svg>
        </div>
        <svg className="apex-claws-svg" viewBox="0 0 160 160" preserveAspectRatio="none">
          <path className="claw-slash s1" d="M 22,6 L 148,132" fill="none" />
          <path className="claw-slash s2" d="M 38,0 L 162,126" fill="none" />
          <path className="claw-slash s3" d="M 10,26 L 132,148" fill="none" />
        </svg>
      </div>
    );
  }
  return <div className="slot-tier-fx tier-fossil-fx" aria-hidden="true"><div className="fossil-grit-overlay" /></div>;
}

/** F0 (not prime) … F4 (đời 4), in the tier's own colours (.ftag). */
export function TierBadge({ tier, extra = '', id, hidden }: { tier: DinoTier; extra?: string; id?: string; hidden?: boolean }) {
  return <span className={`ftag f${tier.level}${extra ? ` ${extra}` : ''}`} id={id} hidden={hidden} title={`F${tier.level} · ${TIER_NAME[tier.level] ?? ''}`}>F{tier.level}</span>;
}
