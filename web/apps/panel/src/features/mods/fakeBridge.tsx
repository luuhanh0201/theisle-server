import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@isle/ui';
import { SessionProvider } from '../../app/session';

/**
 * For the mods pages' tests: the bridge faked on fetch (/api/me as a Steam login with its token,
 * then `url` answering GET with `get()` and PUT through `put(body)`), and the page rendered in the
 * panel's providers. Returns the PUTs seen and the query client (to refetch by hand).
 */
export function fakeBridge(url: string, get: () => unknown, put: (body: any) => unknown) {
  const puts: Array<{ body: any; token: string | null }> = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (u === '/api/me') return json({ steamId: '76561198000000001', name: 'Dev', ip: '1.2.3.4', via: 'web', token: 'tok', perms: ['mods.view', 'mods.edit'], super: false });
    if (u === url && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      puts.push({ body, token: new Headers(init.headers).get('x-admin-token') });
      return json(put(body));
    }
    if (u === url) return json(get());
    return new Response('{}', { status: 404 });
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const show = (page: ReactNode) => render(
    <QueryClientProvider client={qc}><ToastProvider><SessionProvider>{page}</SessionProvider></ToastProvider></QueryClientProvider>,
  );
  return { puts, qc, show };
}
