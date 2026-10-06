import { Card, Icon } from '@isle/ui';
import { dateTime, dinoName, hue, isNum, num } from '../../lib/format';
import { ago } from '../../lib/time';
import { Chip } from './Identity';
import { MutationBlock } from './Mutations';
import { PrimeBox, primeInfoOf } from './Prime';
import { VitalItem } from './Vitals';
import s from './dino.module.css';

const NUTRIENTS: ReadonlyArray<[string, string]> = [
  ['carbValue', 'Carb'], ['proteinValue', 'Protein'], ['lipidValue', 'Lipid'], ['bonesValue', 'Xương'],
  ['mushroomsValue', 'Nấm'], ['rottenFleshValue', 'Thịt thối'], ['cannibalValue', 'Đồng loại'], ['magyValue', 'Magy'],
];

/** A value against its max when the slot knows it; the bare number otherwise. */
function KvItem({ label, v, max }: { label: string; v: unknown; max?: number }) {
  if (!isNum(v)) return <div><div className={s.lbl}><span>{label}</span></div><div className={`${s.val} ${s.muted}`}>–</div></div>;
  if (isNum(max) && max > 0) {
    const r = v / max;
    return (
      <div>
        <div className={s.lbl}><span>{label}</span><span>{num(v)} / {num(max)}</span></div>
        <div className={s.meter}><div className={s.track}><div className={`${s.fill}${r < 0.3 ? ` ${s.low}` : r < 0.6 ? ` ${s.mid}` : ''}`} style={{ width: `${Math.min(100, r * 100)}%` }} /></div></div>
      </div>
    );
  }
  return <div><div className={s.lbl}><span>{label}</span></div><div className={s.val}>{num(v)}</div></div>;
}

export interface StoredSlot {
  slot: string;
  meta: { classPath: string; growth?: number; capturedAt?: number };
  /** The slot file (null: unreadable, only the index is known). */
  state: Record<string, unknown> | null;
}

/**
 * Everything in a garage slot: species, sex, prime, vitals, prime tasks, and (opened) mutations,
 * nutrients and the rest. `onDelete` puts the trash button on it.
 */
