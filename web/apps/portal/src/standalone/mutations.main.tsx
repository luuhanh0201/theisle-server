import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { retryImages } from '@isle/ui';
import '../styles/mutations.css';
import { Mutations } from './Mutations';

// A logo or icon that failed to load is fetched again, hidden meanwhile (never the broken-image icon).
retryImages();
// mutations.html (React): the public mutation guide.
createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><Mutations /></StrictMode>);
