import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { randomBytes } from 'node:crypto';
import { beforeAll } from 'vitest';
import { createApp } from '../src/server/app.js';
import type { Auth } from '../src/server/auth.js';
import { AccountStore } from '../src/server/db/accounts.js';
import { MIGRATIONS_FOLDER, type Database } from '../src/server/db/index.js';
import * as schema from '../src/server/db/schema.js';
import { configFromEnv } from '../src/server/config.js';
import { HearthBackend } from '../src/server/hearth-backend.js';
import { HearthCore, type CoreEvent } from '../src/server/hearth-core.js';
import { Platform } from '../src/server/platform.js';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
export type Route = (
  request: Request,
  url: URL,
) => Response | Promise<Response>;
/**
 * A ``fetch`` that answers from ``routes`` (keyed ``METHOD /path``; a key ending in ``*`` matches
 * any path with that prefix) and records every request.
 */
export function fakeFetch(routes: Record<string, Route>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body =
      request.method === 'GET'
        ? undefined
        : await request
            .clone()
            .json()
            .catch(() => undefined);
    calls.push({ method: request.method, path: url.pathname, body });
    const key = `${request.method} ${url.pathname}`;
    const route =
      routes[key] ??
      Object.entries(routes).find(
        ([pattern]) =>
          pattern.endsWith('*') && key.startsWith(pattern.slice(0, -1)),
      )?.[1];
    if (!route) return Response.json({ detail: 'Not Found' }, { status: 404 });
    return route(request, url);
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}
/** A ``text/event-stream`` response carrying Hearth-Core chat events. */
export function sse(events: CoreEvent[]) {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}
export const healthy: Record<string, Route> = {
  'GET /health': () => Response.json({ ok: true, agent: 'claude_code' }),
  'GET /api/connectors/claude-code/status': () =>
    Response.json({
      status: 'connected',
      method: 'claude.ai',
      email: 'owner@example.com',
      subscription: 'max',
      login_supported: true,
    }),
};
/** The seeded Space's container, as the fake Hearth-backend reports it. */
export const SPACE_CONTAINER = 'hearth-container-everyday';
export const runningSpace = (
  ports: Record<string, number> = { '5010': 49153 },
) =>
  Response.json({
    id: 'c'.repeat(64),
    short_id: 'c'.repeat(12),
    name: SPACE_CONTAINER,
    template: 'space',
    image: 'hearth/container:space',
    status: 'running',
    ports,
  });
let shared: { db: Database; ready: Promise<unknown> } | undefined;
/**
 * One in-memory Postgres per test file, migrated from drizzle/ like the real one. Fixtures share it:
 * every Dot id is a fresh UUID, and each test signs in as users it names.
 */
export function testDatabase() {
  if (!shared) {
    const db = drizzle(new PGlite(), { schema });
    shared = {
      db: db as unknown as Database,
      ready: migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    };
  }
  return shared;
}
// Starting PGlite takes seconds (more while every worker starts one), so each file using these
// helpers waits for it once, before its first test, rather than inside one.
beforeAll(() => testDatabase().ready, 120_000);
/** The Clerk user every fixture request is signed in as, unless it sends ``X-Test-User``. */
export const OWNER = 'user_owner';
/** Signs a request in as ``userId`` (an empty string: signed out). */
export const as = (userId: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: {
    ...(init.headers as Record<string, string>),
    'X-Test-User': userId,
  },
});
/** A Svix signing secret, as Clerk shows it for a webhook endpoint. */
export const WEBHOOK_SECRET = `whsec_${randomBytes(24).toString('base64')}`;
export function fixture(
  options: {
    origin?: string | string[];
    /** What Clerk says a user's username is (default: ``<id>-name``). */
    username?: Auth['username'];
    core?: Record<string, Route>;
    backend?: Record<string, Route>;
    /** Give the seeded Space a running container (default), or leave it without one. */
    container?: boolean;
  } = {},
) {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
  const database = testDatabase();
  const accounts = new AccountStore(database.db);
  // The seeded Space is OWNER's Dot, as if they had made it.
  const seeded = workspace.spaces()[0].id;
  const ready = database.ready
    .then(() => accounts.saveUser(OWNER, 'owner'))
    .then(() => accounts.addDot(seeded, 'Scout', OWNER));
  // A test that never calls the API never waits for it.
  ready.catch(() => {});
  const auth: Auth = {
    async authenticate(request) {
      await ready;
      const user = request.headers.get('X-Test-User');
      return user === null ? OWNER : user || null;
    },
    username: options.username ?? (async (userId) => `${userId}-name`),
  };
  if (options.container !== false)
    workspace.setSpaceContainer(workspace.spaces()[0].id, SPACE_CONTAINER);
  const core = fakeFetch({ ...healthy, ...options.core });
  const backend = fakeFetch({
    'GET /api/status/docker': () =>
      Response.json({ reachable: true, version: '29.6.2' }),
    [`GET /api/containers/${SPACE_CONTAINER}`]: () => runningSpace(),
    ...options.backend,
  });
  const config = configFromEnv({});
  // Every Space's Hearth-Core answers from the same fake; ``cores`` records the URLs used.
  const cores: string[] = [];
  const platform = new Platform(store, workspace, config, {
    threadsDatabase: ':memory:',
    ownerOf: (spaceId) => accounts.ownerOf(spaceId),
    backend: new HearthBackend('http://backend.test', undefined, backend.fetch),
    coreAt: (url) => {
      cores.push(url);
      return new HearthCore(url, core.fetch);
    },
  });
  const app = createApp({
    store,
    platform,
    accounts,
    auth,
    clerk: {
      publishableKey: 'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k',
      webhookSecret: WEBHOOK_SECRET,
    },
    origin: options.origin,
  });
  return {
    store,
    workspace,
    platform,
    accounts,
    db: database.db,
    ready,
    app,
    core,
    cores,
    backend,
    close() {
      platform.stop();
      store.close();
      workspace.close();
    },
  };
}
export const json = (body: unknown, method = 'POST') => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
