import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/base.css';
import './styles/browser.css';
import './styles/chat.css';
import { setPace } from './timing';

// Réglage du système "réduire les animations" : les gestes ne sont plus joués, les pages s'affichent directement.
if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setPace(0);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
