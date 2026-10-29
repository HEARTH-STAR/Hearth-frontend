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
  // A Space is made with its Dot, and shares the Dot's id.
  const response = await app.request('/api/dots', json({ name: 'Design Lab' }));
  expect(response.status).toBe(201);
  const dot = await response.json();
  const space = { id: dot.spaceId as string };
  expect(space.id).toBe(dot.id);
  const listed = async () =>
    (await (await app.request('/api/workspace')).json()).spaces.find(
      (item: { id: string }) => item.id === space.id,
    );
  expect(await listed()).toMatchObject({ stage: 'creating', signedIn: null });
  expect(
    backend.calls.find((call) => call.path === '/api/containers')?.body,
  ).toEqual({ name: space.id, template: 'space' });
  release();
  await platform.spaces.settled(space.id);
  const setup = await (
    await app.request(`/api/spaces/${space.id}/setup`)
  ).json();
  expect(setup).toMatchObject({
    stage: 'ready',
    container: `hearth-container-${space.id}`,
    status: 'running',
    coreUrl: 'http://127.0.0.1:50001',
    agent: { connected: true, email: 'owner@example.com' },
    github: null,
  });
  expect(await listed()).toMatchObject({ stage: 'ready', signedIn: true });
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
  const space = {
    id: (await (await app.request('/api/dots', json({ name: 'Ops' }))).json())
      .spaceId as string,
  };
  await platform.spaces.settled(space.id);
  const failed = await (
    await app.request(`/api/spaces/${space.id}/setup`)
  ).json();
  expect(failed).toMatchObject({
    stage: 'failed',
    error: 'Docker is not running. Start Docker Desktop, then try again.',
    agent: null,
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
  const space = {
    id: (
      await (
        await other.app.request('/api/dots', json({ name: 'Notes' }))
      ).json()
    ).spaceId as string,
  };
  await other.platform.spaces.settled(space.id);
  expect(
    await (await other.app.request(`/api/spaces/${space.id}/setup`)).json(),
  ).toMatchObject({
    stage: 'ready',
    container: `hearth-container-${space.id}`,
  });
});
it('reaches Hearth-Core at the host Hearth-backend reports (an Azure private IP)', async () => {
  let host = '10.40.1.4';
  const { app, cores, platform, workspace } = fixture({
    backend: {
      [`GET /api/containers/${SPACE_CONTAINER}`]: async () =>
        Response.json({
          ...(await runningSpace({ '5010': 5010 }).json()),
          host,
        }),
    },
  });
  const everyday = workspace.spaces()[0];
  expect(
    await (await app.request(`/api/spaces/${everyday.id}/setup`)).json(),
  ).toMatchObject({ stage: 'ready', coreUrl: 'http://10.40.1.4:5010' });
  host = '10.40.1.9'; // a restarted container group can get a new private IP
  expect(await platform.spaces.probe(everyday.id, true)).toMatchObject({
    stage: 'ready',
    url: 'http://10.40.1.9:5010',
  });
  expect(cores).toEqual(
    expect.arrayContaining(['http://10.40.1.4:5010', 'http://10.40.1.9:5010']),
  );
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
  const base = `/api/spaces/${workspace.spaces()[0].id}/agent`;
  expect(await (await app.request(base)).json()).toEqual({
    connected: false,
    method: null,
    email: null,
    organization: null,
    subscription: null,
    loginSupported: true,
  });
  expect(
    (await (await app.request('/api/workspace')).json()).spaces[0].signedIn,
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
    agent: {
      connected: true,
      email: 'owner@example.com',
      subscription: 'max',
    },
  });
  // the sign-in shows at once: the cached status was dropped
  expect(
    (await (await app.request('/api/workspace')).json()).spaces[0].signedIn,
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
it('gives each new Dot its own Space and starts its container', async () => {
  const fake = docker();
  const { app, backend, platform, workspace } = fixture({
    backend: fake.routes,
  });
  const before = workspace.spaces().length;
  const response = await app.request(
    '/api/dots',
    json({ name: 'Quill', instructions: 'Write briefs.' }),
  );
  expect(response.status).toBe(201);
  const dot = await response.json();
  const space = workspace.space(dot.spaceId)!;
  expect(space).toMatchObject({ name: 'Quill', description: '' });
  expect(dot.spaceIds).toEqual([space.id]);
  expect(workspace.spaces()).toHaveLength(before + 1);
  expect(
    backend.calls.find((call) => call.path === '/api/containers')?.body,
  ).toEqual({ name: space.id, template: 'space' });
  await platform.spaces.settled(space.id);
  expect(
    (await (await app.request(`/api/spaces/${space.id}/setup`)).json()).stage,
  ).toBe('ready');
  // an edit without a Space keeps the Dot where it is
  const edited = await (
    await app.request(
      `/api/dots/${dot.id}`,
      json({ name: 'Quill', instructions: 'Write shorter briefs.' }, 'PUT'),
    )
  ).json();
  expect(edited).toMatchObject({ spaceId: space.id, spaceIds: [space.id] });
  // a name is all the + button sends: the instructions default, and an edit keeps them
  const named = await (
    await app.request('/api/dots', json({ name: 'Wren' }))
  ).json();
  expect(named.instructions).toBe(workspace.dots()[0].instructions);
  expect(workspace.space(named.spaceId)?.name).toBe('Wren');
  await app.request(
    `/api/dots/${named.id}`,
    json({ name: 'Wren', directory: 'dots/wren' }, 'PUT'),
  );
  expect(workspace.dot(named.id)?.instructions).toBe(named.instructions);
  await platform.spaces.settled(named.spaceId);
  // access to a Space that does not exist (or is another user's) creates nothing
  const refused = await app.request(
    '/api/dots',
    json({ name: 'Ghost', instructions: 'Nothing.', spaceIds: ['nope'] }),
  );
  expect(refused.status).toBe(404);
  expect(workspace.spaces()).toHaveLength(before + 2);
});
it('keeps Claude Code sign-in waiting until the container runs', async () => {
  const { app, workspace, core } = fixture({ container: false });
  const space = workspace.spaces()[0];
  const response = await app.request(
    `/api/spaces/${space.id}/agent/login`,
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
    agent: null,
    github: null,
  });
  expect(core.calls).toHaveLength(0);
});
it('gives a Dot the agent it picked, and signs that agent in through its own connector', async () => {
  let approved = false;
  const fake = docker();
  const { app, backend, core, platform, workspace } = fixture({
    backend: fake.routes,
    core: {
      'GET /api/connectors/cursor/status': () =>
        Response.json(
          approved
            ? {
                status: 'connected',
                method: 'login',
                email: 'owner@example.com',
                login_supported: true,
              }
            : { status: 'needs_auth', login_supported: true },
        ),
      'POST /api/connectors/cursor/login/start': () =>
        Response.json({
          session_id: 'cafe0123456789ab',
          auth_url: 'https://cursor.com/loginDeepControl?uuid=u&mode=login',
          expires_in: 600,
        }),
      'POST /api/connectors/cursor/login/poll': () => {
        const status = approved ? 'connected' : 'pending';
        approved = true; // the owner approves between two polls
        return Response.json({ status, session_id: 'cafe0123456789ab' });
      },
    },
  });
  const dot = await (
    await app.request('/api/dots', json({ name: 'Cora', agent: 'cursor' }))
  ).json();
  const space = workspace.space(dot.spaceId)!;
  expect(space.agent).toBe('cursor');
  expect(
    backend.calls.find((call) => call.path === '/api/containers')?.body,
  ).toEqual({
    name: space.id,
    template: 'space',
    agent: 'cursor',
  });
  await platform.spaces.settled(space.id);
  const base = `/api/spaces/${space.id}/agent`;
  expect(await (await app.request(base)).json()).toMatchObject({
    connected: false,
    loginSupported: true,
  });
  // Cursor's sign-in has no code: the link, then polls until the CLI finishes
  expect(await (await app.request(`${base}/login`, json({}))).json()).toEqual({
    sessionId: 'cafe0123456789ab',
    authUrl: 'https://cursor.com/loginDeepControl?uuid=u&mode=login',
    expiresIn: 600,
  });
  const poll = () =>
    app.request(`${base}/login/poll`, json({ sessionId: 'cafe0123456789ab' }));
  expect(await (await poll()).json()).toEqual({ status: 'pending' });
  expect(await (await poll()).json()).toMatchObject({
    status: 'connected',
    agent: { connected: true, email: 'owner@example.com' },
  });
  expect(
    (await (await app.request('/api/workspace')).json()).spaces.find(
      (item: { id: string }) => item.id === space.id,
    ),
  ).toMatchObject({ agent: 'cursor', signedIn: true });
  // the Space's own agent answered (every Space shares the fixture's one fake Hearth-Core)
  expect(
    core.calls.filter((call) => call.path.startsWith('/api/connectors/cursor/'))
      .length,
  ).toBeGreaterThanOrEqual(4);
});
it('reports an agent that was already signed in instead of a sign-in link', async () => {
  const fake = docker();
  const { app, platform, workspace } = fixture({
    backend: fake.routes,
    core: {
      'POST /api/connectors/antigravity/login/start': () =>
        Response.json({
          session_id: null,
          auth_url: null,
          expires_in: 0,
          status: 'connected',
        }),
    },
  });
  const dot = await (
    await app.request('/api/dots', json({ name: 'Gale', agent: 'antigravity' }))
  ).json();
  await platform.spaces.settled(dot.spaceId);
  expect(workspace.space(dot.spaceId)?.agent).toBe('antigravity');
  expect(
    await (
      await app.request(`/api/spaces/${dot.spaceId}/agent/login`, json({}))
    ).json(),
  ).toEqual({ sessionId: '', authUrl: '', expiresIn: 0, connected: true });
});
it('fixes a Dot’s agent when it is made, and refuses unknown ones', async () => {
  const fake = docker();
  const { app, backend, workspace } = fixture({ backend: fake.routes });
  const home = workspace.spaces()[0];
  // Spaces made before agents could be picked, and Dots made without one, run Claude Code
  expect(home.agent).toBe('claude_code');
  for (const body of [
    { name: 'Nope', agent: 'opencode' },
    { name: 'Nope', agent: 'cursor', spaceId: home.id },
  ])
    expect((await app.request('/api/dots', json(body))).status).toBe(400);
  const dot = workspace.dots()[0];
  expect(
    (
      await app.request(
        `/api/dots/${dot.id}`,
        json({ name: dot.name, agent: 'cursor' }, 'PUT'),
      )
    ).status,
  ).toBe(400);
  // a Claude Dot sends no agent, so an older Hearth-backend still spins it up
  const claude = await (
    await app.request('/api/dots', json({ name: 'Plain' }))
  ).json();
  expect(workspace.space(claude.spaceId)?.agent).toBe('claude_code');
  expect(
    backend.calls.filter((call) => call.path === '/api/containers').at(-1)
      ?.body,
  ).not.toHaveProperty('agent');
});
