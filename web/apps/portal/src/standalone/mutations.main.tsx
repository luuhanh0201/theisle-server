import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/mutations.css';
import { Mutations } from './Mutations';

// mutations.html (React): the public mutation guide.
createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><Mutations /></StrictMode>);
