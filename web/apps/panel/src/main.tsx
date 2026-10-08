import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { retryImages } from '@isle/ui';
import '@isle/ui/tokens.css';
import { App } from './app/App';

// A logo or icon that failed to load is fetched again, hidden meanwhile (never the broken-image icon).
retryImages();
const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root');
createRoot(root).render(<StrictMode><App /></StrictMode>);
