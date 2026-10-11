import { Hono } from 'hono';
import { z } from 'zod';
import type { GitHubDeviceLogin, GitHubDevicePoll } from '../shared/types.js';
import { githubStatus } from './connections.js';
import { HearthCoreError, type GitHubConnection } from './hearth-core.js';
import { spaceFailure, type SpaceService } from './space-service.js';

export { githubStatus };

const session = z
  .object({ sessionId: z.string().regex(/^[0-9a-f]{8,64}$/) })
  .strict();
/**
 * A Space's GitHub connection, proxied to the Hearth-Core in its container (gh holds the account
 * there), so the browser never reaches Hearth-Core. A token passes through once and is never stored
 * or echoed here.
 */
export function githubRoutes(spaces: SpaceService) {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json({ error: 'Invalid GitHub request.' }, 400);
    if (
      error instanceof HearthCoreError &&
      error.body?.code === 'missing_scopes'
    )
      return c.json(
        {
          error: error.message,
          code: 'missing_scopes',
          missingScopes: Array.isArray(error.body.missing_scopes)
            ? error.body.missing_scopes
            : [],
        },
        error.status === 400 ? 400 : 502,
      );
    const failure = spaceFailure(error);
    if (failure) return c.json(failure.body, failure.status);
    return c.json({ error: 'The GitHub request failed.' }, 500);
  });
  const core = (id: string) => spaces.core(id);
  // A connect answer has the name and warnings; the status call adds what gh now reports.
  const settled = async (id: string, raw: GitHubConnection) =>
    githubStatus({ ...raw, ...(await (await core(id)).githubStatus()) });
  app.get('/spaces/:id/github', async (c) =>
    c.json(githubStatus(await (await core(c.req.param('id'))).githubStatus())),
  );
  app.post('/spaces/:id/github/token', async (c) => {
    const id = c.req.param('id');
    const { token } = z
      .object({ token: z.string().trim().min(1).max(512) })
      .strict()
      .parse(await c.req.json());
    return c.json(await settled(id, await (await core(id)).githubToken(token)));
  });
  app.post('/spaces/:id/github/device', async (c) => {
    const login = await (await core(c.req.param('id'))).githubDeviceStart();
    const body: GitHubDeviceLogin = {
      sessionId: login.session_id,
      userCode: login.user_code,
      verificationUri: login.verification_uri,
      expiresIn: login.expires_in,
    };
    return c.json(body);
  });
  app.post('/spaces/:id/github/device/poll', async (c) => {
    const id = c.req.param('id');
    const { sessionId } = session.parse(await c.req.json());
    const raw = await (await core(id)).githubDevicePoll(sessionId);
    const body: GitHubDevicePoll =
      raw.status === 'pending'
        ? {
            pending: true,
            userCode: 'user_code' in raw ? raw.user_code : '',
            verificationUri:
              'verification_uri' in raw ? raw.verification_uri : '',
          }
        : { pending: false, status: await settled(id, raw) };
    return c.json(body);
  });
  app.post('/spaces/:id/github/device/cancel', async (c) => {
    const { sessionId } = session.parse(await c.req.json());
    await (await core(c.req.param('id'))).githubDeviceCancel(sessionId);
    return c.json({ ok: true });
  });
  app.post('/spaces/:id/github/recheck', async (c) => {
    const id = c.req.param('id');
    return c.json(await settled(id, await (await core(id)).githubRecheck()));
  });
  app.post('/spaces/:id/github/disconnect', async (c) => {
    const client = await core(c.req.param('id'));
    await client.githubDisconnect();
    return c.json(githubStatus(await client.githubStatus()));
  });
  return app;
}