export function StoredDinoCard({ slot, meta, state, onDelete, openMore = false }: StoredSlot & { onDelete?: () => void; openMore?: boolean }) {
  const st = state ?? {};
  const g = (k: string): number | null => (isNum(st[k]) ? (st[k] as number) : null);
  const classPath = String(st['classPath'] ?? meta.classPath ?? '');
  const species = dinoName(classPath);
  const h = hue(species);
  const prime = primeInfoOf(st);
  const admin = st['createdBy'] === 'admin';
  const emptyTip = admin ? 'Giữ nguyên chỉ số lúc lấy ra' : 'Chưa có dữ liệu snapshot';
  const nutrients = (st['nutrients'] ?? {}) as Record<string, unknown>;
  const hasNutrients = NUTRIENTS.some(([k]) => isNum(nutrients[k]));
  const loc = st['location'] as { x?: number; y?: number; z?: number } | undefined;
  const elder = g('elderStacks');
  return (
    <Card className={s.dinoCard}>
      <div className={s.dinoHead}>
        <span className={s.glyph} style={{ background: `linear-gradient(135deg,hsl(${h} 60% 45%),hsl(${(h + 50) % 360} 60% 35%))` }}>{species[0] ?? '?'}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className={s.title}>{species}</div>
          <div className={s.tags}>
            <Chip tone="gar">slot {slot}</Chip>
            {st['isFemale'] === true && <Chip tone="grow">♀ cái</Chip>}
            {st['isFemale'] === false && <Chip tone="chat">♂ đực</Chip>}
            {prime?.isPrime ? <Chip tone="grow">👑 Prime</Chip>
              : prime?.isEligible ? <Chip tone="accent">👑 Đủ ĐK Prime ({prime.doneCount}/10)</Chip>
                : prime?.hasData ? <Chip tone="neutral">Nhiệm vụ {prime.doneCount}/10</Chip> : null}
            {elder !== null && elder > 0 && <Chip tone="dmg">Elder x{elder}</Chip>}
            {admin && <Chip tone="kill">admin tạo</Chip>}
          </div>
        </div>
        {onDelete && <button type="button" className={s.iconBtn} title="Xoá khỏi gara" onClick={onDelete}><Icon name="trash" /></button>}
      </div>
      {state === null && <div className={s.warnbox}>Không đọc được file slot, chỉ còn thông tin trong index.</div>}
      {admin && <div className={s.muted} style={{ fontSize: 12 }}>Chỉ số để trống sẽ giữ nguyên giá trị của dino lúc người chơi lấy ra.</div>}
      <div className={s.vitals}>
        <VitalItem label="Tăng trưởng (Growth)" cur={g('growth') ?? meta.growth ?? null} max={1} growth color="linear-gradient(90deg, var(--grow), var(--chat))" emptyTip={emptyTip} />
        <VitalItem label="Máu (HP)" cur={g('health')} max={g('maxHealth')} color="var(--kill)" emptyTip={emptyTip} />
        <VitalItem label="Thể lực (Stamina)" cur={g('stamina')} max={g('maxStamina')} color="var(--dmg)" emptyTip={emptyTip} />
        <VitalItem label="Dạ dày (Đói)" cur={g('hunger')} max={g('maxHunger')} color="var(--accent-2)" emptyTip={emptyTip} />
        <VitalItem label="Nước (Khát)" cur={g('thirst')} max={g('maxThirst')} color="var(--chat)" emptyTip={emptyTip} />
        <VitalItem label="Oxy" cur={g('oxygen')} max={g('maxOxygen')} color="var(--gar)" emptyTip={emptyTip} />
        <VitalItem label="Huyết (Blood)" cur={g('blood')} max={g('maxBlood') ?? g('maxHealth')} color="#b91c1c" emptyTip={emptyTip} />
        {isNum(st['food']) && <VitalItem label="Thức ăn bụng" cur={g('food')} max={g('maxFoodValue')} color="var(--accent)" emptyTip={emptyTip} />}
        {isNum(st['waterLevel']) && <VitalItem label="Mức nước" cur={g('waterLevel')} max={100} color="var(--chat)" emptyTip={emptyTip} />}
      </div>
      <PrimeBox info={prime} />
      <details className={s.more} open={openMore}>
        <summary>Mutation, dinh dưỡng và chi tiết khác</summary>
        <div className={s.inner}>
          <MutationBlock muts={st['mutations'] as Record<string, string> | undefined} species={classPath.split('.').pop() ?? ''} />
          <div>
            <div className={s.groupLabel}>Dinh dưỡng</div>
            {hasNutrients ? <div className={s.kv}>{NUTRIENTS.map(([k, l]) => <KvItem key={k} label={l} v={nutrients[k]} max={100} />)}</div>
              : <span className={s.muted} style={{ fontSize: '12.5px' }}>không có dữ liệu</span>}
            {nutrients['bMalnutrition'] === true && <div className={s.warnbox} style={{ marginTop: 8 }}>Đang suy dinh dưỡng</div>}
          </div>
          <div className={s.kv}>
            <KvItem label="Elder stacks" v={st['elderStacks']} />
            <KvItem label="Damage khoá" v={st['lockedDamage']} />
            <KvItem label="Độ thối" v={st['rottenValue']} />
            <KvItem label="Schema" v={st['version']} />
          </div>
          <div style={{ fontSize: 12 }} className={s.muted}>classPath: <span className={s.mono} style={{ overflowWrap: 'anywhere' }}>{classPath}</span></div>
        </div>
      </details>
      <div className={s.foot}>
        <span>Cất {meta.capturedAt ? `${ago(meta.capturedAt)} · ${dateTime(meta.capturedAt)}` : 'không rõ lúc nào'}</span>
        {loc && isNum(loc.x) && <span>@ {num(loc.x)}, {num(loc.y)}, {num(loc.z)}</span>}
        <span>lấy ra trên web (slot <span className={s.mono}>{slot}</span>)</span>
      </div>
    </Card>
  );
}
