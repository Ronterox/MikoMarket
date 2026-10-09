import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { MikoGallery } from './miko/MikoGallery.tsx';
import './styles/tokens.css';
import './styles/app.css';

const overlay = document.createElement('div');
overlay.id = 'overlay-root';
document.body.appendChild(overlay);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.search.includes('miko-gallery') ? <MikoGallery /> : <App />}
  </StrictMode>,
);
