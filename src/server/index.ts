import { createShutdown } from './shutdown.js';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { dirname, join } from 'node:path';
import { Store } from './store.js';
import { createApp } from './app.js';
import { resolveAppOrigins } from './app-origin.js';
import { clerkAuth, clerkFromEnv, clerkFrontendApi } from './auth.js';
import { configFromEnv } from './config.js';
import { AccountStore } from './db/accounts.js';
import { openDatabase } from './db/index.js';
import { WorkspaceStore } from './workspace.js';
import { Platform } from './platform.js';
import { attachTerminal } from './terminal.js';
import type { Server } from 'node:http';
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4310);
const config = configFromEnv(process.env);
const clerk = clerkFromEnv(process.env);
const origin = resolveAppOrigins(process.env.APP_ORIGIN, process.env.NODE_ENV);
// Requests are only accepted for loopback and APP_ORIGIN's hosts (app-origin.ts).
if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !origin)
  throw new Error(
    'External binding requires APP_ORIGIN: the URL people open Hearth at, e.g. https://hearth.example.com.',
  );
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl)
  throw new Error(
    'DATABASE_URL is not set: Hearth keeps users and their Dots in Postgres.',
  );
const accountsDb = await openDatabase(databaseUrl);
const accounts = new AccountStore(accountsDb.db);
const database = process.env.DATABASE_PATH ?? 'data/hearth.sqlite';
const store = new Store(database);
// No shared Scout: each user gets their own first Dot (workspace-routes.ts).
const workspace = new WorkspaceStore(
  database,
  process.env.OWNER_ID ?? 'hearth-owner',
  false,
);
const platform = new Platform(store, workspace, config, {
  threadsDatabase:
    process.env.THREADS_DATABASE_PATH ??
    join(dirname(database), 'hearth-threads.sqlite'),
  ownerOf: (spaceId) => accounts.ownerOf(spaceId),
});
const app = createApp({
  store,
  platform,
  accounts,
  auth: clerkAuth(clerk, origin),
  clerk,
  origin,
});
// Clerk's sign-in loads from its Frontend API, with Cloudflare's bot check and Clerk's avatars.
const clerkHost = `https://${clerkFrontendApi(clerk.publishableKey)}`;
const challenges = 'https://challenges.cloudflare.com';
app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self' ${clerkHost} ${challenges}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://img.clerk.com; connect-src 'self' ${clerkHost}; frame-src ${challenges}; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
  );
  await next();
});
app.get('/api/*', (c) => c.json({ error: 'Not found.' }, 404));
// The landing page is dist/client/welcome/index.html; without the slash, /welcome would get the app.
app.get('/welcome', (c) => c.redirect('/welcome/', 301));
app.use('/*', serveStatic({ root: './dist/client' }));
app.get('*', serveStatic({ path: './dist/client/index.html' }));
const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`Hearth listening on http://${host}:${info.port}`);
  console.log(`  Hearth-backend: ${config.backendUrl}`);
  console.log(`  Space template: ${config.containerTemplate}`);
});
// The Computer panel's terminal: WebSocket upgrades, checked like /api and piped to Hearth-backend.
// The one-use ticket it needs is only issued to the Dot's owner (POST /api/dots/:id/computer/terminal).
attachTerminal(server as Server, {
  computers: platform.computers,
  config,
  origin,
});
const shutdown = createShutdown({
  stopPlatform: async () => {
    platform.stop();
    await accountsDb.close();
  },
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
