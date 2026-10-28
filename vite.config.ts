import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { darkTheme } from './src/build/dark-theme';
// /welcome without the slash would fall back to the app; send it to the landing page.
// The production server does the same in src/server/index.ts.
const welcomeRedirect: Plugin = {
  name: 'hearth-welcome-redirect',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const [path, query] = (req.url ?? '').split('?');
      if (path !== '/welcome') return next();
      res.statusCode = 301;
      res.setHeader('Location', `/welcome/${query ? `?${query}` : ''}`);
      res.end();
    });
  },
};
export default defineConfig({
  plugins: [react(), welcomeRedirect],
  css: { postcss: { plugins: [darkTheme()] } },
  build: {
    outDir: 'dist/client',
    // Two pages: the app (/) and the public landing page (/welcome/).
    rollupOptions: { input: ['index.html', 'welcome/index.html'] },
  },
  server: {
    strictPort: true,
    host: '127.0.0.1',
    // ws: the Computer panel's terminal is a WebSocket under /api.
    proxy: { '/api': { target: 'http://127.0.0.1:4310', ws: true } },
  },
});
