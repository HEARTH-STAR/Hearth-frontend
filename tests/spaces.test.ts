import { afterEach, expect, it } from 'vitest';
import {
  fixture as base,
  json,
  runningSpace,
  SPACE_CONTAINER,
  type Route,
} from './helpers.js';
const open: { close(): void }[] = [];
afterEach(() => open.splice(0).forEach((item) => item.close()));
function fixture(options: Parameters<typeof base>[0] = {}) {
  const value = base(options);
  open.push(value);
  return value;
}
type Container = {
  name: string;
  status: string;
  ports: Record<string, number>;
};
/** A fake Docker behind Hearth-backend: spin-ups add containers, ``start`` runs a stopped one. */
function docker(
  spinUp?: (
    name: string,
  ) => Response | Promise<Response | undefined> | undefined,
) {
  const containers = new Map<string, Container>();
  const answer = (container: Container) =>
    Response.json({
      id: 'd'.repeat(64),
      short_id: 'd'.repeat(12),
      template: 'space',
      image: 'hearth/container:space',
      ...container,
    });
  const find = (url: URL) => {
    const name = decodeURIComponent(url.pathname.split('/')[3]);
    return containers.get(name) ?? containers.get(`hearth-container-${name}`);
  };
  const routes: Record<string, Route> = {
    'POST /api/containers': async (request) => {
      const { name } = (await request.json()) as { name: string };
      const refused = await spinUp?.(name);
      if (refused) return refused;
      const container = {
        name: `hearth-container-${name}`,
        status: 'running',
        ports: { '5010': 50001 },
      };
      containers.set(container.name, container);
      return answer(container);
    },
    'GET /api/containers/*': (_request, url) => {
      const container = find(url);
      return container
        ? answer(container)
        : Response.json({ detail: 'no container' }, { status: 404 });
    },
    'POST /api/containers/*': (_request, url) => {
      const container = find(url);
      if (!container)
        return Response.json({ detail: 'no container' }, { status: 404 });
      container.status = 'running';
      return answer(container);
    },
  };
  return { containers, routes };
}
it('creates a Space with its own container, then reaches the Hearth-Core inside', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const fake = docker(async () => {
    await gate;
    return undefined;
  });
  const { app, backend, platform, cores } = fixture({ backend: fake.routes });
  const response = await app.request(
    '/api/spaces',
    json({ name: 'Design Lab', description: 'Product design' }),
  );
  expect(response.status).toBe(201);
  const space = await response.json();
  const listed = async () =>
    (await (await app.request('/api/workspace')).json()).spaces.find(
      (item: { id: string }) => item.id === space.id,
    );
  expect(await listed()).toMatchObject({ stage: 'creating', claude: null });
  expect(
    backend.calls.find((call) => call.path === '/api/containers')?.body,
  ).toEqual({ name: `design-lab-${space.id.slice(0, 8)}`, template: 'space' });
  release();
  await platform.spaces.settled(space.id);
  const setup = await (
    await app.request(`/api/spaces/${space.id}/setup`)
  ).json();
  expect(setup).toMatchObject({
    stage: 'ready',
    container: `hearth-container-design-lab-${space.id.slice(0, 8)}`,
    status: 'running',
    coreUrl: 'http://127.0.0.1:50001',
    claude: { connected: true, email: 'owner@example.com' },
    github: null,
  });
  expect(await listed()).toMatchObject({ stage: 'ready', claude: true });
  expect(cores).toContain('http://127.0.0.1:50001');
});
it('reports a failed start plainly and starts again on request', async () => {
  let dockerUp = false;
  const fake = docker(() =>
    dockerUp
      ? undefined
      : Response.json(
          { detail: 'cannot reach the Docker daemon' },
          { status: 503 },
        ),
  );
  const { app, platform } = fixture({ backend: fake.routes });
  const space = await (
    await app.request('/api/spaces', json({ name: 'Ops' }))
  ).json();
  await platform.spaces.settled(space.id);
  const failed = await (
    await app.request(`/api/spaces/${space.id}/setup`)
  ).json();
  expect(failed).toMatchObject({
    stage: 'failed',
    error: 'Docker is not running. Start Docker Desktop, then try again.',
    claude: null,
  });
  dockerUp = true;
  const again = await app.request(
    `/api/spaces/${space.id}/container`,
    json({}),
  );
  expect(again.status).toBe(202);
  expect((await again.json()).stage).toBe('creating');
  await platform.spaces.settled(space.id);
  expect(
    (await (await app.request(`/api/spaces/${space.id}/setup`)).json()).stage,
  ).toBe('ready');
  expect(
    (await app.request('/api/spaces/nope/container', json({}))).status,
  ).toBe(404);
});
it('starts a stopped container again, and adopts one a lost answer left behind', async () => {
  let status = 'exited';
  const { app, backend, platform, workspace } = fixture({
    backend: {
      [`GET /api/containers/${SPACE_CONTAINER}`]: () =>
        status === 'running'
          ? runningSpace()
          : Response.json({ name: SPACE_CONTAINER, status, ports: {} }),
      [`POST /api/containers/${SPACE_CONTAINER}/start`]: () => {
        status = 'running';
        return runningSpace();
      },
    },
  });
  const everyday = workspace.spaces()[0];
  const stageOf = async (id: string, app_ = app) =>
    (await (await app_.request(`/api/spaces/${id}/setup`)).json()).stage;
  expect(await stageOf(everyday.id)).toBe('stopped');
  await app.request(`/api/spaces/${everyday.id}/container`, json({}));
  await platform.spaces.settled(everyday.id);
  expect(await stageOf(everyday.id)).toBe('ready');
  expect(backend.calls.map((call) => `${call.method} ${call.path}`)).toContain(
    `POST /api/containers/${SPACE_CONTAINER}/start`,
  );

  const fake = docker((name) => {
    fake.containers.set(`hearth-container-${name}`, {
      name: `hearth-container-${name}`,
      status: 'running',
      ports: { '5010': 50002 },
    });
    return Response.json({ detail: 'name already in use' }, { status: 409 });
  });
  const other = fixture({ backend: fake.routes });
  const space = await (
    await other.app.request('/api/spaces', json({ name: 'Notes' }))
  ).json();
  await other.platform.spaces.settled(space.id);
  expect(
    await (await other.app.request(`/api/spaces/${space.id}/setup`)).json(),
  ).toMatchObject({
    stage: 'ready',
    container: `hearth-container-notes-${space.id.slice(0, 8)}`,
  });
});
it('signs Claude Code in inside the Space through its Hearth-Core', async () => {
  let signedIn = false;
  const { app, core, workspace } = fixture({
    core: {
      'GET /api/connectors/claude-code/status': () =>
        Response.json(
          signedIn
            ? {
                status: 'connected',
                method: 'claude.ai',
                email: 'owner@example.com',
                subscription: 'max',
                login_supported: true,
              }
            : { status: 'needs_auth', login_supported: true },
        ),
      'POST /api/connectors/claude-code/login/start': () =>
        Response.json({
          session_id: 'abcdef0123456789',
          auth_url: 'https://claude.com/cai/oauth/authorize?code=true&state=s',
          expires_in: 600,
        }),
      'POST /api/connectors/claude-code/login/code': async (request) => {
        const { code } = (await request.json()) as { code: string };
        if (code !== 'good#state')
          return Response.json({
            status: 'invalid_code',
            session_id: 'abcdef0123456789',
            error: 'Invalid code. Please make sure the full code was copied',
          });
        signedIn = true;
        return Response.json({
          status: 'connected',
          session_id: 'abcdef0123456789',
        });
      },
      'POST /api/connectors/claude-code/login/cancel': () =>
        Response.json({ status: 'cancelled' }),
      'POST /api/connectors/claude-code/logout': () => {
        signedIn = false;
        return Response.json({ status: 'needs_auth', login_supported: true });
      },
    },
  });
  const base = `/api/spaces/${workspace.spaces()[0].id}/claude`;
  expect(await (await app.request(base)).json()).toEqual({
    connected: false,
    method: null,
    email: null,
    organization: null,
    subscription: null,
    loginSupported: true,
  });
  expect(
    (await (await app.request('/api/workspace')).json()).spaces[0].claude,
  ).toBe(false);
  const login = await (await app.request(`${base}/login`, json({}))).json();
  expect(login).toEqual({
    sessionId: 'abcdef0123456789',
    authUrl: 'https://claude.com/cai/oauth/authorize?code=true&state=s',
    expiresIn: 600,
  });
  const send = (code: string) =>
    app.request(
      `${base}/login/code`,
      json({ sessionId: login.sessionId, code }),
    );
  expect(await (await send('bad#state')).json()).toEqual({
    status: 'invalid_code',
    error: 'Invalid code. Please make sure the full code was copied',
  });
  expect(await (await send('  good#state  ')).json()).toMatchObject({
    status: 'connected',
    claude: {
      connected: true,
      email: 'owner@example.com',
      subscription: 'max',
    },
  });
  // the sign-in shows at once: the cached status was dropped
  expect(
    (await (await app.request('/api/workspace')).json()).spaces[0].claude,
  ).toBe(true);
  // the code went to Hearth-Core once and is in no other request
  expect(
    core.calls.filter((call) =>
      JSON.stringify(call.body ?? '').includes('good#state'),
    ),
  ).toHaveLength(1);
  expect(
    (
      await app.request(
        `${base}/login/code`,
        json({ sessionId: '../x', code: 'a' }),
      )
    ).status,
  ).toBe(400);
  expect(
    await (
      await app.request(
        `${base}/login/cancel`,
        json({ sessionId: login.sessionId }),
      )
    ).json(),
  ).toEqual({ ok: true });
  expect(
    await (await app.request(`${base}/logout`, json({}))).json(),
  ).toMatchObject({ connected: false });
});
it('keeps Claude Code sign-in waiting until the container runs', async () => {
  const { app, workspace, core } = fixture({ container: false });
  const space = workspace.spaces()[0];
  const response = await app.request(
    `/api/spaces/${space.id}/claude/login`,
    json({}),
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ stage: 'none' });
  expect(
    await (await app.request(`/api/spaces/${space.id}/setup`)).json(),
  ).toEqual({
    stage: 'none',
    container: null,
    status: null,
    coreUrl: null,
    claude: null,
    github: null,
  });
  expect(core.calls).toHaveLength(0);
});
