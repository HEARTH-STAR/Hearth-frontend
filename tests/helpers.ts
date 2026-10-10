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
/** A ``fetch`` that answers from ``routes`` (keyed ``METHOD /path``) and records every request. */
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
    const route = routes[`${request.method} ${url.pathname}`];
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
};
export function fixture(
  options: {
    ownerToken?: string;
    origin?: string | string[];
    core?: Record<string, Route>;
    backend?: Record<string, Route>;
  } = {},
) {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
  const core = fakeFetch({ ...healthy, ...options.core });
  const backend = fakeFetch({
    'GET /api/status/docker': () =>
      Response.json({ reachable: true, version: '29.6.2' }),
    ...options.backend,
  });
  const config = configFromEnv({});
  const platform = new Platform(store, workspace, config, {
    threadsDatabase: ':memory:',
    core: new HearthCore('http://core.test', core.fetch),
    backend: new HearthBackend('http://backend.test', undefined, backend.fetch),
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
