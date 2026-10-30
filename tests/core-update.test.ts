import { afterEach, expect, it } from 'vitest';
import {
  as,
  fixture as base,
  json,
  SPACE_CONTAINER,
  type Route,
} from './helpers.js';
const open: { close(): void }[] = [];
afterEach(() => open.splice(0).forEach((item) => item.close()));
function fixture(
  core: Record<string, Route>,
  backend: Record<string, Route> = {},
) {
  const value = base({ core, backend });
  open.push(value);
  const space = value.workspace.spaces()[0];
  return {
    ...value,
    path: `/api/spaces/${space.id}/core`,
  };
}
const repos = `/api/containers/${SPACE_CONTAINER}/repos`;
const first = { sha: 'a'.repeat(40), subject: 'first', date: '2026-10-29' };
const second = { sha: 'b'.repeat(40), subject: 'second', date: '2026-10-30' };

it('reports the running Hearth-Core and a newer commit on main', async () => {
  const { app, core, path } = fixture({
    'GET /api/core/version': () =>
      Response.json({
        enabled: true,
        branch: 'main',
        current: first,
        latest: second,
        update_available: true,
        checked_at: '2026-10-30T00:00:00Z',
        error: null,
      }),
  });
  const response = await app.request(`${path}?refresh=true`);
  expect(await response.json()).toEqual({
    supported: true,
    enabled: true,
    branch: 'main',
    current: first,
    latest: second,
    updateAvailable: true,
    checkedAt: '2026-10-30T00:00:00Z',
    error: null,
  });
  expect(core.calls.at(-1)).toMatchObject({ path: '/api/core/version' });
});

it('calls a Hearth-Core from before updates unsupported, not broken', async () => {
  const { app, path } = fixture({});
  const response = await app.request(path);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    supported: false,
    updateAvailable: false,
  });
});

it('updates, and passes Hearth-Core’s refusals on as 409', async () => {
  let refuse = false;
  const { app, core, path } = fixture({
    'POST /api/core/update': () =>
      refuse
        ? Response.json(
            {
              detail:
                'An API watch fix is running; a restart would stop it. Update when it has finished.',
            },
            { status: 409 },
          )
        : Response.json({
            updated: true,
            restarting: true,
            from: first,
            to: second,
          }),
  });
  const ok = await app.request(`${path}/update`, json({}));
  expect(await ok.json()).toMatchObject({ updated: true, to: second });
  expect(core.calls.at(-1)).toMatchObject({
    method: 'POST',
    path: '/api/core/update',
  });

  refuse = true;
  const busy = await app.request(`${path}/update`, json({}));
  expect(busy.status).toBe(409);
  expect((await busy.json()).error).toMatch(/API watch fix is running/);
});

it('answers 404 for another user’s Space', async () => {
  const { app, core, path } = fixture({});
  const response = await app.request(
    `${path}/update`,
    as('user_other', json({})),
  );
  expect(response.status).toBe(404);
  expect(core.calls.filter((call) => call.path === '/api/core/update')).toEqual(
    [],
  );
});

// Hearth-backend reads and updates any Docker container's Hearth-Core, however old.
it('asks Hearth-backend first, so an old container still gets Update', async () => {
  const { app, core, path } = fixture(
    {},
    {
      [`GET ${repos}`]: () =>
        Response.json({
          repos: [
            {
              repo: 'HEARTH-STAR/Hearth-Core',
              ref: 'main',
              path: '/workspace/hearth-core',
              current: first,
              latest: second,
              update_available: true,
              error: null,
            },
          ],
        }),
      [`POST ${repos}/update`]: () =>
        Response.json({
          updated: true,
          restarting: true,
          repos: [
            {
              repo: 'HEARTH-STAR/Hearth-Core',
              from: first,
              to: second,
              updated: true,
            },
          ],
        }),
    },
  );
  expect(await (await app.request(path)).json()).toMatchObject({
    supported: true,
    enabled: true,
    branch: 'main',
    current: first,
    latest: second,
    updateAvailable: true,
  });
  const update = await app.request(`${path}/update`, json({}));
  expect(await update.json()).toEqual({
    updated: true,
    restarting: true,
    from: first,
    to: second,
  });
  expect(
    core.calls.filter((call) => call.path.startsWith('/api/core')),
  ).toEqual([]);
});

it('passes Hearth-backend’s refusal on, and falls back to Hearth-Core on Azure', async () => {
  const refused = fixture(
    {},
    {
      [`POST ${repos}/update`]: () =>
        Response.json(
          {
            detail:
              'HEARTH-STAR/Hearth-Core has local changes; an update would discard them',
          },
          { status: 409 },
        ),
    },
  );
  const response = await refused.app.request(
    `${refused.path}/update`,
    json({}),
  );
  expect(response.status).toBe(409);
  expect((await response.json()).error).toMatch(/local changes/);

  const azure = fixture(
    {
      'GET /api/core/version': () =>
        Response.json({
          enabled: true,
          branch: 'main',
          current: first,
          latest: first,
          update_available: false,
          checked_at: null,
          error: null,
        }),
    },
    {
      [`GET ${repos}`]: () =>
        Response.json(
          { detail: 'Azure containers cannot run git' },
          { status: 501 },
        ),
    },
  );
  expect(await (await azure.app.request(azure.path)).json()).toMatchObject({
    supported: true,
    updateAvailable: false,
  });
  expect(azure.core.calls.at(-1)).toMatchObject({ path: '/api/core/version' });
});
