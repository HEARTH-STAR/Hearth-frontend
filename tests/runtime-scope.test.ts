import { expect, it } from 'vitest';
import { validateRuntimeScope } from '../src/server/runtime-scope.js';
import { WorkspaceStore } from '../src/server/workspace.js';
it('blocks unbound cross-Dot runs and every route the app does not use', () => {
  const store = new WorkspaceStore(':memory:', 'owner');
  const dot = store.dots()[0];
  store.bindThread('thread-a', dot.id, 'A');
  const run =
    (path: string, body: unknown, method = 'POST') =>
    () =>
      validateRuntimeScope(
        new Request(`http://localhost/api/copilotkit${path}`, { method }),
        store,
        body,
      );
  expect(run(`/agent/${dot.id}/run`, { threadId: 'other-owner' })).toThrow();
  expect(run('/inspect/threads/foreign', null, 'GET')).toThrow();
  expect(run('/threads', null, 'GET')).toThrow();
  expect(run(`/agent/${dot.id}/suggest`, { threadId: 'thread-a' })).toThrow();
  expect(run(`/agent/${dot.id}/run`, { threadId: 'thread-a' })).not.toThrow();
  expect(
    run(`/agent/${dot.id}/connect`, { threadId: 'thread-a' }),
  ).not.toThrow();
  expect(run('/info', null, 'GET')).not.toThrow();
  store.close();
});
it('rejects stop scope bypasses and misleading prefixes while allowing canonical owned routes', () => {
  const store = new WorkspaceStore(':memory:', 'owner');
  const dot = store.dots()[0];
  store.bindThread('bound', dot.id, 'Bound');
  for (const path of [
    `/agent/${dot.id}/stop/foreign`,
    '/threads/bound/threads/foreign/messages',
    `/agent/${dot.id}/agent/foreign/run`,
    '/prefix/info',
    '/threads//bound/messages',
    '/threads/bound%2Fthreads%2Fforeign/messages',
  ]) {
    expect(() =>
      validateRuntimeScope(
        new Request(`http://localhost/api/copilotkit${path}`, {
          method: 'POST',
        }),
        store,
        { threadId: 'bound' },
      ),
    ).toThrow();
  }
  expect(() =>
    validateRuntimeScope(
      new Request(
        `http://localhost/api/copilotkit/agent/${dot.id}/stop/bound`,
        { method: 'POST' },
      ),
      store,
      {},
    ),
  ).not.toThrow();
  store.close();
});
