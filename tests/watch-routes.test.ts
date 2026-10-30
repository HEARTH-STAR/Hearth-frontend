import { afterEach, expect, it } from 'vitest';
import type {
  DetectionSummary,
  Watch,
  WatchOverview,
} from '../src/shared/watch-types.js';
import { as, fixture as base, json, type Route } from './helpers.js';

const open: { close(): void }[] = [];
afterEach(() => open.splice(0).forEach((item) => item.close()));
function fixture(core: Record<string, Route> = {}) {
  const value = base({ core });
  open.push(value);
  // API watch is per Space: Hearth-Core in the Space's container keeps it.
  const space = value.workspace.spaces()[0].id;
  return {
    ...value,
    space,
    base: `/api/spaces/${space}/watch`,
    watchCalls: () =>
      value.core.calls.filter((call) => call.path.startsWith('/api/watch')),
  };
}
const W = 'w_0123456789ab';
const D = 'cr_0123456789ab';
const watch: Watch = {
  id: W,
  name: 'stripe',
  spec_url: 'https://example.com/openapi.json',
  repo: 'acme/shop',
  base_branch: null,
  validate_commands: ['npm ci && npm test'],
  interval_minutes: 60,
  auto_pr: true,
  enabled: true,
  created_at: '2026-10-30T10:00:00Z',
  status: {
    state: 'idle',
    last_checked_at: null,
    last_changed_at: null,
    next_check_at: null,
    last_error: null,
    spec_version: null,
    spec_sha: null,
  },
  history: [],
};
const summary: DetectionSummary = {
  id: D,
  watch_id: W,
  provider: 'stripe',
  detected_at: '2026-10-30T10:05:00Z',
  from_version: '1.0.0',
  to_version: '2.0.0',
  summary: '1 breaking change',
  severity: 'high',
  breaking_count: 1,
  total_count: 2,
  fix: {
    status: 'queued',
    message: null,
    updated_at: '2026-10-30T10:05:00Z',
    attempts: 1,
    branch: null,
    pr: null,
    agent: null,
    agent_summary: null,
    needs_human_attention: [],
    baseline: null,
    validation: null,
    impact: [],
  },
};
const echo =
  (status = 200, answer?: unknown): Route =>
  async (request) =>
    Response.json(
      answer ??
        (request.method === 'GET'
          ? {}
          : await request.json().catch(() => ({}))),
      { status },
    );

it('lists a Space’s watches, poller and detections from its Hearth-Core', async () => {
  const overview: WatchOverview = {
    poller: { running: true, tick_at: null, active: null, queue: [] },
    watches: [watch],
    detections: [summary],
  };
  const { app, base, watchCalls } = fixture({
    'GET /api/watch': () => Response.json(overview),
  });
  const response = await app.request(base);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(overview);
  expect(watchCalls()).toEqual([
    { method: 'GET', path: '/api/watch', body: undefined },
  ]);
});

