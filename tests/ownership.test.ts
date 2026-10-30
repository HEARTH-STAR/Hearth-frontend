import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { dots } from '../src/server/db/schema.js';
import { OWNED_PATH } from '../src/server/ownership.js';
import type { Dot, WorkspaceState } from '../src/shared/types.js';
import { as, fixture as base, OWNER, type Route } from './helpers.js';

const open: { close(): void }[] = [];
afterEach(() => open.splice(0).forEach((item) => item.close()));
/** Hearth-backend with containers that spin up at once and can be removed. */
function fixture() {
  const removed: string[] = [];
  const containers = new Set<string>();
  const answer = (name: string) =>
    Response.json({
      id: 'f'.repeat(64),
      short_id: 'f'.repeat(12),
      name,
      template: 'space',
      image: 'hearth/container:space',
      status: 'running',
      ports: { '5010': 50020 },
    });
  const backend: Record<string, Route> = {
    'POST /api/containers': async (request) => {
      const { name } = (await request.json()) as { name: string };
      containers.add(`hearth-container-${name}`);
      return answer(`hearth-container-${name}`);
    },
    'GET /api/containers/*': (_request, url) => {
      const name = decodeURIComponent(url.pathname.split('/')[3]);
      const full = name.startsWith('hearth-container-')
        ? name
        : `hearth-container-${name}`;
      return containers.has(full)
        ? answer(full)
        : Response.json({ detail: 'no container' }, { status: 404 });
    },
    'DELETE /api/containers/*': (_request, url) => {
      const name = decodeURIComponent(url.pathname.split('/')[3]);
      removed.push(name);
      containers.delete(name);
      return new Response(null, { status: 204 });
    },
  };
  const value = base({ backend });
  open.push(value);
  return { ...value, removed };
}
const user = () => `user_${randomUUID().slice(0, 12)}`;
const send = (userId: string, body: unknown, method = 'POST') =>
  as(userId, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
async function makeDot(
  { app, platform }: ReturnType<typeof fixture>,
  userId: string,
  name: string,
): Promise<Dot> {
  const response = await app.request('/api/dots', send(userId, { name }));
  expect(response.status).toBe(201);
  const dot = (await response.json()) as Dot;
  await platform.spaces.settled(dot.spaceId);
  return dot;
}
const workspaceOf = async (
  app: ReturnType<typeof fixture>['app'],
  userId: string,
) =>
  (await (
    await app.request('/api/workspace', as(userId))
  ).json()) as WorkspaceState;

describe('Dot create and list', () => {
  it('records a new Dot under the signed-in user, then spins up hearth-container-<dot_id>', async () => {
    const f = fixture();
    const alice = user();
    const dot = await makeDot(f, alice, 'Quill');
    // Dot, Space and row share one id; the container is named after it
    expect(dot.spaceId).toBe(dot.id);
    expect(
      await f.db.select().from(dots).where(eq(dots.dotId, dot.id)),
    ).toEqual([{ dotId: dot.id, dotName: 'Quill', userId: alice }]);
    const spinUp = f.backend.calls.find(
      (call) => call.method === 'POST' && call.path === '/api/containers',
    );
    expect(spinUp?.body).toEqual({ name: dot.id, template: 'space' });
    expect(
      (
        await (
          await f.app.request(`/api/spaces/${dot.id}/setup`, as(alice))
        ).json()
      ).container,
    ).toBe(`hearth-container-${dot.id}`);
    // Alice, signed in before any webhook arrived, was added with her Clerk username
    expect(await f.accounts.hasUser(alice)).toBe(true);
  });
  it('lists only the signed-in user’s Dots, and gives a first-time user one Scout', async () => {
    const f = fixture();
    const alice = user();
    const bob = user();
    const quill = await makeDot(f, alice, 'Quill');
    const ink = await makeDot(f, alice, 'Ink');
    // Bob has none: his first visit (even two at once) makes exactly one
    const [first, again] = await Promise.all([
      workspaceOf(f.app, bob),
      workspaceOf(f.app, bob),
    ]);
    expect(first.dots.map((dot) => dot.name)).toEqual(['Scout']);
    expect(again.dots.map((dot) => dot.id)).toEqual(
      first.dots.map((dot) => dot.id),
    );
    expect(await f.accounts.dots(bob)).toHaveLength(1);
    const bobScout = first.dots[0];
    f.workspace.bindThread('bob-thread', bobScout.id, 'Bob only');

    const mine = await workspaceOf(f.app, alice);
    expect(mine.dots.map((dot) => dot.id).sort()).toEqual(
      [quill.id, ink.id].sort(),
    );
    expect(mine.spaces.map((space) => space.id).sort()).toEqual(
      [quill.id, ink.id].sort(),
    );
    expect(mine.conversations.map((item) => item.id)).not.toContain(
      'bob-thread',
    );
    expect(
      (await workspaceOf(f.app, bob)).conversations.map((item) => item.id),
    ).toEqual(['bob-thread']);
    // and the fixture's own user still sees only the seeded Dot
    expect((await workspaceOf(f.app, OWNER)).dots).toHaveLength(1);
  });
  it('keeps a renamed Dot’s row in step, and deletes its container, records and row', async () => {
    const f = fixture();
    const alice = user();
    const dot = await makeDot(f, alice, 'Quill');
    await f.app.request(
      `/api/dots/${dot.id}`,
      send(alice, { name: 'Quill II' }, 'PUT'),
    );
    expect(
      await f.db.select().from(dots).where(eq(dots.dotId, dot.id)),
    ).toEqual([{ dotId: dot.id, dotName: 'Quill II', userId: alice }]);

    const deleted = await f.app.request(
      `/api/dots/${dot.id}`,
      send(alice, {}, 'DELETE'),
    );
    expect(deleted.status).toBe(200);
    expect(f.removed).toEqual([`hearth-container-${dot.id}`]);
    expect(await f.accounts.owns(alice, dot.id)).toBe(false);
    expect(f.workspace.dot(dot.id)).toBeUndefined();
    expect(f.workspace.space(dot.id)).toBeUndefined();
    expect(
      (await f.app.request(`/api/dots/${dot.id}`, send(alice, {}, 'DELETE')))
        .status,
    ).toBe(404);
  });
});

describe('Dot ownership', () => {
  it('answers 404 to user B on every route that names user A’s Dot', async () => {
    const f = fixture();
    const alice = user();
    const bob = user();
    const dot = await makeDot(f, alice, 'Private');
    await makeDot(f, bob, 'Bob’s');
    const page = f.workspace.pages.create(dot.id, { title: 'Secret' });
    f.workspace.bindThread('alice-thread', dot.id, 'Alice');
    const thread = 'alice-thread';
    const routes: [string, string, unknown?][] = [
      // computer: status, files, a file, permissions, terminal
      ['GET', `/api/dots/${dot.id}/computer`],
      ['GET', `/api/dots/${dot.id}/computer/files`],
      ['GET', `/api/dots/${dot.id}/computer/file?path=README.md`],
      ['PATCH', `/api/dots/${dot.id}/computer/permissions`, { files: true }],
      ['POST', `/api/dots/${dot.id}/computer/terminal`, {}],
      // the Dot itself
      ['PUT', `/api/dots/${dot.id}`, { name: 'Taken' }],
      ['DELETE', `/api/dots/${dot.id}`, {}],
      // setup: container, agent, GitHub
      ['GET', `/api/spaces/${dot.id}/setup`],
      ['POST', `/api/spaces/${dot.id}/container`, {}],
      ['GET', `/api/spaces/${dot.id}/agent`],
      ['POST', `/api/spaces/${dot.id}/agent/login`, {}],
      ['POST', `/api/spaces/${dot.id}/agent/logout`, {}],
      ['GET', `/api/spaces/${dot.id}/github`],
      ['POST', `/api/spaces/${dot.id}/github/token`, { token: 'ghp_x' }],
      ['POST', `/api/spaces/${dot.id}/github/disconnect`, {}],
      // pages
      ['GET', `/api/spaces/${dot.id}/pages`],
      ['GET', `/api/spaces/${dot.id}/pages/${page.id}`],
      ['POST', `/api/spaces/${dot.id}/pages`, { title: 'Mine now' }],
      [
        'PATCH',
        `/api/spaces/${dot.id}/pages/${page.id}`,
        { title: 'x', expectedRevision: 1 },
      ],
      ['DELETE', `/api/spaces/${dot.id}/pages/${page.id}`, {}],
      [
        'POST',
        `/api/spaces/${dot.id}/pages/${page.id}/conversation`,
        { dotId: dot.id },
      ],
      // conversations and chat
      ['GET', `/api/conversations/${thread}/page-context`],
      ['GET', `/api/conversations/${thread}/reviewed-page/call`],
      ['POST', `/api/conversations/${thread}/page`, { title: 'x' }],
      ['POST', '/api/conversations', { dotId: dot.id, title: 'Hi' }],
      [
        'POST',
        `/api/copilotkit/agent/${dot.id}/run`,
        { threadId: thread, runId: 'r', messages: [] },
      ],
      ['POST', `/api/copilotkit/agent/${dot.id}/connect`, { threadId: thread }],
      ['POST', `/api/copilotkit/agent/${dot.id}/stop/${thread}`, {}],
    ];
    for (const [method, path, body] of routes) {
      const response = await f.app.request(
        path,
        as(bob, {
          method,
          ...(body === undefined
            ? {}
            : {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              }),
        }),
      );
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    // nothing of Alice's changed, and her own requests still work
    expect(f.workspace.dot(dot.id)?.name).toBe('Private');
    expect(f.workspace.pages.list(dot.id).map((item) => item.title)).toEqual([
      'Secret',
    ]);
    expect(f.removed).toEqual([]);
    expect(
      (await f.app.request(`/api/spaces/${dot.id}/pages`, as(alice))).status,
    ).toBe(200);
    expect(
      (await f.app.request(`/api/dots/${dot.id}/computer`, as(alice))).status,
    ).toBe(200);
    // an id that exists for no one answers the same
    expect(
      (await f.app.request(`/api/dots/${randomUUID()}/computer`, as(bob)))
        .status,
    ).toBe(404);
  });
  it('refuses a Dot that would reach another user’s Space', async () => {
    const f = fixture();
    const alice = user();
    const bob = user();
    const aliceDot = await makeDot(f, alice, 'Alice');
    const bobDot = await makeDot(f, bob, 'Bob');
    for (const body of [
      { name: 'Spy', spaceIds: [aliceDot.id] },
      { name: 'Spy', spaceId: aliceDot.id },
    ])
      expect((await f.app.request('/api/dots', send(bob, body))).status).toBe(
        404,
      );
    expect(
      (
        await f.app.request(
          `/api/dots/${bobDot.id}`,
          send(bob, { name: 'Bob', spaceIds: [bobDot.id, aliceDot.id] }, 'PUT'),
        )
      ).status,
    ).toBe(404);
    expect(f.workspace.dot(bobDot.id)?.spaceIds).toEqual([bobDot.id]);
    expect(await f.accounts.dots(bob)).toHaveLength(1);
  });
  it('guards every /api route that takes an id', () => {
    const { app } = fixture();
    const unguarded = app.routes
      .map((route) => route.path)
      .filter((path) => path.includes('/:') && !OWNED_PATH.test(path));
    expect(unguarded).toEqual([]);
  });
});
