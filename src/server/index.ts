import { createShutdown } from './shutdown.js';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { dirname, join } from 'node:path';
import { Store } from './store.js';
import { createApp } from './app.js';
import { resolveAppOrigins } from './app-origin.js';
import { configFromEnv } from './config.js';
import { WorkspaceStore } from './workspace.js';
import { Platform } from './platform.js';
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4310);
const config = configFromEnv(process.env);
if (
  !['127.0.0.1', '::1', 'localhost'].includes(host) &&
  (!config.ownerToken || config.ownerToken.length < 24)
)
  throw new Error(
    'External binding requires an OWNER_TOKEN of at least 24 characters.',
  );
const database = process.env.DATABASE_PATH ?? 'data/hearth.sqlite';
const store = new Store(database);
const workspace = new WorkspaceStore(
  database,
  process.env.OWNER_ID ?? 'hearth-owner',
);
const platform = new Platform(store, workspace, config, {
  threadsDatabase:
    process.env.THREADS_DATABASE_PATH ??
    join(dirname(database), 'hearth-threads.sqlite'),
});
const app = createApp({
  store,
  platform,
  ownerToken: config.ownerToken,
  origin: resolveAppOrigins(process.env.APP_ORIGIN, process.env.NODE_ENV),
});
app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  await next();
});
app.get('/api/*', (c) => c.json({ error: 'Not found.' }, 404));
app.use('/*', serveStatic({ root: './dist/client' }));
app.get('*', serveStatic({ path: './dist/client/index.html' }));
const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`Hearth listening on http://${host}:${info.port}`);
  console.log(`  Hearth-Core:    ${config.coreUrl}`);
  console.log(`  Hearth-backend: ${config.backendUrl}`);
});
const shutdown = createShutdown({
  stopPlatform: async () => platform.stop(),
  closeServer: () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
  exit: (code) => process.exit(code),
  report: (operation, error) =>
    console.error(
      operation,
      error instanceof Error ? error.message : String(error),
    ),
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
