import { originProblem } from './app-origin.js';
import { computerRoutes } from './computer-routes.js';
import { githubRoutes } from './github-routes.js';
import { spaceRoutes } from './space-routes.js';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Store } from './store.js';
import type { Platform } from './platform.js';
import { workspaceRoutes } from './workspace-routes.js';
export interface AppOptions {
  store: Store;
  platform: Platform;
  ownerToken?: string;
  origin?: string | string[];
}
export function createApp({ store, platform, ownerToken, origin }: AppOptions) {
  const app = new Hono();
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: 1_000_000,
      onError: (c) => c.json({ error: 'Request is too large.' }, 413),
    }),
  );
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    const refused = originProblem(
      {
        url: c.req.url,
        origin: c.req.header('origin'),
        secFetchSite: c.req.header('sec-fetch-site'),
      },
      origin,
      ownerToken,
    );
    if (refused) return c.json({ error: refused }, 403);
    if (ownerToken) {
      const expected = Buffer.from(ownerToken);
      const supplied = Buffer.from(
        c.req.header('authorization')?.replace(/^Bearer /, '') ?? '',
      );
      if (
        expected.length !== supplied.length ||
        !timingSafeEqual(expected, supplied)
      )
        return c.json(
          { error: 'Enter your owner access token to unlock Hearth.' },
          401,
        );
    }
    if (
      !['GET', 'HEAD'].includes(c.req.method) &&
      !c.req.header('content-type')?.includes('application/json')
    )
      return c.json({ error: 'Use application/json.' }, 415);
    await next();
  });
  app.route('/api', computerRoutes(platform.computers));
  app.route('/api', spaceRoutes(platform.spaces));
  app.route('/api', githubRoutes(platform.spaces));
  app.route('/api', workspaceRoutes(platform));
  app.get('/api/state', (c) => c.json({ settings: store.settings() }));
  app.patch('/api/settings', async (c) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(40).optional(),
        paused: z.boolean().optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid settings.' }, 400);
    return c.json(store.updateSettings(parsed.data));
  });
  app.onError((error, c) => {
    console.error('API request failed:', error.name);
    return c.json(
      {
        error:
          'The server could not complete this request. Check server logs and database access.',
      },
      500,
    );
  });
  return app;
}
