import { SqliteAgentRunner } from '@copilotkit/sqlite-runner';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { clearInterruptedRuns } from '../src/server/platform.js';
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
it('clears runs a restart cut short so their conversations can run again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hearth-threads-'));
  const path = join(dir, 'threads.sqlite');
  try {
    clearInterruptedRuns(path); // no file yet: nothing to do
    const runner = new SqliteAgentRunner({ dbPath: path });
    runner.close();
    const db = new DatabaseSync(path);
    db.exec(
      "INSERT INTO run_state VALUES ('thread-a', 1, 'run-1', 0), ('thread-b', 0, NULL, 0)",
    );
    db.close();
    clearInterruptedRuns(path);
    const reopened = new SqliteAgentRunner({ dbPath: path });
    expect(await reopened.isRunning({ threadId: 'thread-a' })).toBe(false);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
