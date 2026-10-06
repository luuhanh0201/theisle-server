/**
 * How every page talks to the bridge: same origin, the panel's login cookie; writes carry the
 * admin token (x-admin-token, from /api/me). A 401 means the login ended: back to the login page.
 */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Where a page goes when the login has ended (the bridge's own login page). */
export const LOGIN_URL = '/login?e=expired';
let toLogin = (): void => { location.href = LOGIN_URL; };
/** For tests: what happens on a 401 instead of leaving the page. */
export function onLoginEnded(fn: () => void): void { toLogin = fn; }

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  try { return (await res.json()) as Record<string, unknown>; } catch { return {}; }
}

/** GET a JSON route of the bridge. */
export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 401) { toLogin(); throw new ApiError(401, 'Phiên đăng nhập đã hết, đăng nhập lại'); }
  if (!res.ok) throw new ApiError(res.status, String((await bodyOf(res))['error'] ?? `HTTP ${res.status}`));
  return (await res.json()) as T;
}

/** A write (PUT / POST / DELETE) with the admin token; the bridge's error text on a refusal. */
export async function adminFetch<T>(url: string, method: 'POST' | 'PUT' | 'DELETE', token: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-admin-token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) { toLogin(); throw new ApiError(401, 'Phiên đăng nhập đã hết, đăng nhập lại'); }
  const data = await bodyOf(res);
  if (!res.ok) throw new ApiError(res.status, String(data['error'] ?? `HTTP ${res.status}`));
  return data as T;
}