it('forwards each route with its method, path and body', async () => {
  const { app, base, watchCalls } = fixture({
    'POST /api/watch': () => Response.json(watch, { status: 201 }),
    [`PATCH /api/watch/${W}`]: () => Response.json(watch),
    [`DELETE /api/watch/${W}`]: () => new Response(null, { status: 204 }),
    [`POST /api/watch/${W}/check`]: () => Response.json(watch, { status: 202 }),
    [`GET /api/watch/detections/${D}`]: () =>
      Response.json({ ...summary, changes: [] }),
    [`POST /api/watch/detections/${D}/fix`]: () =>
      Response.json(summary, { status: 202 }),
    [`GET /api/watch/detections/${D}/pull`]: echo(200, { number: 7 }),
    [`GET /api/watch/detections/${D}/pull/files`]: echo(200, { files: [] }),
    [`GET /api/watch/detections/${D}/pull/comments`]: echo(200, {
      comments: [],
    }),
    [`POST /api/watch/detections/${D}/pull/comments`]: echo(201),
    [`POST /api/watch/detections/${D}/pull/reviews`]: echo(201),
    [`POST /api/watch/detections/${D}/pull/merge`]: echo(200, {
      merged: true,
      sha: 'abc',
      message: 'Pull Request successfully merged',
    }),
  });
  const created = await app.request(
    base,
    json({
      name: ' stripe ',
      spec_url: 'https://example.com/openapi.json',
      repo: 'acme/shop',
      validate_commands: ['npm ci && npm test'],
      interval_minutes: 30,
      auto_pr: false,
    }),
  );
  expect(created.status).toBe(201);
  expect((await created.json()).id).toBe(W);
  expect(
    (
      await app.request(
        `${base}/${W}`,
        json({ enabled: false, base_branch: null }, 'PATCH'),
      )
    ).status,
  ).toBe(200);
  const removed = await app.request(`${base}/${W}`, json({}, 'DELETE'));
  expect(removed.status).toBe(204);
  expect(await removed.text()).toBe('');
  expect((await app.request(`${base}/${W}/check`, json({}))).status).toBe(202);
  expect(
    (await (await app.request(`${base}/detections/${D}`)).json()).changes,
  ).toEqual([]);
  expect(
    (await app.request(`${base}/detections/${D}/fix`, json({}))).status,
  ).toBe(202);
  expect(
    await (await app.request(`${base}/detections/${D}/pull`)).json(),
  ).toEqual({ number: 7 });
  await app.request(`${base}/detections/${D}/pull/files`);
  await app.request(`${base}/detections/${D}/pull/comments`);
  const comment = await app.request(
    `${base}/detections/${D}/pull/comments`,
    json({ body: 'Looks off', path: 'src/pay.ts', line: 12 }),
  );
  expect(comment.status).toBe(201);
  await app.request(
    `${base}/detections/${D}/pull/reviews`,
    json({ event: 'APPROVE' }),
  );
  await app.request(
    `${base}/detections/${D}/pull/reviews`,
    json({ event: 'REQUEST_CHANGES', body: 'Keep the old field' }),
  );
  const merged = await app.request(
    `${base}/detections/${D}/pull/merge`,
    json({ method: 'squash' }),
  );
  expect(await merged.json()).toMatchObject({ merged: true });
  expect(watchCalls()).toEqual([
    {
      method: 'POST',
      path: '/api/watch',
      body: {
        name: 'stripe',
        spec_url: 'https://example.com/openapi.json',
        repo: 'acme/shop',
        validate_commands: ['npm ci && npm test'],
        interval_minutes: 30,
        auto_pr: false,
      },
    },
    {
      method: 'PATCH',
      path: `/api/watch/${W}`,
      body: { enabled: false, base_branch: null },
    },
    { method: 'DELETE', path: `/api/watch/${W}`, body: undefined },
    { method: 'POST', path: `/api/watch/${W}/check`, body: {} },
    { method: 'GET', path: `/api/watch/detections/${D}`, body: undefined },
    { method: 'POST', path: `/api/watch/detections/${D}/fix`, body: {} },
    { method: 'GET', path: `/api/watch/detections/${D}/pull`, body: undefined },
    {
      method: 'GET',
      path: `/api/watch/detections/${D}/pull/files`,
      body: undefined,
    },
    {
      method: 'GET',
      path: `/api/watch/detections/${D}/pull/comments`,
      body: undefined,
    },
    {
      method: 'POST',
      path: `/api/watch/detections/${D}/pull/comments`,
      body: { body: 'Looks off', path: 'src/pay.ts', line: 12 },
    },
    {
      method: 'POST',
      path: `/api/watch/detections/${D}/pull/reviews`,
      body: { event: 'APPROVE' },
    },
    {
      method: 'POST',
      path: `/api/watch/detections/${D}/pull/reviews`,
      body: { event: 'REQUEST_CHANGES', body: 'Keep the old field' },
    },
    {
      method: 'POST',
      path: `/api/watch/detections/${D}/pull/merge`,
      body: { method: 'squash' },
    },
  ]);
});

