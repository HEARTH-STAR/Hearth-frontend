import { afterEach, expect, it } from 'vitest';
import type { Commit, RepoSummary } from '../src/shared/repo-types.js';
import { as, fixture as base, type Route } from './helpers.js';

const open: { close(): void }[] = [];
afterEach(() => open.splice(0).forEach((item) => item.close()));
function fixture(core: Record<string, Route> = {}) {
  const value = base({ core });
  open.push(value);
  // The repo browser is per Space: the Hearth-Core in its container keeps the mirror.
  const space = value.workspace.spaces()[0].id;
  return {
    ...value,
    space,
    base: `/api/spaces/${space}/repos`,
    repoCalls: () =>
      value.core.calls.filter((call) => call.path.startsWith('/api/repos')),
  };
}
const SHA = 'a'.repeat(40);
const commit: Commit = {
  sha: SHA,
  short: SHA.slice(0, 7),
  subject: 'Pay with payment intents',
  author: 'Ada',
  date: '2026-10-30T10:00:00Z',
};
const summary: RepoSummary = {
  repo: 'acme/shop',
  description: 'The shop',
  html_url: 'https://github.com/acme/shop',
  clone_url: 'https://github.com/acme/shop.git',
  ssh_url: 'git@github.com:acme/shop.git',
  default_branch: 'main',
  ref: 'main',
  commit: SHA,
  branch_count: 2,
  size_bytes: 1234,
  head: commit,
  fetched_at: '2026-10-30T10:01:00Z',
};
/** Answers with the path and query Hearth-Core was asked. */
const echo: Route = (_request, url) =>
  Response.json({ path: url.pathname, query: url.search });

it('forwards each route with its path and query', async () => {
  const { app, base, repoCalls } = fixture({
    'GET /api/repos': () => Response.json({ repos: [] }),
    'GET /api/repos/*': echo,
  });
  const ask = async (path: string) => {
    const response = await app.request(`${base}${path}`);
    expect(response.status).toBe(200);
    return response.json();
  };
  expect(await ask('')).toEqual({ repos: [] });
  expect(await ask('/acme/shop')).toEqual({
    path: '/api/repos/acme/shop',
    query: '',
  });
  expect(await ask('/acme/shop?ref=feature%2Fpay')).toEqual({
    path: '/api/repos/acme/shop',
    query: '?ref=feature%2Fpay',
  });
  expect(await ask('/acme/shop/tree?ref=main&path=src%2Fpay')).toEqual({
    path: '/api/repos/acme/shop/tree',
    query: '?ref=main&path=src%2Fpay',
  });
  expect(await ask('/acme/shop/blob?path=README.md')).toEqual({
    path: '/api/repos/acme/shop/blob',
    query: '?path=README.md',
  });
  // A space, as the browser's URLSearchParams sends it, reaches Hearth-Core as a space.
  expect(await ask('/acme/shop/blob?path=docs%2Fmy+notes.md')).toEqual({
    path: '/api/repos/acme/shop/blob',
    query: '?path=docs%2Fmy+notes.md',
  });
  expect(
    await ask('/acme/shop/commits?ref=main&path=src&limit=30&skip=60'),
  ).toEqual({
    path: '/api/repos/acme/shop/commits',
    query: '?ref=main&path=src&limit=30&skip=60',
  });
  expect(await ask(`/acme/shop/commits/${SHA}`)).toEqual({
    path: `/api/repos/acme/shop/commits/${SHA}`,
    query: '',
  });
  expect(await ask('/my.org/my_repo-2/branches')).toEqual({
    path: '/api/repos/my.org/my_repo-2/branches',
    query: '',
  });
  expect(repoCalls().every((call) => call.method === 'GET')).toBe(true);
  expect(repoCalls()).toHaveLength(9);
});

it('answers with Hearth-Core’s summary unchanged', async () => {
  const { app, base } = fixture({
    'GET /api/repos/acme/shop': () => Response.json(summary),
  });
  const response = await app.request(`${base}/acme/shop`);
  expect(await response.json()).toEqual(summary);
});

it('refuses a bad owner, name, ref, path, sha, limit or skip before Hearth-Core', async () => {
  const { app, base, repoCalls } = fixture({ 'GET /api/repos/*': echo });
  const bad = [
    '/ac%20me/shop',
    '/acme/sh$op',
    '/acme/shop?ref=-x',
    '/acme/shop?ref=a%20b',
    '/acme/shop?ref=main~1',
    '/acme/shop?ref=a:b',
    `/acme/shop?ref=${'x'.repeat(256)}`,
    '/acme/shop?other=1',
    '/acme/shop/tree?path=%2Fetc',
    '/acme/shop/tree?path=src%2F..%2F..%2Fsecret',
    '/acme/shop/tree?path=a%00b',
    `/acme/shop/tree?path=${'a'.repeat(1025)}`,
    '/acme/shop/blob',
    '/acme/shop/blob?path=',
    '/acme/shop/commits/xyz1234',
    '/acme/shop/commits/abc12',
    `/acme/shop/commits/${'A'.repeat(40)}`,
    '/acme/shop/commits?limit=0',
    '/acme/shop/commits?limit=101',
    '/acme/shop/commits?limit=ten',
    '/acme/shop/commits?skip=-1',
  ];
  for (const path of bad) {
    const response = await app.request(`${base}${path}`);
    expect(response.status, path).toBe(400);
    expect(typeof ((await response.json()) as { error: unknown }).error).toBe(
      'string',
    );
  }
  expect(repoCalls()).toHaveLength(0);
});

it('answers 404 for another user’s Space without reaching its Hearth-Core', async () => {
  const { app, base, repoCalls } = fixture({ 'GET /api/repos/*': echo });
  for (const path of [
    '',
    '/acme/shop',
    '/acme/shop/tree',
    '/acme/shop/branches',
  ]) {
    const response = await app.request(`${base}${path}`, as('user_other'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Space not found.' });
  }
  expect(repoCalls()).toHaveLength(0);
});

it('passes Hearth-Core’s refusals through with their detail', async () => {
  const { app, base } = fixture({
    'GET /api/repos/acme/shop': () =>
      Response.json({ detail: 'acme/shop has no API watch.' }, { status: 404 }),
    'GET /api/repos/acme/shop/tree': () =>
      Response.json({ detail: 'Unknown ref nope.' }, { status: 400 }),
    'GET /api/repos/acme/shop/branches': () =>
      Response.json({ detail: 'git fetch failed' }, { status: 502 }),
  });
  let response = await app.request(`${base}/acme/shop`);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    error: 'acme/shop has no API watch.',
  });
  response = await app.request(`${base}/acme/shop/tree?ref=nope`);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Unknown ref nope.' });
  response = await app.request(`${base}/acme/shop/branches`);
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: 'git fetch failed' });
});

it('says when the Space’s Hearth-Core predates the repo browser', async () => {
  // The fake answers FastAPI's own 404 for a route it does not have.
  const { app, base } = fixture();
  for (const path of ['', '/acme/shop', `/acme/shop/commits/${SHA}`]) {
    const response = await app.request(`${base}${path}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error:
        'This Space’s Hearth-Core cannot browse repos yet. Update it in Setup.',
    });
  }
});
