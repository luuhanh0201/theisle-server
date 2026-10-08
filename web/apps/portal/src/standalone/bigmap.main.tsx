import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { retryImages } from '@isle/ui';
import '../styles/tokens.css';
import '../styles/bigmap.css';
import { BigMap } from './BigMap';

// A logo or icon that failed to load is fetched again, hidden meanwhile (never the broken-image icon).
retryImages();
// bigmap.html (React): the launcher's big map window (its key, M).
createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><BigMap /></StrictMode>);
