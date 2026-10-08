import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { retryImages } from '@isle/ui';
import '../styles/launcher-done.css';
import { LauncherDone } from './LauncherDone';

// A logo or icon that failed to load is fetched again, hidden meanwhile (never the broken-image icon).
retryImages();
// launcher-done.html (React): the end of the launcher's Steam login, in the player's browser.
createRoot(document.getElementById('root') as HTMLElement)
  .render(<StrictMode><LauncherDone error={new URLSearchParams(location.search).get('error')} /></StrictMode>);
