import { afterEach, describe, expect, it } from 'vitest';
import { resolveAppOrigins } from '../src/server/app-origin.js';
import { fixture as base, json } from './helpers.js';
const open: { close(): void }[] = [];
function fixture(token?: string, origin?: string | string[]) {
  const value = base({ ownerToken: token, origin });
  open.push(value);
  return value;
}
afterEach(() => open.splice(0).forEach((value) => value.close()));
const memory = (origin: string, extra: Record<string, string> = {}) => ({
  ...json({ text: 'Prefer short briefs' }),
  headers: {
    'Content-Type': 'application/json',
    Origin: origin,
    'Sec-Fetch-Site': 'same-origin',
    ...extra,
  },
});
describe('API boundaries', () => {
  it('requires owner token for state and mutations when configured', async () => {
    const { app } = fixture('private-token');
    expect((await app.request('/api/state')).status).toBe(401);
    expect(
      (
        await app.request('/api/state', {
          headers: { Authorization: 'Bearer private-token' },
        })
      ).status,
    ).toBe(200);
  });
  it('blocks browser cross-origin requests and form posts', async () => {
    const { app } = fixture();
    expect(
      (await app.request('/api/memories', memory('https://evil.example')))
        .status,
    ).toBe(403);
    expect(
      (
        await app.request('/api/memories', {
          method: 'POST',
          body: 'text=hello',
        })
      ).status,
    ).toBe(415);
  });
  it.each(['http://localhost:5173', 'http://127.0.0.1:5173'])(
    'allows a same-origin Vite proxy mutation from %s',
    async (origin) => {
      const { app } = fixture(
        undefined,
        resolveAppOrigins(undefined, 'development'),
      );
      const response = await app.request(
        `${origin}/api/memories`,
        memory(origin),
      );
      expect(response.status).toBe(201);
    },
  );
  it.each([
    'https://evil.example',
    'http://localhost:5174',
    'https://localhost:5173',
  ])(
    'rejects an unlisted origin %s with multiple origins configured',
    async (origin) => {
      const { app } = fixture(
        undefined,
        resolveAppOrigins(undefined, 'development'),
      );
      const response = await app.request(
        'http://localhost:5173/api/memories',
        memory(origin),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: 'Cross-origin requests are not allowed.',
      });
    },
  );
  it('rejects cross-site requests even from a configured origin', async () => {
    const { app } = fixture(
      undefined,
      resolveAppOrigins(undefined, 'development'),
    );
    const response = await app.request(
      'http://127.0.0.1:4310/api/memories',
      memory('http://localhost:5173', { 'Sec-Fetch-Site': 'cross-site' }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Cross-site requests are not allowed.',
    });
  });
  it('preserves exact matching for a single configured origin', async () => {
    const { app } = fixture(undefined, 'http://localhost:5173');
    for (const [origin, status] of [
      ['http://localhost:5173', 201],
      ['http://127.0.0.1:5173', 403],
    ] as const) {
      const response = await app.request(
        'http://localhost:5173/api/memories',
        memory(origin),
      );
      expect(response.status).toBe(status);
    }
  });
  it.each(['http://localhost:5173', 'http://127.0.0.1:5173'])(
    'requires owner authentication for an allowed origin %s',
    async (origin) => {
      const { app } = fixture(
        'private-token',
        resolveAppOrigins(undefined, 'development'),
      );
      for (const [authorization, status] of [
        [undefined, 401],
        ['Bearer wrong-token', 401],
        ['Bearer private-token', 201],
      ] as const) {
        const response = await app.request(
          `${origin}/api/memories`,
          memory(origin, authorization ? { Authorization: authorization } : {}),
        );
        expect(response.status).toBe(status);
      }
    },
  );
  it('rejects unrecognized hosts even when the origin is explicitly allowed', async () => {
    const { app } = fixture(
      undefined,
      resolveAppOrigins(undefined, 'development'),
    );
    const response = await app.request(
      'http://attacker.example/api/memories',
      memory('http://localhost:5173'),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Unrecognized host.' });
  });
  it('does not widen access when an explicit origin list contains only blank entries', async () => {
    const { app } = fixture(undefined, resolveAppOrigins(' , ', 'development'));
    const response = await app.request(
      'http://localhost:5173/api/memories',
      memory('http://localhost:5173'),
    );
    expect(response.status).toBe(403);
  });
  it('requires the request URL origin by default in production', async () => {
    const { app } = fixture(
      undefined,
      resolveAppOrigins(undefined, 'production'),
    );
    for (const [origin, status] of [
      ['http://localhost:4310', 201],
      ['http://localhost:5173', 403],
    ] as const) {
      const response = await app.request(
        'http://localhost:4310/api/memories',
        memory(origin),
      );
      expect(response.status).toBe(status);
    }
  });
  it('validates settings and persists memory edits and deletes', async () => {
    const { app, store } = fixture();
    expect(
      (await app.request('/api/settings', json({ paused: 'yes' }, 'PATCH')))
        .status,
    ).toBe(400);
    expect(
      (
        await app.request(
          '/api/settings',
          json({ researchAllowed: true }, 'PATCH'),
        )
      ).status,
    ).toBe(400);
    const settings = await app.request(
      '/api/settings',
      json({ name: 'David McKay', paused: true }, 'PATCH'),
    );
    expect(await settings.json()).toEqual({
      name: 'David McKay',
      paused: true,
      memoryAllowed: true,
    });
    await app.request('/api/memories', json({ text: 'Prefer short briefs' }));
    const memory = store.memories()[0];
    const updated = await app.request(
      `/api/memories/${memory.id}`,
      json({ text: 'Prefer deep briefs' }, 'PUT'),
    );
    expect(updated.status).toBe(200);
    expect(store.memories()[0].text).toBe('Prefer deep briefs');
    await app.request(`/api/memories/${memory.id}`, json({}, 'DELETE'));
    expect(store.memories()).toHaveLength(0);
  });
});
describe('workspace', () => {
  it('reports both services and lists Spaces with page counts', async () => {
    const { app, workspace } = fixture();
    const space = workspace.spaces()[0];
    workspace.pages.create(space.id, { title: 'Brief', content: '' });
    const body = await (await app.request('/api/workspace')).json();
    expect(body.spaces[0].pageCount).toBe(1);
    expect(body.dots[0]).toMatchObject({ name: 'Scout', role: 'Researcher' });
    expect(body.dots[0].directory).toMatch(/^dots\/scout-[0-9a-f]{8}$/);
    expect(body.setup.core).toMatchObject({
      reachable: true,
      detail: 'agent claude_code',
    });
    expect(body.setup.backend).toMatchObject({
      reachable: true,
      detail: 'Docker 29.6.2',
    });
    expect(body.setup.missing).toEqual([]);
  });
  it('names Hearth-Core as missing when it does not answer', async () => {
    const value = base({
      core: { 'GET /health': () => Response.json({}, { status: 503 }) },
    });
    open.push(value);
    const body = await (await value.app.request('/api/workspace')).json();
    expect(body.setup.core.reachable).toBe(false);
    expect(body.setup.missing).toEqual(['Hearth-Core at http://core.test']);
  });
  it('creates and edits Dots with a role and a safe working folder', async () => {
    const { app, workspace } = fixture();
    const spaceId = workspace.spaces()[0].id;
    const dot = {
      spaceId,
      name: 'Quill',
      role: 'Writer',
      instructions: 'Write the launch brief.',
      memoryAllowed: false,
    };
    const created = await (await app.request('/api/dots', json(dot))).json();
    expect(created.directory).toMatch(/^dots\/quill-/);
    expect(
      (
        await app.request(
          `/api/dots/${created.id}`,
          json({ ...dot, directory: '../escape' }, 'PUT'),
        )
      ).status,
    ).toBe(400);
    const edited = await (
      await app.request(
        `/api/dots/${created.id}`,
        json({ ...dot, directory: 'team/quill' }, 'PUT'),
      )
    ).json();
    expect(edited).toMatchObject({ directory: 'team/quill', role: 'Writer' });
    const conversation = await app.request(
      '/api/conversations',
      json({ dotId: created.id, title: 'Brief' }),
    );
    expect(conversation.status).toBe(201);
    expect(
      (await app.request('/api/conversations', json({ dotId: 'nope' }))).status,
    ).toBe(404);
  });
});
it('rejects DNS-rebinding Host even with a matching hostile Origin', async () => {
  const { app } = fixture();
  const response = await app.request(
    'http://attacker.example/api/memories',
    memory('http://attacker.example'),
  );
  expect(response.status).toBe(403);
});
