import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';
import './editor.css';
import { watchSystemTheme } from './theme';
import { browserStorage, welcomeRedirect } from './first-visit';
// A browser's first visit to the front door shows the landing page instead.
const welcome = welcomeRedirect(location, browserStorage());
if (welcome) location.replace(welcome);
else {
  watchSystemTheme();
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
