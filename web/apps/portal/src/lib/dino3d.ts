import { useEffect, useState } from 'react';

/** window.Dino3D (portal /skin3d.js): the game's models, painted as a skin. */
export interface Dino3DViewer { show: (species: string, skin: unknown) => Promise<boolean> }
export interface Dino3DApi {
  ready: Promise<unknown>; species: () => string[];
  create: (host: HTMLElement, opts: Record<string, unknown>) => Dino3DViewer;
  fromGame: (skin: unknown) => unknown;
}
// The panel declares window.Dino3D with its own (smaller) shape: read it through this.
const w = (): Dino3DApi | null => (window as unknown as { Dino3D?: Dino3DApi }).Dino3D ?? null;

let loading: Promise<Dino3DApi | null> | null = null;
/** The viewer, loaded once when a page first needs it (the site before React loaded it with every page). */
export function loadDino3D(): Promise<Dino3DApi | null> {
  if (loading) return loading;
  // No model list (a copy without the portal's dino3d/): no viewer, the box stays hidden.
  loading = import(/* @vite-ignore */ `${'/skin3d.js'}`).then(async () => {
    const api = w();
    await api?.ready;
    return api && api.species().length > 0 ? api : null;
  }).catch(() => null);
  return loading;
}
export function useDino3D(on: boolean): Dino3DApi | null {
  const [api, setApi] = useState<Dino3DApi | null>(w);
  useEffect(() => {
    if (!on || api) return undefined;
    let live = true;
    void loadDino3D().then((a) => { if (live) setApi(a); });
    return () => { live = false; };
  }, [on, api]);
  return api;
}
