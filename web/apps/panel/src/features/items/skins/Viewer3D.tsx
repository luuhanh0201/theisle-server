import { useEffect, useRef, useState } from 'react';

/** window.Dino3D (portal /skin3d.js): the game's models, painted as a skin. */
export interface Dino3DViewer { show: (species: string, skin: SkinPreview) => Promise<unknown>; setSkin: (skin: SkinPreview) => void; setFemale: (f: boolean) => void }
interface Dino3DApi { ready: Promise<unknown>; species: () => string[]; create: (host: HTMLElement, opts: { note: HTMLElement }) => Dino3DViewer }
export interface SkinPreview { colors: Record<string, string>; light: Record<string, number>; brightness: number; female: boolean }
declare global { interface Window { Dino3D?: Dino3DApi } }

let loading: Promise<Dino3DApi | null> | null = null;
/** The portal's viewer, loaded once and only when a page needs it (the bridge serves it from the portal's folder). */
export function loadDino3D(): Promise<Dino3DApi | null> {
  // No model list (the registry missing, e.g. a copy without the portal's dino3d/): no viewer.
  loading ??= import(/* @vite-ignore */ `${'/skin3d.js'}`).then(async () => {
    await window.Dino3D?.ready;
    return window.Dino3D && window.Dino3D.species().length > 0 ? window.Dino3D : null;
  }).catch(() => null);
  return loading;
}
/** The species that have a model, once loaded. */
export function useDino3D(): { api: Dino3DApi | null; loaded: boolean } {
  const [st, setSt] = useState<{ api: Dino3DApi | null; loaded: boolean }>({ api: null, loaded: false });
  useEffect(() => { let on = true; void loadDino3D().then((api) => { if (on) setSt({ api, loaded: true }); }); return () => { on = false; }; }, []);
  return st;
}

// One viewer for the panel (one WebGL context): its element moves into the page each time it opens.
let shared: { host: HTMLDivElement; note: HTMLDivElement; viewer: Dino3DViewer } | null = null;

/** The 3D dino in its colours; `skin` repaints it, `species` loads another model. */
export function Viewer3D({ api, loaded, species, skin, className, noteClass, children }: {
  api: Dino3DApi | null; loaded: boolean; species: string; skin: SkinPreview; className: string; noteClass: string; children?: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const skinRef = useRef(skin);
  skinRef.current = skin;
  useEffect(() => {
    if (!api || !box.current) return;
    if (!shared) {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;inset:0';
      const note = document.createElement('div');
      note.className = noteClass;
      shared = { host, note, viewer: api.create(host, { note }) };
    }
    box.current.prepend(shared.host);
    box.current.append(shared.note);
  }, [api, noteClass]);
  useEffect(() => {
    if (!shared || !api) return;
    const v = shared.viewer;
    void v.show(species, skinRef.current).then(() => v.setSkin(skinRef.current)).catch(() => undefined);
  }, [api, species]);
  useEffect(() => { shared?.viewer.setSkin(skin); shared?.viewer.setFemale(skin.female); }, [skin]);
  return (
    <div ref={box} className={className}>
      {children}
      {loaded && !api && <div className={noteClass}>Chưa tải được mô hình 3D (thư mục portal trên server).</div>}
    </div>
  );
}
