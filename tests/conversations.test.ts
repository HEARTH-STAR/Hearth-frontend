import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { deleteThreadRuns, threadIsRunning } from '../src/server/platform.js';
import { fixture, json } from './helpers.js';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function conversation() {
  const setup = fixture();
  const dot = setup.workspace.dots()[0];
  const thread = setup.platform.createConversation(dot.id, 'Brief');
  return { ...setup, dot, thread };
}

it('reports when each turn was asked and answered', async () => {
  const { app, workspace, thread } = conversation();
  workspace.appendTranscript(thread.id, 'user', 'first');
  workspace.appendTranscript(thread.id, 'assistant', 'answer');
  workspace.appendTranscript(thread.id, 'user', 'second, no reply yet');
  const response = await app.request(`/api/conversations/${thread.id}/times`);
  expect(response.status).toBe(200);
  const turns = (await response.json()) as {
    asked: number;
    replied?: number;
  }[];
  expect(turns).toHaveLength(2);
  expect(turns[0].replied).toBeGreaterThanOrEqual(turns[0].asked);
  expect(turns[1].replied).toBeUndefined();
  expect((await app.request('/api/conversations/missing/times')).status).toBe(
    404,
  );
});

it('renames a conversation, and refuses an empty title or unknown one', async () => {
  const { app, thread } = conversation();
  const renamed = await app.request(
    `/api/conversations/${thread.id}`,
    json({ title: '  Upgrade acme-pay  ' }, 'PATCH'),
  );
  expect(renamed.status).toBe(200);
  expect(((await renamed.json()) as { title: string }).title).toBe(
    'Upgrade acme-pay',
  );
  expect(
    (
      await app.request(
        `/api/conversations/${thread.id}`,
        json({ title: '   ' }, 'PATCH'),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await app.request(
        '/api/conversations/missing',
        json({ title: 'x' }, 'PATCH'),
      )
    ).status,
  ).toBe(404);
});

it('deletes a conversation and what is tied only to it', async () => {
  const { app, workspace, thread } = conversation();
  workspace.appendTranscript(thread.id, 'user', 'hello');
  const response = await app.request(`/api/conversations/${thread.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  expect(response.status).toBe(200);
  expect(workspace.conversations().some((c) => c.id === thread.id)).toBe(false);
  expect(workspace.turnTimes(thread.id)).toEqual([]);
  expect(
    (
      await app.request(`/api/conversations/${thread.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      })
    ).status,
  ).toBe(404);
});

it('keeps a page’s own conversation: it can be renamed but not deleted', async () => {
  const { app, workspace, thread, dot } = conversation();
  // Bind the conversation to a page the way a page chat does.
  (workspace as unknown as { db: DatabaseSync }).db
    .prepare(
      'INSERT INTO page_threads(pageId,dotId,threadId,ready,leaseUntil) VALUES(?,?,?,1,0)',
    )
    .run('page-1', dot.id, thread.id);
  const refused = await app.request(`/api/conversations/${thread.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  expect(refused.status).toBe(409);
  expect(((await refused.json()) as { error: string }).error).toContain(
    'stays with its page',
  );
  expect(workspace.conversations().some((c) => c.id === thread.id)).toBe(true);
});

it('checks for a running turn and removes saved history in the runner’s file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hearth-threads-'));
  temps.push(dir);
  const path = join(dir, 'threads.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE agent_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL,
             run_id TEXT NOT NULL UNIQUE, parent_run_id TEXT, events TEXT NOT NULL, input TEXT NOT NULL,
             created_at INTEGER NOT NULL, version INTEGER NOT NULL);
           CREATE TABLE run_state (thread_id TEXT PRIMARY KEY, is_running INTEGER DEFAULT 0,
             current_run_id TEXT, updated_at INTEGER NOT NULL);`);
  const run = db.prepare(
    "INSERT INTO agent_runs(thread_id,run_id,events,input,created_at,version) VALUES(?,?,'[]','{}',0,1)",
  );
  run.run('keep', 'r1');
  run.run('gone', 'r2');
  db.prepare(
    'INSERT INTO run_state(thread_id,is_running,updated_at) VALUES(?,1,0)',
  ).run('busy');
  db.close();

  expect(threadIsRunning(path, 'busy')).toBe(true);
  expect(threadIsRunning(path, 'gone')).toBe(false);
  deleteThreadRuns(path, 'gone');
  const after = new DatabaseSync(path);
  const left = after.prepare('SELECT thread_id FROM agent_runs').all() as {
    thread_id: string;
  }[];
  after.close();
  expect(left.map((row) => row.thread_id)).toEqual(['keep']);
  // An in-memory runner has no file to touch.
  expect(threadIsRunning(':memory:', 'busy')).toBe(false);
  expect(() => deleteThreadRuns(':memory:', 'x')).not.toThrow();
});
