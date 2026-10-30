import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it } from 'vitest';
import { SpaceSetup } from '../src/client/SpaceSetup.js';
import { splitLogs } from '../src/server/space-service.js';
import {
  as,
  fixture as base,
  json,
  SPACE_CONTAINER,
  type Route,
} from './helpers.js';
const open: { close(): void }[] = [];
afterEach(() => open.splice(0).forEach((item) => item.close()));
function fixture(backend: Record<string, Route>) {
  const value = base({ backend });
  open.push(value);
  return {
    ...value,
    path: `/api/spaces/${value.workspace.spaces()[0].id}/container`,
  };
}
const container = `/api/containers/${SPACE_CONTAINER}`;

it('splits a container’s output into build and agent lines, without the polling noise', () => {
  expect(
    splitLogs([
      'hearth-space: waiting for /workspace/hearth-core',
      "hearth-space: installing Hearth-Core's requirements",
      'Collecting fastapi>=0.141.1',
      '  Downloading fastapi-0.141.1-py3-none-any.whl (95 kB)',
      'INFO:     Uvicorn running on http://0.0.0.0:5010',
      'INFO:     172.17.0.1:57912 - "GET /health HTTP/1.1" 200 OK',
      'INFO:     172.17.0.1:5 - "GET /api/connectors/claude-code/status HTTP/1.1" 200 OK',
      'INFO:     172.17.0.1:5 - "POST /api/chat HTTP/1.1" 200 OK',
      'INFO:     172.17.0.1:5 - "GET /health HTTP/1.1" 503 Service Unavailable',
    ]),
  ).toEqual({
    build: [
      'hearth-space: waiting for /workspace/hearth-core',
      "hearth-space: installing Hearth-Core's requirements",
      'Collecting fastapi>=0.141.1',
      '  Downloading fastapi-0.141.1-py3-none-any.whl (95 kB)',
    ],
    agent: [
      'INFO:     Uvicorn running on http://0.0.0.0:5010',
      'INFO:     172.17.0.1:5 - "POST /api/chat HTTP/1.1" 200 OK',
      'INFO:     172.17.0.1:5 - "GET /health HTTP/1.1" 503 Service Unavailable',
    ],
  });
});

it('reads the container’s logs through Hearth-backend, and says when it cannot', async () => {
  const { app, backend, path } = fixture({
    [`GET ${container}/logs`]: () =>
      Response.json({
        lines: ['hearth-space: starting Hearth-Core', 'INFO: ready'],
      }),
  });
  expect(await (await app.request(`${path}/logs`)).json()).toEqual({
    supported: true,
    build: ['hearth-space: starting Hearth-Core'],
    agent: ['INFO: ready'],
  });
  expect(backend.calls.at(-1)?.path).toBe(`${container}/logs`);

  const azure = fixture({
    [`GET ${container}/logs`]: () =>
      Response.json({ detail: 'not on Azure yet' }, { status: 501 }),
  });
  expect(await (await azure.app.request(`${azure.path}/logs`)).json()).toEqual({
    supported: false,
    agent: [],
    build: [],
  });
});

it('stops the container, and only for its owner', async () => {
  const { app, backend, path } = fixture({
    [`POST ${container}/stop`]: () =>
      Response.json({
        id: 'c1',
        short_id: 'c1',
        name: SPACE_CONTAINER,
        template: 'space',
        image: 'hearth/container:space',
        status: 'exited',
        ports: {},
      }),
  });
  const stranger = await app.request(
    `${path}/stop`,
    as('user_other', json({})),
  );
  expect(stranger.status).toBe(404);
  expect(backend.calls.some((call) => call.path.endsWith('/stop'))).toBe(false);

  const response = await app.request(`${path}/stop`, json({}));
  expect(response.status).toBe(200);
  expect(backend.calls.some((call) => call.path === `${container}/stop`)).toBe(
    true,
  );
});

it('lays Setup out as a console: identity, status & metadata, machine logs', () => {
  const html = renderToStaticMarkup(
    <SpaceSetup
      space={
        {
          id: 'space_1',
          name: 'Scout',
          description: '',
          stage: 'ready',
          agent: 'claude_code',
          pageCount: 0,
        } as never
      }
      onChanged={() => {}}
    />,
  );
  expect(html).toContain('CLAUDE');
  expect(html).toContain('Scout');
  expect(html).toContain('claude-code');
  expect(html).toContain('Status &amp; Metadata');
  expect(html).toContain('Hearth-Core API');
  expect(html).toContain('Machine Logs');
  expect(html).toContain('Agent Logs');
  expect(html).toContain('Build Logs');
  expect(html).toContain('>Stop<');
  expect(html).toMatch(/<button class="console-update" disabled=""/);
});
