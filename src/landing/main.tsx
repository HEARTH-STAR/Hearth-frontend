import React from 'react';
import { createRoot } from 'react-dom/client';
import { Landing } from './Landing';
import './landing.css';
import { watchSystemTheme } from '../client/theme';
watchSystemTheme();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Landing />
  </React.StrictMode>,
);
