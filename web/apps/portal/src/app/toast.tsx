import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

/** The site's one toast (.portal-toast, as before React: 2.2 s, then fades). */
const Ctx = createContext<(msg: string) => void>(() => undefined);
export const useToast = (): ((msg: string) => void) => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const toast = useCallback((m: string) => {
    setMsg(m);
    setShow(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setShow(false);
      timer.current = window.setTimeout(() => setMsg(null), 200);
    }, 2200);
  }, []);
  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className={`portal-toast${show ? ' show' : ''}`} id="global-toast" role="status" hidden={msg === null}>{msg}</div>
    </Ctx.Provider>
  );
}

/** Copy a text, say so (a prompt to copy by hand where the clipboard is refused). */
export async function copyText(text: string, toast: (m: string) => void): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Đã sao chép: ${text}`);
    return true;
  } catch {
    window.prompt('Nhấn Ctrl+C để sao chép lệnh:', text);
    return false;
  }
}
