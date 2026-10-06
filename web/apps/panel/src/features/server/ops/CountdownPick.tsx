import { useState, type MutableRefObject } from 'react';
import { Select } from '@isle/ui';
import { COUNTDOWNS } from './labels';

/** "Báo trước cho người chơi" inside a confirm dialog: the choice is kept in `pick` for its run(). */
export function CountdownPick({ pick, id }: { pick: MutableRefObject<number>; id: string }) {
  const [v, setV] = useState(String(pick.current));
  return (
    <div style={{ marginTop: 12 }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Báo trước cho người chơi</label>
      <Select id={id} value={v} options={COUNTDOWNS} onChange={(x) => { setV(x); pick.current = Number(x); }} />
    </div>
  );
}
