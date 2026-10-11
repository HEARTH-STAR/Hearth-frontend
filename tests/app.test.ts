import { afterEach, describe, expect, it } from 'vitest';
import { resolveAppOrigins } from '../src/server/app-origin.js';
import { fixture as base, json, SPACE_CONTAINER } from './helpers.js';
const open: { close(): void }[] = [];
function fixture(token?: string, origin?: string | string[]) {
  const value = base({ ownerToken: token, origin });
  open.push(value);
  return value;
}
afterEach(() => open.splice(0).forEach((value) => value.close()));
/** A same-origin JSON write through the /api guards; 200 when they let it through. */
const write = (origin: string, extra: Record<string, string> = {}) => ({
  ...json({ paused: false }, 'PATCH'),
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
      (await app.request('/api/settings', write('https://evil.example')))
        .status,
    ).toBe(403);
    expect(
      (
        await app.request('/api/settings', {
          method: 'PATCH',
          body: 'paused=false',
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
        `${origin}/api/settings`,
        write(origin),
      );
      expect(response.status).toBe(200);
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
        'http://localhost:5173/api/settings',
        write(origin),
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
      'http://127.0.0.1:4310/api/settings',
      write('http://localhost:5173', { 'Sec-Fetch-Site': 'cross-site' }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Cross-site requests are not allowed.',
    });
  });
  it('preserves exact matching for a single configured origin', async () => {
    const { app } = fixture(undefined, 'http://localhost:5173');
    for (const [origin, status] of [
      ['http://localhost:5173', 200],
      ['http://127.0.0.1:5173', 403],
    ] as const) {
      const response = await app.request(
        'http://localhost:5173/api/settings',
        write(origin),
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
        ['Bearer private-token', 200],
      ] as const) {
        const response = await app.request(
          `${origin}/api/settings`,
          write(origin, authorization ? { Authorization: authorization } : {}),
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
      'http://attacker.example/api/settings',
      write('http://localhost:5173'),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Unrecognized host.' });
  });
  it('does not widen access when an explicit origin list contains only blank entries', async () => {
    const { app } = fixture(undefined, resolveAppOrigins(' , ', 'development'));
    const response = await app.request(
      'http://localhost:5173/api/settings',
      write('http://localhost:5173'),
    );
    expect(response.status).toBe(403);
  });
  it('requires the request URL origin by default in production', async () => {
    const { app } = fixture(
      undefined,
      resolveAppOrigins(undefined, 'production'),
    );
    for (const [origin, status] of [
      ['http://localhost:4310', 200],
      ['http://localhost:5173', 403],
    ] as const) {
      const response = await app.request(
        'http://localhost:4310/api/settings',
        write(origin),
      );
      expect(response.status).toBe(status);
    }
  });
  it('validates and saves settings', async () => {
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
    });
    expect(store.settings()).toEqual({ name: 'David McKay', paused: true });
    expect(
      (
        await app.request(
          '/api/settings',
          json({ memoryAllowed: true }, 'PATCH'),
        )
      ).status,
    ).toBe(400);
    expect(await (await app.request('/api/state')).json()).toEqual({
      settings: { name: 'David McKay', paused: true },
    });
    expect(
      (await app.request('/api/memories', json({ text: 'x' }))).status,
    ).toBe(404);
  });
});
describe('workspace', () => {
  it('reports Hearth-backend and each Space’s container, with page counts', async () => {
    const { app, workspace } = fixture();
    const space = workspace.spaces()[0];
    workspace.pages.create(space.id, { title: 'Brief', content: '' });
    const body = await (await app.request('/api/workspace')).json();
    expect(body.spaces[0]).toMatchObject({
      pageCount: 1,
      container: SPACE_CONTAINER,
      stage: 'ready',
      claude: true,
    });
    expect(body.dots[0].name).toBe('Scout');
    expect(body.dots[0]).not.toHaveProperty('role');
    expect(body.dots[0].directory).toMatch(/^dots\/scout-[0-9a-f]{8}$/);
    expect(body.setup.backend).toMatchObject({
      reachable: true,
      detail: 'Docker 29.6.2',
      docker: true,
    });
    expect(body.setup.missing).toEqual([]);
  });
  it('names Docker or Hearth-backend as missing, and a Space still starting', async () => {
    const starting = base({
      core: { 'GET /health': () => Response.json({}, { status: 503 }) },
      backend: {
        'GET /api/status/docker': () => Response.json({ reachable: false }),
      },
    });
    open.push(starting);
    const body = await (await starting.app.request('/api/workspace')).json();
    expect(body.spaces[0]).toMatchObject({ stage: 'booting', claude: null });
    expect(body.setup.missing).toEqual(['Docker']);
    const down = base({
      backend: {
        'GET /api/status/docker': () => {
          throw new TypeError('fetch failed');
        },
        [`GET /api/containers/${SPACE_CONTAINER}`]: () => {
          throw new TypeError('fetch failed');
        },
      },
    });
    open.push(down);
    const offline = await (await down.app.request('/api/workspace')).json();
    expect(offline.spaces[0].stage).toBe('unknown');
    expect(offline.setup.missing).toEqual([
      'Hearth-backend at http://backend.test',
    ]);
  });
  it('creates and edits Dots with a safe working folder and no role', async () => {
    const { app, workspace } = fixture();
    const spaceId = workspace.spaces()[0].id;
    const dot = {
      spaceId,
      name: 'Quill',
      instructions: 'Write the launch brief.',
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
    expect(edited).toMatchObject({ directory: 'team/quill', name: 'Quill' });
    expect(
      (
        await app.request(
          `/api/dots/${created.id}`,
          json({ ...dot, role: 'Writer' }, 'PUT'),
        )
      ).status,
    ).toBe(400);
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
    'http://attacker.example/api/settings',
    write('http://attacker.example'),
  );
  expect(response.status).toBe(403);
});