it('refuses bad ids and bodies before reaching Hearth-Core', async () => {
  const { app, base, watchCalls } = fixture({ 'POST /api/watch': echo(201) });
  const valid = {
    name: 'stripe',
    spec_url: 'https://example.com/openapi.json',
    repo: 'acme/shop',
    validate_commands: ['npm test'],
  };
  const refused = async (path: string, init?: RequestInit) => {
    const response = await app.request(path, init);
    expect(response.status).toBe(400);
    return (await response.json()).error as string;
  };
  expect(await refused(base, json({ ...valid, repo: 'acme' }))).toMatch(
    /owner\/name/,
  );
  expect(
    await refused(base, json({ ...valid, spec_url: 'file:///etc/passwd' })),
  ).toMatch(/http/);
  await refused(base, json({ ...valid, validate_commands: [] }));
  await refused(base, json({ ...valid, validate_commands: ['  '] }));
  await refused(base, json({ ...valid, validate_commands: ['x'.repeat(501)] }));
  await refused(base, json({ ...valid, interval_minutes: 2 }));
  await refused(base, json({ ...valid, interval_minutes: 7.5 }));
  await refused(base, json({ ...valid, extra: true }));
  await refused(`${base}/nope`, json({ enabled: true }, 'PATCH'));
  await refused(`${base}/${W}`, json({ repo: 'a/b' }, 'PATCH'));
  await refused(`${base}/${W}`, json({}, 'PATCH'));
  await refused(`${base}/W_0123456789AB`, json({}, 'DELETE'));
  await refused(`${base}/detections/cr_xyz`);
  await refused(`${base}/detections/${D}/fix`, json({ force: true }));
  expect(
    await refused(
      `${base}/detections/${D}/pull/comments`,
      json({ body: 'Here', line: 3 }),
    ),
  ).toMatch(/needs its file/);
  await refused(
    `${base}/detections/${D}/pull/comments`,
    json({ body: 'Here', path: '../x', line: 3 }),
  );
  await refused(
    `${base}/detections/${D}/pull/comments`,
    json({ body: 'Here', path: 'a.ts', line: 0 }),
  );
  await refused(`${base}/detections/${D}/pull/comments`, json({ body: ' ' }));
  await refused(
    `${base}/detections/${D}/pull/reviews`,
    json({ event: 'REQUEST_CHANGES' }),
  );
  await refused(
    `${base}/detections/${D}/pull/reviews`,
    json({ event: 'DISMISS' }),
  );
  await refused(
    `${base}/detections/${D}/pull/merge`,
    json({ method: 'octopus' }),
  );
  expect(watchCalls()).toHaveLength(0);
  // a spec URL with the default branch left out is fine
  expect((await app.request(base, json(valid))).status).toBe(201);
});

it('answers 404 for another user’s Space without reaching its Hearth-Core', async () => {
  const { app, base, watchCalls } = fixture({
    'GET /api/watch': echo(200, { watches: [] }),
  });
  const response = await app.request(base, as('user_other'));
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Space not found.' });
  expect(
    (
      await app.request(
        `${base}/detections/${D}/pull/merge`,
        as('user_other', json({ method: 'merge' })),
      )
    ).status,
  ).toBe(404);
  expect(watchCalls()).toHaveLength(0);
});

