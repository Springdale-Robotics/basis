import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { installOnlineListener } from './lib/offline/sync';
import './index.css';

// Service worker — auto-updates in the background. The vite-plugin-pwa
// virtual:pwa-register module is provided by the plugin at build time.
registerSW({ immediate: true });

// Boot the drain-on-online listener so queued mutations replay when the
// network comes back even without an active list page open.
installOnlineListener();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
