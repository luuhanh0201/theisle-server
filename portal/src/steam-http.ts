import { request } from 'node:https';
import { Resolver, promises as dns } from 'node:dns';

/**
 * The call to Steam that confirms a login (OpenID check_authentication),
 * made robust against a bad route between this VPS and some of Steam's CDN
 * addresses. Measured 2026-09-25: from the VPS, 8 of 12 connections to the
 * address the local DNS gave (23.197.225.27) never connected, while another
 * Steam address (104.89.122.116) answered 5 of 5. A single fetch with a 10 s
 * timeout therefore failed most logins ("Steam did not answer").
 *
 * So: know several Steam addresses (the system's DNS plus public resolvers),
 * give each attempt 3 s to connect, move on to the next address when it does
 * not, and try the one that worked last time first. TLS still checks the
 * certificate for steamcommunity.com, whichever address answers.
 */

const HOST = 'steamcommunity.com';
const RESOLVERS = ['1.1.1.1', '8.8.8.8', '9.9.9.9'];
const REFRESH_MS = 10 * 60_000;
const CONNECT_MS = 3_000;
const RESPONSE_MS = 8_000;
const ATTEMPTS = 5;

export interface SteamResponse { text(): Promise<string> }
export type SteamPost = (url: string, init: {
  method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal;
}) => Promise<SteamResponse>;

let addresses: string[] = [];
let resolvedAt = 0;
let lastGood: string | null = null;

async function lookupAll(): Promise<string[]> {
  const found = new Set<string>();
  const add = (ips: string[]) => { for (const ip of ips) found.add(ip); };
  const jobs: Array<Promise<void>> = [dns.resolve4(HOST).then(add, () => {})];
  for (const server of RESOLVERS) {
    const r = new Resolver({ timeout: 2_000, tries: 1 });
    r.setServers([server]);
    jobs.push(new Promise((done) => r.resolve4(HOST, (err, ips) => { if (!err) add(ips); done(); })));
  }
  await Promise.all(jobs);
  return [...found];
}

/** Steam's addresses, the last one that worked first. */
async function candidates(now = Date.now()): Promise<string[]> {
  if (addresses.length === 0 || now - resolvedAt > REFRESH_MS) {
    const fresh = await lookupAll();
    if (fresh.length > 0) { addresses = fresh; resolvedAt = now; }
  }
  const list = [...addresses];
  if (lastGood && list.includes(lastGood)) list.sort((a, b) => Number(b === lastGood) - Number(a === lastGood));
  return list;
}

function postTo(ip: string, url: URL, init: Parameters<SteamPost>[1]): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: url.hostname, path: `${url.pathname}${url.search}`, method: init.method, headers: init.headers,
      agent: false,   // a fresh connection to THIS address (a pooled one could be to another)
      // This address, for this host name: SNI and the certificate stay steamcommunity.com.
      // (Node asks with { all: true } for a list — its "happy eyeballs" — or for one address.)
      lookup: (_host, opts, cb) => {
        if ((opts as { all?: boolean }).all) (cb as unknown as (e: Error | null, a: Array<{ address: string; family: number }>) => void)(null, [{ address: ip, family: 4 }]);
        else (cb as (e: Error | null, a: string, f: number) => void)(null, ip, 4);
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    const connectTimer = setTimeout(() => req.destroy(new Error(`no connection to ${ip} within ${CONNECT_MS} ms`)), CONNECT_MS);
    req.on('socket', (sock) => sock.once('secureConnect', () => {
      clearTimeout(connectTimer);
      req.setTimeout(RESPONSE_MS, () => req.destroy(new Error(`${ip} did not answer within ${RESPONSE_MS} ms`)));
    }));
    req.on('error', (err) => { clearTimeout(connectTimer); reject(err); });
    init.signal?.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true });
    req.end(init.body);
  });
}

/** POST to Steam, trying its addresses in turn. */
export const steamPost: SteamPost = async (url, init) => {
  const target = new URL(url);
  const ips = await candidates();
  if (ips.length === 0) throw new Error(`cannot resolve ${HOST}`);
  const errors: string[] = [];
  for (let i = 0; i < ATTEMPTS; i++) {
    const ip = ips[i % ips.length] as string;
    try {
      const body = await postTo(ip, target, init);
      lastGood = ip;
      return { text: async () => body };
    } catch (err) {
      errors.push((err as Error).message);
      if (lastGood === ip) lastGood = null;
      if (init.signal?.aborted) break;
    }
  }
  throw new Error(errors.join('; '));
};
