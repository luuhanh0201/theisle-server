import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * The menu's two states, as before React (app.js initSidebar): collapsed on a wide screen (body
 * .sidebar-collapsed, remembered as xg.sidebar_collapsed), and the drawer on a phone (.drawer-open).
 */
interface Drawer { open: boolean; setOpen: (v: boolean) => void; collapsed: boolean; setCollapsed: (v: boolean) => void }
const Ctx = createContext<Drawer>({ open: false, setOpen: () => undefined, collapsed: false, setCollapsed: () => undefined });
export const useDrawer = (): Drawer => useContext(Ctx);

const KEY = 'xg.sidebar_collapsed';
function readCollapsed(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function DrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setC] = useState(readCollapsed);
  useEffect(() => { document.body.classList.toggle('sidebar-collapsed', collapsed); }, [collapsed]);
  const setCollapsed = useCallback((v: boolean) => {
    setC(v);
    try { if (v) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* not kept */ }
  }, []);
  const value = useMemo(() => ({ open, setOpen, collapsed, setCollapsed }), [open, collapsed, setCollapsed]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
