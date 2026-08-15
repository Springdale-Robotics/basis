import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installOnlineListener } from './lib/offline/sync';
import { installConsoleBuffer } from './lib/consoleBuffer';
import './index.css';

// Capture console output before anything else logs, so bug reports include
// the earliest boot messages.
installConsoleBuffer();

// The service worker is registered by <UpdatePrompt />, which needs the
// registration to poll for new builds and to offer the reload banner. Doing it
// here as well would register twice.

// Boot the drain-on-online listener so queued mutations replay when the
// network comes back even without an active list page open.
installOnlineListener();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
