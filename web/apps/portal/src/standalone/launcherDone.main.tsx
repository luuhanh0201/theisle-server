import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/launcher-done.css';
import { LauncherDone } from './LauncherDone';

// launcher-done.html (React): the end of the launcher's Steam login, in the player's browser.
createRoot(document.getElementById('root') as HTMLElement)
  .render(<StrictMode><LauncherDone error={new URLSearchParams(location.search).get('error')} /></StrictMode>);
