import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getJson, type Me } from '@isle/api';
import { Dialog, TextInput, useToast } from '@isle/ui';
import type { Access } from './nav';

interface Session {
  me: Me | null;
  access: Access;
  /**
   * Run a write with the admin token: the login's own (Steam login), else asked once in a dialog
   * (through the SSH tunnel) and kept in this tab's memory only. A failure becomes a red toast
   * prefixed with `label`; the promise then resolves to false.
   */
  withToken: (label: string, fn: (token: string) => Promise<void>) => Promise<boolean>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => getJson<Me>('/api/me'), staleTime: 5 * 60_000 });
  const me = meQuery.data ?? null;
  const typed = useRef('');
  const [ask, setAsk] = useState<{ label: string; resolve: (token: string | null) => void } | null>(null);
  const [askValue, setAskValue] = useState('');

  const access = useMemo<Access>(() => (me === null ? { perms: null, super: false } : { perms: new Set(me.perms), super: me.super }), [me]);

  const tokenFor = useCallback((label: string): Promise<string | null> => {
    if (me?.token) return Promise.resolve(me.token);
    if (typed.current) return Promise.resolve(typed.current);
    return new Promise((resolve) => { setAskValue(''); setAsk({ label, resolve }); });
  }, [me]);

  const withToken = useCallback(async (label: string, fn: (token: string) => Promise<void>): Promise<boolean> => {
    const token = await tokenFor(label);
    if (token === null) return false;
    try {
      await fn(token);
      if (!me?.token) typed.current = token;
      return true;
    } catch (err) {
      if (!me?.token && /token/i.test((err as Error).message)) typed.current = '';
      toast(`${label}: ${(err as Error).message}`, 'err');
      return false;
    }
  }, [tokenFor, me, toast]);

  const value = useMemo(() => ({ me, access, withToken }), [me, access, withToken]);
  return (
    <SessionContext.Provider value={value}>
      {children}
      <Dialog open={ask !== null} title="Admin token" okLabel="Tiếp tục"
        onOk={() => { ask?.resolve(askValue.trim() || null); setAsk(null); }}
        onClose={() => { ask?.resolve(null); setAsk(null); }}>
        <p style={{ margin: '0 0 10px' }}>Nhập admin token để <b>{ask?.label}</b>. Token chỉ được nhớ trong tab này.</p>
        <TextInput type="password" autoFocus value={askValue} onChange={(e) => setAskValue(e.target.value)} aria-label="Admin token" />
      </Dialog>
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (s === null) throw new Error('useSession: no SessionProvider above');
  return s;
}
