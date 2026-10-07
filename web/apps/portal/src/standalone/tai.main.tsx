import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/tai.css';
import { Tai } from './Tai';

// tai.html (React): inside the launcher there is nothing to download (rule: AGENTS.md "Launcher"): back home.
if ((window as unknown as { isleLauncher?: unknown }).isleLauncher) location.replace('/');
else createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><Tai /></StrictMode>);
