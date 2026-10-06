import { ApiError } from '@isle/api';

/**
 * How the player site talks to the portal server (portal/src/server.ts): same origin, the session
 * cookie. Not logged in is not an error here (the site works without a login): a 401 is null.
 */
export async function portalGet<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (res.status === 401) return null;
  const body = (await res.json().catch(() => null)) as (T & { error?: unknown }) | null;
  if (!res.ok) throw new ApiError(res.status, String(body?.error ?? `HTTP ${res.status}`));
  return body as T;
}

/** A write (same-origin JSON, as the portal requires); the server's error text on a refusal. */
export async function portalPost<T>(url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: unknown };
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? `HTTP ${res.status}`));
  return data;
}
