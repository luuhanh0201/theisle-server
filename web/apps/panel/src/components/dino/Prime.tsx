import { Chip } from './Identity';
import s from './dino.module.css';

/** The ten prime tasks as the game numbers them (the panel's names; "(?)" = not sure what it is). */
export const PRIME_TASKS = [
  'Sanctuary', 'Nở từ tổ (?)', 'Ăn đủ ba chất', 'Nhiệm vụ 4 (?)', 'Vùng di cư', 'Vùng tuần tra',
  'Chưa từng vô sinh', 'Chưa từng co giật cơ', 'Nuôi con (?)', 'Loài được tặng sẵn',
];

export interface PrimeInfo { isPrime: boolean; isEligible: boolean; doneCount: number; hasData: boolean; condMap: Record<number, boolean> | null }

/** What a slot or a live dino says about prime: its flags and the ten tasks, from any of the shapes they come in. */
export function primeInfoOf(st: Record<string, unknown> | null | undefined): PrimeInfo | null {
  if (!st) return null;
  const prime = st['prime'] as Record<string, unknown> | boolean | undefined;
  const primeObj = typeof prime === 'object' && prime !== null ? prime : null;
  const isPrime = st['isPrime'] === true || prime === true || primeObj?.['prime'] === true;
  const source = (st['primeData'] ?? st['conditions'] ?? primeObj?.['conditions'] ?? null) as Record<string, unknown> | null;
  let condMap: Record<number, boolean> | null = null;
  let doneCount = 0;
  let hasData = false;
  if (source && typeof source === 'object') {
    hasData = true;
    condMap = {};
    for (let i = 1; i <= 10; i++) {
      const met = (source[`cond${i}`] ?? source[String(i)]) === true;
      condMap[i] = met;
      if (met) doneCount++;
    }
  } else if (typeof st['primeConditions'] === 'string' && /^[01]{10}$/.test(st['primeConditions'])) {
    hasData = true;
    condMap = {};
    for (let i = 1; i <= 10; i++) {
      const met = (st['primeConditions'] as string)[i - 1] === '1';
      condMap[i] = met;
      if (met) doneCount++;
    }
  }
  const pd = st['primeData'] as Record<string, unknown> | undefined;
  const isEligible = isPrime || pd?.['eligible'] === true || primeObj?.['eligible'] === true || st['eligible'] === true || doneCount >= 5;
  return { isPrime, isEligible, doneCount, hasData, condMap };
}

/** The prime box of a dino card: the badge and the ten tasks, ticked or not. */
export function PrimeBox({ info }: { info: PrimeInfo | null }) {
  if (!info || (!info.hasData && !info.isPrime && !info.isEligible)) {
    return (
      <div className={s.primeBox}>
        <div className={s.primeHead}><span className={s.primeTitle}><span className={s.crown}>👑</span> Điều kiện Prime Elder</span><Chip tone="neutral">Chưa có dữ liệu</Chip></div>
        <div className={s.muted} style={{ fontSize: '11.5px' }}>Chưa có snapshot nhiệm vụ Prime cho dino này.</div>
      </div>
    );
  }
  const badge = info.isPrime ? <Chip tone="grow">👑 Đã là Prime Elder</Chip> : info.isEligible ? <Chip tone="accent">✓ Đủ ĐK Prime</Chip> : <Chip tone="neutral">Chưa đủ ĐK</Chip>;
  if (!info.hasData) {
    return (
      <div className={s.primeBox}>
        <div className={s.primeHead}><span className={s.primeTitle}><span className={s.crown}>👑</span> Trạng thái Prime Elder</span>{badge}</div>
        <div className={s.muted} style={{ fontSize: '11.5px' }}>{info.isPrime ? 'Dino đã đạt danh hiệu Prime Elder.' : 'Chưa có dữ liệu 10 nhiệm vụ.'}</div>
      </div>
    );
  }
  return (
    <div className={s.primeBox}>
      <div className={s.primeHead}>
        <span className={s.primeTitle}><span className={s.crown}>👑</span> Điều kiện Prime: <span className={s.primeCount}>{info.doneCount}/10 đạt</span> <span className={`${s.primeSub} ${s.muted}`}>(cần 5)</span></span>
        {badge}
      </div>
      <div className={s.primeGrid}>
        {PRIME_TASKS.map((t, i) => {
          const met = info.condMap?.[i + 1] === true;
          return (
            <div key={t} className={`${s.cond}${met ? ` ${s.met}` : ''}`} title={`${i + 1}. ${t}: ${met ? 'Đã đạt' : 'Chưa đạt'}`}>
              <span className={s.condCheck}>{met ? '✓' : '○'}</span><span className={s.condNum}>{i + 1}.</span><span className={s.condName}>{t}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
