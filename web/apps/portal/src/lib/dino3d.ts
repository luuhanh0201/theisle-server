import { useEffect, useState } from 'react';

/** window.Dino3D (portal /skin3d.js): the game's models, painted as a skin. */
export interface Dino3DViewer {
  show: (species: string, skin: unknown) => Promise<boolean>;
  /** The skin editor's viewer (Skin Studio): repaint with a new skin, the sex. */
  setSkin?: (skin: unknown) => void; setFemale?: (female: boolean) => void;
}
export interface Dino3DApi {
  ready: Promise<unknown>; species: () => string[];
  create: (host: HTMLElement, opts: Record<string, unknown>) => Dino3DViewer;
  fromGame: (skin: unknown) => unknown;
  /** A class or a name ("BP_Tyrannosaurus_C") → the registry name with a model, or null. */
  speciesOf?: (raw: string) => string | null;
}
// The panel declares window.Dino3D with its own (smaller) shape: read it through this.
const w = (): Dino3DApi | null => (window as unknown as { Dino3D?: Dino3DApi }).Dino3D ?? null;
/** window.Dino3D as it is now (set once skin3d.js ran, even when the server has no model list). */
export const dino3dNow = w;

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
