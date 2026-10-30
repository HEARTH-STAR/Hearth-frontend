import React from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import { App } from './App';
import './style.css';
import './editor.css';
import { watchSystemTheme } from './theme';
watchSystemTheme();
const root = createRoot(document.getElementById('root')!);
// The server hands out its Clerk publishable key, so one build serves any Clerk instance.
fetch('/api/auth/config')
  .then((response) => response.json() as Promise<{ publishableKey?: string }>)
  .then(({ publishableKey }) => {
    if (!publishableKey) throw new Error('No Clerk publishable key.');
    root.render(
      <React.StrictMode>
        <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
          <App />
        </ClerkProvider>
      </React.StrictMode>,
    );
  })
  .catch(() =>
    root.render(
      <main className="unlock">
        <h1>Hearth is not reachable.</h1>
        <p>The server did not answer. Reload the page to try again.</p>
      </main>,
    ),
  );
