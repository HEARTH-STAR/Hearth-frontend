import { createApp } from '../src/server/app.js';
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
export function fixture(
  options: {
    ownerToken?: string;
    origin?: string | string[];
    core?: Record<string, Route>;
    backend?: Record<string, Route>;
    /** Give the seeded Space a running container (default), or leave it without one. */
    container?: boolean;
  } = {},
) {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
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
    backend: new HearthBackend('http://backend.test', undefined, backend.fetch),
    coreAt: (url) => {
      cores.push(url);
      return new HearthCore(url, core.fetch);
    },
  });
  const app = createApp({
    store,
    platform,
    ownerToken: options.ownerToken,
    origin: options.origin,
  });
  return {
    store,
    workspace,
    platform,
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
