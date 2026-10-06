import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { loadDino3D, type Dino3DApi, type Dino3DViewer } from '../../lib/dino3d';

/** The editor's 3D view as it stands: the species to pick from, the one shown, whether the model is up. */
export interface SkinViewer {
  /** null: still loading; [] : no model on the server (the colours side by side). */
  names: string[] | null;
  chosen: string | null;
  /** The species of the dino played now, marked "· đang chơi" in the menu. */
  liveName: string | null;
  shown: boolean;
  pick: (name: string) => void;
}

/**
 * Skin Studio's 3D preview (skin3d.js's editor part, driven from React: the old one bound itself to
 * #skin-species, which the React page does not have). The viewer is made once the models load; it
 * shows the dino played now (a new species or sex is shown at once, over what was picked) and
 * otherwise the first species. `skin` repaints it, `female` sets the sex.
 */
export function useSkinViewer({ host, note, skin, female, live, onLiveFemale }: {
  host: RefObject<HTMLDivElement | null>; note: RefObject<HTMLSpanElement | null>;
  skin: unknown; female: boolean;
  /** The dino played now (in game), or null. */
  live: { species: string; female: boolean | undefined } | null;
  onLiveFemale: (f: boolean) => void;
}): SkinViewer {
  const [api, setApi] = useState<Dino3DApi | null | undefined>(undefined);
  const viewer = useRef<Dino3DViewer | null>(null);
  const [names, setNames] = useState<string[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [liveName, setLiveName] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const liveKey = useRef<string | null>(null);
  const started = useRef(false);
  const turn = useRef(0);
  const skinNow = useRef(skin);
  skinNow.current = skin;
  const femaleNow = useRef(female);
  femaleNow.current = female;

  // Nothing is loaded until the page is opened (it mounts on its first visit).
  useEffect(() => {
    let on = true;
    void loadDino3D().then((a) => { if (on) setApi(a); });
    return () => { on = false; };
  }, []);
  useEffect(() => {
    if (api === undefined) return;
    if (api === null || !host.current) {
      if (note.current) note.current.textContent = 'Chưa có mô hình 3D trên server, xem màu theo từng ô.';
      setNames([]);
      return;
    }
    viewer.current = api.create(host.current, { note: note.current });
    viewer.current.setFemale?.(femaleNow.current);
    setNames([...api.species()].sort());
  }, [api, host, note]);

  const speciesOf = useCallback((raw: string): string | null => {
    const n = api?.speciesOf ? api.speciesOf(raw) : raw;
    return n && names?.includes(n) ? n : null;
  }, [api, names]);

  const pick = useCallback((name: string): void => {
    const v = viewer.current;
    if (!v || !names?.includes(name)) return;
    setChosen(name);
    const my = ++turn.current;
    void v.show(name, skinNow.current).then((ok) => { if (my === turn.current) setShown(ok); });
  }, [names]);

  const liveSpecies = live?.species ?? null;
  const liveFemale = live?.female;
  useEffect(() => {
    if (!names || names.length === 0 || !viewer.current) return;
    const follow = (raw: string, f: boolean | undefined): void => {
      const name = speciesOf(raw);
      setLiveName(name);
      const key = `${name}|${f === true}`;
      if (!name || key === liveKey.current) return;
      liveKey.current = key;
      if (typeof f === 'boolean') onLiveFemale(f);
      pick(name);
    };
    if (!started.current) {
      started.current = true;
      if (liveSpecies && speciesOf(liveSpecies)) follow(liveSpecies, liveFemale);
      else if (names[0]) pick(names[0]);
      return;
    }
    // Only while a dino is played (the site before React followed it from Dino Live's data).
    if (liveSpecies) follow(liveSpecies, liveFemale);
  }, [names, liveSpecies, liveFemale, speciesOf, pick, onLiveFemale]);

  useEffect(() => { viewer.current?.setSkin?.(skin); }, [skin]);
  useEffect(() => { viewer.current?.setFemale?.(female); }, [female]);

  return { names, chosen, liveName, shown, pick };
}
