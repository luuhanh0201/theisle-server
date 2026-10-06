import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/portal.css';
import './styles/tokens.css';
import { App } from './app/App';
import { isLab } from './lib/lab';
import { inLauncher } from './lib/launcher';

const html = document.documentElement;
// Inside Xóm Gáy Launcher: html.in-launcher (CSS), and nothing about downloading the launcher.
if (inLauncher()) {
  html.classList.add('in-launcher');
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

const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root');
createRoot(root).render(<StrictMode><App /></StrictMode>);
