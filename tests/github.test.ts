import { afterEach, expect, it } from 'vitest';
import { githubStatus } from '../src/server/github-routes.js';
import { fixture as base, json, type Route } from './helpers.js';
const open: { close(): void }[] = [];
afterEach(() => open.splice(0).forEach((item) => item.close()));
function fixture(core: Record<string, Route>) {
  const value = base({ core });
  open.push(value);
  // GitHub is per Space: gh runs inside the Space's container.
  return {
    ...value,
    gh: `/api/spaces/${value.workspace.spaces()[0].id}/github`,
  };
}
const status = (body: Record<string, unknown>) => () => Response.json(body);
const connected = {
  status: 'connected',
  username: 'hearth-bot',
  auth_method: 'pat',
  expires_at: '2027-01-01T00:00:00Z',
  gh_status: 'github.com\n  ✓ Logged in to github.com account hearth-bot',
};
it('shows the connection the way the app reads it', () => {
  expect(
    githubStatus({ status: 'needs_auth', gh_status: 'not logged in' }),
  ).toEqual({
    connected: false,
    username: null,
    name: null,
    method: null,
    expiresAt: null,
    warnings: [],
    detail: 'not logged in',
  });
  expect(
    githubStatus({ ...connected, auth_method: null, warning: 'Expires soon' }),
  ).toMatchObject({
    connected: true,
    username: 'hearth-bot',
    method: 'terminal',
    warnings: ['Expires soon'],
  });
  expect(githubStatus({ ...connected, auth_method: 'cli' }).method).toBe(
    'device',
  );
});
it('connects with a token and answers with what gh now reports', async () => {
  let sent: unknown;
  const { app, core, gh } = fixture({
    'GET /api/connectors/github/status': status(connected),
    'POST /api/connectors/github/token': async (request) => {
      sent = await request.json();
      return Response.json({
        ...connected,
        name: 'Hearth Bot',
        warnings: ['Fine-grained token'],
      });
    },
  });
  const response = await app.request(
    `${gh}/token`,
    json({ token: '  github_pat_abc  ' }),
  );
  expect(response.status).toBe(200);
  expect(sent).toEqual({ token: 'github_pat_abc' });
  expect(await response.json()).toMatchObject({
    connected: true,
    username: 'hearth-bot',
    name: 'Hearth Bot',
    method: 'token',
    warnings: ['Fine-grained token'],
    detail: connected.gh_status,
  });
  // the token went to Hearth-Core once and is in no other request
  expect(
    core.calls.filter((call) =>
      JSON.stringify(call.body ?? '').includes('github_pat'),
    ),
  ).toHaveLength(1);
});
it('names missing scopes and passes other refusals through', async () => {
  const { app, gh } = fixture({
    'POST /api/connectors/github/token': () =>
      Response.json(
        {
          status: 'needs_auth',
          error: 'Token lacks scopes',
          code: 'missing_scopes',
          missing_scopes: ['repo', 'read:org'],
        },
        { status: 400 },
      ),
  });
  const refused = await app.request(`${gh}/token`, json({ token: 'ghp_x' }));
  expect(refused.status).toBe(400);
  expect(await refused.json()).toEqual({
    error: 'Token lacks scopes',
    code: 'missing_scopes',
    missingScopes: ['repo', 'read:org'],
  });
  expect((await app.request(`${gh}/token`, json({ token: '' }))).status).toBe(
    400,
  );
});
it('runs the device sign-in: code, waiting, then connected', async () => {
  let done = false;
  const { app, gh } = fixture({
    'GET /api/connectors/github/status': status(connected),
    'POST /api/connectors/github/cli/start': status({
      session_id: 'abcdef0123456789',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
    }),
    'POST /api/connectors/github/cli/poll': () =>
      Response.json(
        done
          ? { ...connected, auth_method: 'cli' }
          : {
              status: 'pending',
              user_code: 'ABCD-1234',
              verification_uri: 'https://github.com/login/device',
            },
      ),
    'POST /api/connectors/github/cli/cancel': status({ status: 'cancelled' }),
  });
  const started = await (await app.request(`${gh}/device`, json({}))).json();
  expect(started).toEqual({
    sessionId: 'abcdef0123456789',
    userCode: 'ABCD-1234',
    verificationUri: 'https://github.com/login/device',
    expiresIn: 900,
  });
  const poll = () =>
    app.request(`${gh}/device/poll`, json({ sessionId: started.sessionId }));
  expect(await (await poll()).json()).toEqual({
    pending: true,
    userCode: 'ABCD-1234',
    verificationUri: 'https://github.com/login/device',
  });
  done = true;
  expect(await (await poll()).json()).toMatchObject({
    pending: false,
    status: { connected: true, username: 'hearth-bot' },
  });
  expect(
    (await app.request(`${gh}/device/poll`, json({ sessionId: '../x' })))
      .status,
  ).toBe(400);
  expect(
    await (
      await app.request(
        `${gh}/device/cancel`,
        json({ sessionId: started.sessionId }),
      )
    ).json(),
  ).toEqual({ ok: true });
});
it('reports an expired sign-in, a disconnect, and Hearth-Core being offline', async () => {
  const { app, gh } = fixture({
    'GET /api/connectors/github/status': status({
      status: 'needs_auth',
      gh_status: 'not logged in',
    }),
    'POST /api/connectors/github/cli/poll': () =>
      Response.json(
        { detail: 'Unknown or expired CLI login session. Start a new one.' },
        { status: 404 },
      ),
    'POST /api/connectors/github/disconnect': status({ status: 'needs_auth' }),
  });
  const expired = await app.request(
    `${gh}/device/poll`,
    json({ sessionId: 'abcdef01' }),
  );
  expect(expired.status).toBe(404);
  expect((await expired.json()).error).toMatch(/expired/);
  expect(
    await (await app.request(`${gh}/disconnect`, json({}))).json(),
  ).toMatchObject({ connected: false });
  const offline = fixture({
    'GET /api/connectors/github/status': () => {
      throw new TypeError('fetch failed');
    },
  });
  const response = await offline.app.request(offline.gh);
  expect(response.status).toBe(502);
  expect((await response.json()).error).toMatch(/Hearth-Core is not reachable/);
});
it('waits for the Space’s container before reaching gh', async () => {
  const value = base({ container: false });
  open.push(value);
  const space = value.workspace.spaces()[0];
  const response = await value.app.request(`/api/spaces/${space.id}/github`);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    stage: 'none',
    error: expect.stringMatching(/has no container yet/),
  });
  expect(value.core.calls).toHaveLength(0);
  expect((await value.app.request('/api/spaces/nope/github')).status).toBe(404);
});
