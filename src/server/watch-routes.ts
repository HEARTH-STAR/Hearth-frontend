import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { HearthCoreError } from './hearth-core.js';
import { spaceFailure, type SpaceService } from './space-service.js';

const watchId = z.string().regex(/^w_[0-9a-f]{12}$/, 'Unknown watch.');
const detectionId = z.string().regex(/^cr_[0-9a-f]{12}$/, 'Unknown detection.');
const name = z.string().trim().min(1, 'Name the watch.').max(80);
const specUrl = z
  .string()
  .trim()
  .max(2048)
  .pipe(
    z.url({
      protocol: /^https?$/,
      error: 'The spec URL must be an http(s) URL.',
    }),
  );
const repo = z
  .string()
  .trim()
  .max(200)
  .regex(/^[\w.-]+\/[\w.-]+$/, 'Name the GitHub repo as owner/name.');
// Git refuses spaces and ~^:?*[\ in branch names; GitHub's own checks follow in Hearth-Core.
const branch = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^(?!-)[^\s~^:?*[\\]+$/, 'That is not a branch name.')
  .nullable();
const commands = z
  .array(
    z
      .string()
      .trim()
      .min(1, 'A validation command is empty.')
      .max(500, 'Keep each validation command under 500 characters.'),
  )
  .min(1, 'Add at least one validation command.')
  .max(10, 'Use at most 10 validation commands.');
const interval = z
  .number()
  .int()
  .min(5, 'Check at most every 5 minutes.')
  .max(1440, 'Check at least once a day (1440 minutes).');
const created = z
  .object({
    name,
    spec_url: specUrl,
    repo,
    base_branch: branch.optional(),
    validate_commands: commands,
    interval_minutes: interval.optional(),
    auto_pr: z.boolean().optional(),
  })
  .strict();
const changed = z
  .object({
    name,
    spec_url: specUrl,
    base_branch: branch,
    validate_commands: commands,
    interval_minutes: interval,
    auto_pr: z.boolean(),
    enabled: z.boolean(),
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to change.');
/**
 * A GitHub repo as pasted to clone it — ``https://github.com/owner/name(.git)`` or
 * ``git@github.com:owner/name.git`` — read as the ``owner/name`` Hearth-Core clones and fixes.
 */
const cloneUrl = z
  .string()
  .trim()
  .max(300)
  .transform((value, ctx) => {
    const match =
      /^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(
        value,
      );
    if (!match) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Paste the repo’s GitHub URL, like https://github.com/owner/name.git.',
      });
      return z.NEVER;
    }
    return `${match[1]}/${match[2]}`;
  });
const fromRepo = z
  .object({ repo: cloneUrl, base_branch: branch.optional() })
  .strict();
const none = z.object({}).strict();
// A file in the PR's diff, as GitHub names it (it never reaches a filesystem here or in Hearth-Core).
const diffPath = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (path) =>
      !path.startsWith('/') &&
      !path.includes('\0') &&
      !path.split('/').includes('..'),
    'That is not a file in this pull request.',
  );
const comment = z
  .object({
    body: z.string().trim().min(1, 'Write a comment first.').max(65536),
    path: diffPath.optional(),
    line: z.number().int().positive().optional(),
  })
  .strict()
  .refine(
    (input) => input.line === undefined || input.path !== undefined,
    'A line comment needs its file.',
  );
const review = z
  .object({
    event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']),
    body: z.string().trim().max(65536).optional(),
  })
  .strict()
  .refine(
    (input) => input.event === 'APPROVE' || !!input.body,
    'Say what should change, or what you think.',
  );
const merge = z
  .object({ method: z.enum(['merge', 'squash', 'rebase']) })
  .strict();

/** Statuses whose Hearth-Core (and GitHub) refusal reaches the browser as it was said. */
const PASSED = new Set([400, 403, 404, 405, 409, 422]);

/**
 * A Space's API watch, proxied to the Hearth-Core in its container: the specs it polls, the breaking
 * changes it found, the AI fix of each and that fix's pull request (review and merge go through the
 * Space's gh). All of it is kept in Hearth-Core; nothing is stored here.
 */
