import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { HearthCoreError } from './hearth-core.js';
import { spaceFailure, type SpaceService } from './space-service.js';

const segment = z
  .string()
  .max(100)
  .regex(/^[A-Za-z0-9_.-]+$/, 'That is not a GitHub repo.');
const sha = z.string().regex(/^[0-9a-f]{7,40}$/, 'That is not a commit sha.');
// A branch name or a sha. Git refuses spaces and ~^:?*[\ in ref names.
const ref = z
  .string()
  .min(1)
  .max(255)
  .regex(/^(?!-)[^\s~^:?*[\\]+$/, 'That is not a branch or commit.');
const path = z
  .string()
  .max(1024)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\0') &&
      !value.split('/').includes('..'),
    'That is not a path in this repo.',
  );
const limit = z.coerce
  .number()
  .int()
  .min(1, 'Ask for 1 to 100 commits.')
  .max(100, 'Ask for 1 to 100 commits.');
const skip = z.coerce.number().int().min(0, 'Skip 0 or more commits.');
const atRef = z.object({ ref: ref.optional() }).strict();
const treeQuery = z
  .object({ ref: ref.optional(), path: path.optional() })
  .strict();
const blobQuery = z
  .object({ ref: ref.optional(), path: path.pipe(z.string().min(1)) })
  .strict();
const commitsQuery = z
  .object({
    ref: ref.optional(),
    path: path.optional(),
    limit: limit.optional(),
    skip: skip.optional(),
  })
  .strict();
const none = z.object({}).strict();

/** Statuses whose Hearth-Core refusal reaches the browser as it was said. */
const PASSED = new Set([400, 403, 404, 405, 409, 422]);

/**
 * A Space's watched repos, read-only, proxied to the Hearth-Core in its container: the repo's summary,
 * its files, commits and branches, all read from the mirror Hearth-Core keeps of each watched repo.
 */
export function repoRoutes(spaces: SpaceService) {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json(
        { error: error.issues[0]?.message ?? 'Invalid repo request.' },
        400,
      );
    if (
      error instanceof HearthCoreError &&
      error.status !== undefined &&
      PASSED.has(error.status)
    ) {
      // FastAPI's own 404 for a path it lacks: this Hearth-Core predates the repo browser.
      const old = error.status === 404 && error.message === 'Not Found';
      return c.json(
        {
          error: old
            ? 'This Space’s Hearth-Core cannot browse repos yet. Update it in Setup.'
            : error.message,
        },
        error.status as ContentfulStatusCode,
      );
    }
    const failure = spaceFailure(error);
    if (failure) return c.json(failure.body, failure.status);
    return c.json({ error: 'The repo request failed.' }, 500);
  });
  const core = (id: string) => spaces.core(id);
  /** The repo named in the path, checked before it reaches Hearth-Core. */
  const repo = (owner: string, name: string) =>
    [segment.parse(owner), segment.parse(name)] as const;
  const base = '/spaces/:id/repos/:owner/:name';

  app.get('/spaces/:id/repos', async (c) => {
    none.parse(c.req.query());
    return c.json(await (await core(c.req.param('id'))).repoList());
  });
  app.get(base, async (c) => {
    const [owner, name] = repo(c.req.param('owner'), c.req.param('name'));
    const query = atRef.parse(c.req.query());
    return c.json(
      await (await core(c.req.param('id'))).repoSummary(owner, name, query.ref),
    );
  });
  app.get(`${base}/tree`, async (c) => {
    const [owner, name] = repo(c.req.param('owner'), c.req.param('name'));
    const query = treeQuery.parse(c.req.query());
    return c.json(
      await (await core(c.req.param('id'))).repoTree(owner, name, query),
    );
  });
  app.get(`${base}/blob`, async (c) => {
    const [owner, name] = repo(c.req.param('owner'), c.req.param('name'));
    const query = blobQuery.parse(c.req.query());
    return c.json(
      await (await core(c.req.param('id'))).repoBlob(owner, name, query),
    );
  });
  app.get(`${base}/commits`, async (c) => {
    const [owner, name] = repo(c.req.param('owner'), c.req.param('name'));
    const query = commitsQuery.parse(c.req.query());
    return c.json(
      await (await core(c.req.param('id'))).repoCommits(owner, name, query),
    );
  });
  app.get(`${base}/commits/:sha`, async (c) => {
    const [owner, name] = repo(c.req.param('owner'), c.req.param('name'));
    const commit = sha.parse(c.req.param('sha'));
    none.parse(c.req.query());
    return c.json(
      await (await core(c.req.param('id'))).repoCommit(owner, name, commit),
    );
  });
  app.get(`${base}/branches`, async (c) => {
    const [owner, name] = repo(c.req.param('owner'), c.req.param('name'));
    none.parse(c.req.query());
    return c.json(
      await (await core(c.req.param('id'))).repoBranches(owner, name),
    );
  });
  return app;
}
