import { afterEach, expect, it } from 'vitest';
import { fixture as base, json, SPACE_CONTAINER } from './helpers.js';
const open: { close(): void }[] = [];
afterEach(() => open.splice(0).forEach((item) => item.close()));
function fixture(options: Parameters<typeof base>[0] = {}) {
  const value = base(options);
  open.push(value);
  return value;
}
it('reports the computer, its home Space’s container, its folder and permissions, and saves permission changes', async () => {
  const { app, workspace } = fixture();
  const dot = workspace.dots()[0];
  const status = await (
    await app.request(`/api/dots/${dot.id}/computer`)
  ).json();
  expect(status).toEqual({
    state: 'running',
    directory: dot.directory,
    permissions: { files: true, shell: false },
    space: {
      id: dot.spaceId,
      name: 'Scout',
      stage: 'ready',
      container: SPACE_CONTAINER,
    },
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
it('lists the container’s whole workspace and reads files by their path in it', async () => {
  const { app, workspace, core, cores } = fixture({
    core: {
      'GET /api/workspace/files': (_request, url) =>
        Response.json({
          directory: url.searchParams.get('directory'),
          exists: true,
          files: ['dots/scout/notes/acme.md', 'hearth-core/server.py'],
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
  expect(listing.directory).toBe('');
  expect(listing.files).toContain('hearth-core/server.py');
  const file = await (
    await app.request(
      `/api/dots/${dot.id}/computer/file?path=${dot.directory}/notes/acme.md`,
    )
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
  // the port Docker published for the container's Hearth-Core
  expect(new Set(cores)).toEqual(new Set(['http://127.0.0.1:49153']));
});
it('says when the home Space’s Hearth-Core is still starting instead of failing', async () => {
  const { app, workspace, core } = fixture({
    core: { 'GET /health': () => Response.json({}, { status: 500 }) },
  });
  const dot = workspace.dots()[0];
  const status = await (
    await app.request(`/api/dots/${dot.id}/computer`)
  ).json();
  expect(status.state).toBe('unavailable');
  expect(status.space.stage).toBe('booting');
  expect(status.error).toBe(
    'Hearth-Core is still starting in “Scout”’s container.',
  );
  const files = await app.request(`/api/dots/${dot.id}/computer/files`);
  expect(files.status).toBe(409);
  expect(await files.json()).toMatchObject({ stage: 'booting' });
  expect(core.calls.every((call) => call.path === '/health')).toBe(true);
});
