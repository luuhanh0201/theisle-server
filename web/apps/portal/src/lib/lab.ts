/**
 * Test mode ("lab"): features not released to players yet (skin effects, glow, kept colours, the 3D
 * on Dino Live) show only in a browser opened once with ?lab=1 (remembered; ?lab=0 turns it off).
 * The same key as the site before React (xg.lab).
 */
export function readLab(search: string = location.search): boolean {
  try {
    const q = new URLSearchParams(search).get('lab');
    if (q === '1') localStorage.setItem('xg.lab', '1');
    if (q === '0') localStorage.removeItem('xg.lab');
    return localStorage.getItem('xg.lab') === '1';
  } catch { return false; }
}

let lab: boolean | null = null;
export const isLab = (): boolean => (lab ??= readLab());