export function watchRoutes(spaces: SpaceService) {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json(
        { error: error.issues[0]?.message ?? 'Invalid API watch request.' },
        400,
      );
    if (
      error instanceof HearthCoreError &&
      error.status !== undefined &&
      PASSED.has(error.status)
    ) {
      // FastAPI's own 404 for a path it lacks: this Hearth-Core predates API watch.
      const old = error.status === 404 && error.message === 'Not Found';
      const code = error.body?.code;
      return c.json(
        {
          error: old
            ? 'This Space’s Hearth-Core has no API watch yet. Update its container.'
            : error.message,
          ...(typeof code === 'string' ? { code } : {}),
        },
        error.status as ContentfulStatusCode,
      );
    }
    const failure = spaceFailure(error);
    if (failure) return c.json(failure.body, failure.status);
    return c.json({ error: 'The API watch request failed.' }, 500);
  });
  const core = (id: string) => spaces.core(id);
  const body = async (request: { json(): Promise<unknown> }) =>
    request.json().catch(() => null);
  /** Hearth-Core's answer, with its status (201 created, 202 started). */
  const answer = <T>(
    c: { json: (body: T, status: ContentfulStatusCode) => Response },
    result: { status: number; body: T },
  ) => c.json(result.body, result.status as ContentfulStatusCode);

  app.get('/spaces/:id/watch', async (c) =>
    answer(c, await (await core(c.req.param('id'))).watchOverview()),
  );
  app.post('/spaces/:id/watch', async (c) => {
    const input = created.parse(await body(c.req));
    return answer(c, await (await core(c.req.param('id'))).watchCreate(input));
  });
  /** Watch the APIs a repo uses: one watch per provider, its spec and validation found by Hearth-Core. */
  app.post('/spaces/:id/watch/repo', async (c) => {
    const input = fromRepo.parse(await body(c.req));
    return answer(
      c,
      await (await core(c.req.param('id'))).watchFromRepo(input),
    );
  });
  app.get('/spaces/:id/watch/detections/:detectionId', async (c) => {
    const detection = detectionId.parse(c.req.param('detectionId'));
    return answer(
      c,
      await (await core(c.req.param('id'))).detection(detection),
    );
  });
  app.post('/spaces/:id/watch/detections/:detectionId/fix', async (c) => {
    const detection = detectionId.parse(c.req.param('detectionId'));
    none.parse((await body(c.req)) ?? {});
    return answer(
      c,
      await (await core(c.req.param('id'))).detectionFix(detection),
    );
  });
  app.get('/spaces/:id/watch/detections/:detectionId/pull', async (c) => {
    const detection = detectionId.parse(c.req.param('detectionId'));
    return answer(
      c,
      await (await core(c.req.param('id'))).pullDetail(detection),
    );
  });
  app.get('/spaces/:id/watch/detections/:detectionId/pull/files', async (c) => {
    const detection = detectionId.parse(c.req.param('detectionId'));
    return answer(
      c,
      await (await core(c.req.param('id'))).pullFiles(detection),
    );
  });
  app.get(
    '/spaces/:id/watch/detections/:detectionId/pull/comments',
    async (c) => {
      const detection = detectionId.parse(c.req.param('detectionId'));
      return answer(
        c,
        await (await core(c.req.param('id'))).pullComments(detection),
      );
    },
  );
  app.post(
    '/spaces/:id/watch/detections/:detectionId/pull/comments',
    async (c) => {
      const detection = detectionId.parse(c.req.param('detectionId'));
      const input = comment.parse(await body(c.req));
      return answer(
        c,
        await (await core(c.req.param('id'))).pullComment(detection, input),
      );
    },
  );
  app.post(
    '/spaces/:id/watch/detections/:detectionId/pull/reviews',
    async (c) => {
      const detection = detectionId.parse(c.req.param('detectionId'));
      const input = review.parse(await body(c.req));
      return answer(
        c,
        await (await core(c.req.param('id'))).pullReview(detection, input),
      );
    },
  );
  app.post(
    '/spaces/:id/watch/detections/:detectionId/pull/merge',
    async (c) => {
      const detection = detectionId.parse(c.req.param('detectionId'));
      const { method } = merge.parse(await body(c.req));
      return answer(
        c,
        await (await core(c.req.param('id'))).pullMerge(detection, method),
      );
    },
  );
  app.patch('/spaces/:id/watch/:watchId', async (c) => {
    const watch = watchId.parse(c.req.param('watchId'));
    const patch = changed.parse(await body(c.req));
    return answer(
      c,
      await (await core(c.req.param('id'))).watchUpdate(watch, patch),
    );
  });
  app.delete('/spaces/:id/watch/:watchId', async (c) => {
    const watch = watchId.parse(c.req.param('watchId'));
    await (await core(c.req.param('id'))).watchDelete(watch);
    return c.body(null, 204);
  });
  app.post('/spaces/:id/watch/:watchId/check', async (c) => {
    const watch = watchId.parse(c.req.param('watchId'));
    none.parse((await body(c.req)) ?? {});
    return answer(c, await (await core(c.req.param('id'))).watchCheck(watch));
  });
  return app;
}
