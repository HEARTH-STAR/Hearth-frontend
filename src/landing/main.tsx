import React from 'react';
import { createRoot } from 'react-dom/client';
import { Landing } from './Landing';
import './landing.css';
import { watchSystemTheme } from '../client/theme';
import { browserStorage, markWelcomed } from '../client/first-visit';
// Seen once is enough: from now on the app's front door opens the app.
markWelcomed(browserStorage());
watchSystemTheme();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Landing />
  </React.StrictMode>,
);
