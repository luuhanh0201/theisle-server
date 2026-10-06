import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@isle/ui';
import { SessionProvider } from '../app/session';
import { ConfirmProvider } from '../app/confirm';

/**
 * For a page's tests: the bridge faked on fetch (/api/me as a Steam login with its token,
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

/**
 * Several routes at once: `routes['GET /api/x']` / `routes['POST /api/y']` answer with a value or a
 * function of the body; every call is kept in `calls`. The page is rendered with the confirm dialog
 * too. /api/me is a super admin unless `routes['GET /api/me']` says otherwise.
 */
export function fakeApi(routes: Record<string, unknown | ((body: any) => unknown)>) {
  const calls: Array<{ method: string; url: string; body: any }> = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url: u, body });
    const key = `${method} ${u}`;
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (key === 'GET /api/me' && !(key in routes)) return json({ steamId: '76561198000000001', name: 'Dev', ip: null, via: 'web', token: 'tok', perms: ['*'], super: true });
    if (!(key in routes)) return json({ error: `not faked: ${key}` }, 404);
    const r = routes[key];
    return json(typeof r === 'function' ? (r as (b: any) => unknown)(body) : r);
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const show = (page: ReactNode) => render(
    <QueryClientProvider client={qc}><ToastProvider><SessionProvider><ConfirmProvider>{page}</ConfirmProvider></SessionProvider></ToastProvider></QueryClientProvider>,
  );
  return { calls, qc, show };
}
