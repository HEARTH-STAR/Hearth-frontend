import { afterEach, expect, it } from 'vitest';
import { fixture as base, json } from './helpers.js';
const open: { close(): void }[] = [];
afterEach(() => open.splice(0).forEach((item) => item.close()));
function fixture(options: Parameters<typeof base>[0] = {}) {
  const value = base(options);
  open.push(value);
  return value;
}
it('reports the computer, its folder and permissions, and saves permission changes', async () => {
  const { app, workspace } = fixture();
  const dot = workspace.dots()[0];
  const status = await (
    await app.request(`/api/dots/${dot.id}/computer`)
  ).json();
  expect(status).toMatchObject({
    state: 'running',
    directory: dot.directory,
    permissions: { files: true, shell: false },
    container: null,
    activity: [],
  });
  const patched = await app.request(
    `/api/dots/${dot.id}/computer/permissions`,
    json({ shell: true }, 'PATCH'),
  );
  expect(await patched.json()).toEqual({ files: true, shell: true });
  expect(
    (
      await app.request(
        `/api/dots/${dot.id}/computer/permissions`,
        json({ browser: true }, 'PATCH'),
      )
    ).status,
  ).toBe(400);
  expect((await app.request('/api/dots/missing/computer')).status).toBe(404);
});
it('reads files from the Dot folder only', async () => {
  const { app, workspace, core } = fixture({
    core: {
      'GET /api/workspace/files': (_request, url) =>
        Response.json({
          directory: url.searchParams.get('directory'),
          exists: true,
          files: ['notes/acme.md'],
          truncated: false,
        }),
      'GET /api/workspace/file': (_request, url) =>
        Response.json({ path: url.searchParams.get('path'), text: '# Acme' }),
    },
  });
  const dot = workspace.dots()[0];
  const listing = await (
    await app.request(`/api/dots/${dot.id}/computer/files`)
  ).json();
  expect(listing.directory).toBe(dot.directory);
  const file = await (
    await app.request(`/api/dots/${dot.id}/computer/file?path=notes/acme.md`)
  ).json();
  expect(file.path).toBe(`${dot.directory}/notes/acme.md`);
  for (const path of ['../secret', '/etc/passwd', 'a//b', 'a\\b', ''])
    expect(
      (
        await app.request(
          `/api/dots/${dot.id}/computer/file?path=${encodeURIComponent(path)}`,
        )
      ).status,
    ).toBe(400);
  expect(
    core.calls.filter((call) => call.path === '/api/workspace/file'),
  ).toHaveLength(1);
});
it('says when Hearth-Core is offline instead of failing', async () => {
  const { app, workspace } = fixture({
    core: {
      'GET /health': () => Response.json({}, { status: 500 }),
      'GET /api/workspace/files': () => {
        throw new TypeError('fetch failed');
      },
    },
  });
  const dot = workspace.dots()[0];
  const status = await (
    await app.request(`/api/dots/${dot.id}/computer`)
  ).json();
  expect(status.state).toBe('unavailable');
  expect(status.error).toBe('Hearth-Core returned HTTP 500.');
  expect((await app.request(`/api/dots/${dot.id}/computer/files`)).status).toBe(
    502,
  );
});
it('spins up a container through Hearth-backend and records an existing one', async () => {
  let taken = false;
  const { app, workspace, backend } = fixture({
    backend: {
      'POST /api/containers': () =>
        taken
          ? Response.json({ detail: 'name taken' }, { status: 409 })
          : Response.json(
              {
                id: 'abc',
                short_id: 'abc123',
                name: 'hearth-container-scout-1',
                template: 'ubuntu-26.04',
                image: 'hearth/container:ubuntu-26.04',
                status: 'running',
              },
              { status: 201 },
            ),
    },
  });
  const dot = workspace.dots()[0];
  const created = await app.request(
    `/api/dots/${dot.id}/computer/container`,
    json({}),
  );
  expect(created.status).toBe(201);
  expect(await created.json()).toMatchObject({
    name: 'hearth-container-scout-1',
    shortId: 'abc123',
    status: 'running',
  });
  expect(backend.calls.at(-1)?.body).toEqual({
    name: `scout-${dot.id.slice(0, 8)}`,
  });
  taken = true;
  const again = await (
    await app.request(`/api/dots/${dot.id}/computer/container`, json({}))
  ).json();
  expect(again).toMatchObject({
    name: 'hearth-container-scout-1',
    status: 'exists',
  });
});
