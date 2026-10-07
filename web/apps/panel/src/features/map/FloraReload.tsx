import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { adminFetch, getJson } from '@isle/api';
import { Button, useToast } from '@isle/ui';
import { useSession } from '../../app/session';
import type { Flora } from './data';
import { setFlora } from './load';
import { lm, useMapState } from './store';
import s from './Map.module.css';

/** Waiting for the mod's new read: about 40 s for the whole island, given up after 90. */
const POLL_MS = 3000;
const POLL_TRIES = 30;
const clock = (t: number): string => new Date(t * 1000).toLocaleTimeString('vi-VN', { hour12: false });

/**
 * "Tải lại" beside the map's layers: everything on the map fetched again now, and the plants read again by the
 * mod (POST /api/map/flora/refresh) instead of at its next ten minutes; the new plants drawn when they come.
 */
export function FloraReload() {
  useMapState();
  const qc = useQueryClient();
  const toast = useToast();
  const { withToken } = useSession();
  const [busy, setBusy] = useState(false);
  const plantsT = lm.flora?.plantsT ?? null;
  const go = (): void => {
    setBusy(true);
    void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && /^\/api\/(map|ai-zones|zone-guard)/.test(q.queryKey[0]) });
    void withToken('tải lại thực vật', async (token) => {
      const { plantsT: before } = await adminFetch<{ plantsT: number | null }>('/api/map/flora/refresh', 'POST', token);
      toast('Đang đọc lại cây trên đảo, khoảng 40 giây…');
      for (let i = 0; i < POLL_TRIES; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const { flora } = await getJson<{ flora: Flora | null }>('/api/map/flora');
        if (flora?.plantsT != null && flora.plantsT !== before) {
          setFlora(flora);
          qc.setQueryData(['/api/map/flora'], { flora });
          toast(`Đã tải lại: ${flora.plants.length} cây, ${flora.fruits.length} quả`);
          return;
        }
      }
      toast('Mod Flora chưa đọc lại sau 90 giây, server có đang chạy không?', 'err');
    }).finally(() => setBusy(false));
  };
  return (
    <span className={s.reload}>
      <Button small variant="ghost" onClick={go} disabled={busy}>{busy ? 'Đang tải lại…' : 'Tải lại'}</Button>
      {plantsT !== null && <span className={s.n}>cây đọc lúc {clock(plantsT)}</span>}
    </span>
  );
}
