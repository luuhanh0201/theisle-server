import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { retryImages } from '@isle/ui';
import './styles/portal.css';
import './styles/tokens.css';
import { App, queryClient } from './app/App';
import { isLab } from './lib/lab';
import { inLauncher } from './lib/launcher';
import { startOverlay } from './lib/overlay';
import { startVoice } from './lib/voice';

const html = document.documentElement;
/**
 * html.in-launcher: off, as on the live site before React. Its <head> script set it, but the portal's CSP
 * (script-src 'self', no inline) has always refused that script, so inside the launcher players get the
 * page as on the web, less what app.js hides (the download links): no launcher hub on Trang chủ, the server
 * status, features and rules shown. Turning it on shows the hub and hides those (portal.css html.in-launcher):
 * a change the owner decides (web/PORTAL-MIGRATION.md). The download links are not drawn in the launcher either way.
 */
export const MARK_IN_LAUNCHER = false;
if (inLauncher()) {
  if (MARK_IN_LAUNCHER) html.classList.add('in-launcher');
  // The window often sits behind the game: while it is not focused, looping CSS animations pause
  // (html.app-idle), so the launcher draws only when data changes.
  const idle = (): void => { html.classList.toggle('app-idle', !document.hasFocus() || document.hidden); };
  window.addEventListener('focus', idle);
  window.addEventListener('blur', idle);
  document.addEventListener('visibilitychange', idle);
  idle();
}
html.classList.toggle('lab', isLab());

// One page load, for the panel's "Truy cập" (web or the launcher: told by the portal from the user agent).
try { navigator.sendBeacon?.('/api/track/view', '{}'); } catch { /* not counted */ }

// Proximity voice for the whole visit (voice.js before React loaded with the page): the keys, the launcher's
// push-to-talk, window.isleVoice; the room is joined from Voice and stays on every page.
startVoice();
// The launcher's overlay (its widgets' data, the mini map, the big map), whatever page is shown.
startOverlay(queryClient);

// A logo or icon that failed to load is fetched again, hidden meanwhile (never the broken-image icon).
retryImages();

const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root');
createRoot(root).render(<StrictMode><App /></StrictMode>);