it('passes Hearth-Core and GitHub refusals through with their detail and code', async () => {
  const { app, base } = fixture({
    [`POST /api/watch/detections/${D}/pull/reviews`]: () =>
      Response.json(
        { detail: 'Can not approve your own pull request' },
        { status: 422 },
      ),
    [`GET /api/watch/detections/${D}/pull`]: () =>
      Response.json(
        { detail: 'gh is not signed in.', code: 'github_not_connected' },
        { status: 409 },
      ),
    [`POST /api/watch/detections/${D}/pull/merge`]: () =>
      Response.json(
        { detail: 'Pull Request is not mergeable' },
        { status: 405 },
      ),
    [`POST /api/watch/${W}/check`]: () =>
      Response.json({ detail: 'A check is already running.' }, { status: 409 }),
    'GET /api/watch': () => Response.json({ detail: 'boom' }, { status: 500 }),
  });
  const approve = await app.request(
    `${base}/detections/${D}/pull/reviews`,
    json({ event: 'APPROVE' }),
  );
  expect(approve.status).toBe(422);
  expect(await approve.json()).toEqual({
    error: 'Can not approve your own pull request',
  });
  const pull = await app.request(`${base}/detections/${D}/pull`);
  expect(pull.status).toBe(409);
  expect(await pull.json()).toEqual({
    error: 'gh is not signed in.',
    code: 'github_not_connected',
  });
  const merge = await app.request(
    `${base}/detections/${D}/pull/merge`,
    json({ method: 'merge' }),
  );
  expect(merge.status).toBe(405);
  expect((await merge.json()).error).toBe('Pull Request is not mergeable');
  expect((await app.request(`${base}/${W}/check`, json({}))).status).toBe(409);
  // other failures stay a bad gateway, as on every Space route
  expect((await app.request(base)).status).toBe(502);
  // a Hearth-Core without the watch routes says so
  const old = await app.request(`${base}/detections/${D}`);
  expect(old.status).toBe(404);
  expect((await old.json()).error).toMatch(/no API watch yet/);
});

it('waits for the Space’s container like other Space routes', async () => {
  const value = base({ container: false });
  open.push(value);
  const space = value.workspace.spaces()[0];
  const response = await value.app.request(`/api/spaces/${space.id}/watch`);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ stage: 'none' });
});

it('watches a repo’s APIs from just its clone URL and branch', async () => {
  let sent: unknown;
  const { app, base } = fixture({
    'POST /api/watch/repo': async (request) => {
      sent = await request.json();
      return Response.json(
        {
          branch: 'main',
          commit: 'abc',
          providers: [
            {
              id: 'stripe',
              name: 'Stripe',
              packages: ['stripe'],
              files: ['package.json'],
            },
          ],
          validate_commands: ['npm ci', 'npm test'],
          watches: [{ ...watch, name: 'Stripe', packages: ['stripe'] }],
          existing: [],
        },
        { status: 201 },
      );
    },
  });
  const response = await app.request(
    `${base}/repo`,
    json({ repo: ' https://github.com/acme/shop.git ', base_branch: 'main' }),
  );
  expect(response.status).toBe(201);
  expect(sent).toEqual({ repo: 'acme/shop', base_branch: 'main' });
  expect((await response.json()).validate_commands).toEqual([
    'npm ci',
    'npm test',
  ]);

  // Every way a clone URL is pasted reads as owner/name.
  const sentFor = async (repo: string) => {
    await app.request(`${base}/repo`, json({ repo }));
    return (sent as { repo: string }).repo;
  };
  expect(await sentFor('https://github.com/acme/shop')).toBe('acme/shop');
  expect(await sentFor('https://github.com/acme/shop/')).toBe('acme/shop');
  expect(await sentFor('git@github.com:acme/shop.git')).toBe('acme/shop');
  expect(await sentFor('ssh://git@github.com/acme/my.repo.git')).toBe(
    'acme/my.repo',
  );

  const url = 'https://github.com/a/b.git';
  for (const bad of [
    { repo: 'acme/shop' },
    { repo: 'https://gitlab.com/a/b.git' },
    { repo: 'https://github.com/a' },
    { repo: url, spec_url: 'https://x' },
    { repo: url, base_branch: '-x' },
  ])
    expect((await app.request(`${base}/repo`, json(bad))).status).toBe(400);
  const refused = await app.request(
    `${base}/repo`,
    json({ repo: 'acme/shop' }),
  );
  expect((await refused.json()).error).toMatch(/GitHub URL/);
});
