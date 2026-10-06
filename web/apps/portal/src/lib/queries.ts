import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PlayerMe, PortalServer } from '@isle/api';
import { portalGet } from './http';
import { gameMode, inBackground, inLauncher } from './launcher';

/**
 * The refresh loop (app.js part 5) as queries: /api/me every second, /api/server every 15 s. In the
 * launcher the data keeps coming every second in the background (the overlay and voice need it)
 * even while the page is hidden, hence refetchIntervalInBackground there.
 */
export const ME = '/api/me';
export const SERVER = '/api/server';

export function useMeQuery() {
  return useQuery({
    queryKey: [ME], queryFn: () => portalGet<PlayerMe>(ME),
    refetchInterval: 1000, refetchIntervalInBackground: inLauncher(), staleTime: 500,
  });
}

/** The server card and the menu's slots (name, Discord, online / max): undefined before the first answer, null when down. */
export function useServer(): PortalServer | null | undefined {
  return useQuery({
    queryKey: [SERVER],
    // A refusal (the bridge down): the page shows "Server đang tắt" rather than an error.
    queryFn: async () => { try { return await portalGet<PortalServer>(SERVER); } catch { return null; } },
    refetchInterval: 15_000, staleTime: 10_000,
  }).data;
}

/** How often the page redraws while the launcher sits behind the game (app.js BACKGROUND_DRAW_MS). */
export const BACKGROUND_DRAW_MS = 5000;

/**
 * The player as the page draws it: every new answer, but in the launcher's background only every 5 s,
 * and never in game mode (nobody looks at the page; coming back to the launcher redraws at once).
 * undefined = not read yet, null = not logged in.
 */
export function useMe(): PlayerMe | null | undefined {
  const { data } = useMeQuery();
  const [drawn, setDrawn] = useState(data);
  const last = useRef(0);
  useEffect(() => {
    if (data === undefined) return;
    if (!inBackground() || (!gameMode().now().on && Date.now() - last.current >= BACKGROUND_DRAW_MS)) {
      last.current = Date.now();
      setDrawn(data);
    }
  }, [data]);
  useEffect(() => {
    if (!inLauncher()) return undefined;
    const back = (): void => { last.current = 0; };
    window.addEventListener('focus', back);
    return () => window.removeEventListener('focus', back);
  }, []);
  return data !== undefined && drawn === undefined ? data : drawn;
}
