import { assertConfig, config } from './config.js';
import { BridgeClient } from './bridge-client.js';
import { createPortal } from './server.js';

assertConfig();

const server = createPortal({
  baseUrl: config.baseUrl,
  secureCookies: config.secureCookies,
  sessionSecret: config.sessionSecret,
  sessionDays: config.sessionDays,
  trustProxy: config.trustProxy,
  bridge: new BridgeClient(config.bridgeUrl, config.portalToken),
});

server.listen(config.http.port, config.http.host, () => {
  console.info(`[portal] listening on http://${config.http.host}:${config.http.port} as ${config.baseUrl}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { server.close(); process.exit(0); });
}
