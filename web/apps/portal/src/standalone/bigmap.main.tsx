import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/tokens.css';
import '../styles/bigmap.css';
import { BigMap } from './BigMap';

// bigmap.html (React): the launcher's big map window (its key, M).
createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><BigMap /></StrictMode>);
