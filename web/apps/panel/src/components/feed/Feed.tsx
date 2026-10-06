import { useRef, useState } from 'react';
import { Icon, type IconName } from '@isle/ui';
import { useMutationData } from '../../features/mutations/useMutationData';
import { clock, dateTime, num } from '../../lib/format';
import { EV, EV_LABEL, describe, valueOf, type FeedEvent } from './describe';
import { KillScene } from './KillScene';
import s from './Feed.module.css';

/**
 * The game's log as columns (Giờ | icon | Loại | Nội dung | Giá trị), one line per event; a line
 * newer than the ones shown before slides in. A death with a place has a 📍: its scene.
 */
export function Feed({ events, empty = 'Chưa có sự kiện', tall = false }: { events: FeedEvent[]; empty?: string; tall?: boolean }) {
  const { data: ref } = useMutationData();
  const [scene, setScene] = useState<FeedEvent | null>(null);
  // The highest id shown before: only newer rows animate.
  const seen = useRef<number | null>(null);
  const prev = seen.current;
  if (events.length > 0) seen.current = Math.max(...events.map((e) => e.id));
  const today = new Date().toDateString();
  const btn = (e: FeedEvent) => (e.loc ? <> · <button type="button" className={s.sceneBtn} title="Xem bản đồ lúc chết và người xung quanh" onClick={() => setScene(e)}>📍 {num(e.loc.x)}, {num(e.loc.y)}</button></> : null);
  return (
    <>
      <ul className={`${s.feed}${tall ? ` ${s.tall}` : ''}`}>
        {events.length === 0 ? <li className={s.empty}>{empty}</li> : (
          <>
            <li className={s.head} aria-hidden="true"><span>Giờ</span><span /><span className={s.kind}>Loại</span><span>Nội dung</span><span className={s.val}>Giá trị</span></li>
            {events.map((e) => {
              const [ic, tone] = EV[e.type] ?? ['warn', 'tone-neutral'];
              const [main, meta] = describe(e, ref, btn);
              const d = new Date(e.t * 1000);
              return (
                <li key={e.id} className={prev !== null && e.id > prev ? s.new : undefined}>
                  <span className={s.time} title={dateTime(e.t)}>{clock(e.t)}{d.toDateString() !== today && <small>{d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</small>}</span>
                  <span className={`${s.ico} ${s[tone]}`}><Icon name={ic as IconName} /></span>
                  <span className={s.kind}>{EV_LABEL[e.type] ?? e.type}</span>
                  <div className={s.body}>{main}{meta ? <div className={s.meta}>{meta}</div> : null}</div>
                  <span className={s.val}>{valueOf(e)}</span>
                </li>
              );
            })}
          </>
        )}
      </ul>
      {scene && <KillScene entry={scene} onClose={() => setScene(null)} />}
    </>
  );
}
