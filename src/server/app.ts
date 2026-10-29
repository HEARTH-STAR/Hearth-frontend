import { originProblem } from './app-origin.js';
import type { Auth, HearthEnv } from './auth.js';
import { clerkWebhook } from './clerk-webhook.js';
import { computerRoutes } from './computer-routes.js';
import type { AccountStore } from './db/accounts.js';
import { githubRoutes } from './github-routes.js';
import { ownershipGuard } from './ownership.js';
import { spaceRoutes } from './space-routes.js';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { Store } from './store.js';
import type { Platform } from './platform.js';
import { workspaceRoutes } from './workspace-routes.js';
export interface AppOptions {
  store: Store;
  platform: Platform;
  accounts: AccountStore;
  auth: Auth;
  clerk: { publishableKey: string; webhookSecret: string };
  origin?: string | string[];
}
/** The only /api routes that answer without a session: Clerk's webhook and what the sign-in page needs. */
const PUBLIC = new Set(['/api/webhooks/clerk', '/api/auth/config']);
export function createApp({
  store,
  platform,
  accounts,
  auth,
  clerk,
  origin,
}: AppOptions) {
  const app = new Hono<HearthEnv>();
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
    );
    if (refused) return c.json({ error: refused }, 403);
    if (
      !['GET', 'HEAD'].includes(c.req.method) &&
      !c.req.header('content-type')?.includes('application/json')
    )
      return c.json({ error: 'Use application/json.' }, 415);
    if (PUBLIC.has(c.req.path)) return next();
    const userId = await auth.authenticate(c.req.raw);
    if (!userId) return c.json({ error: 'Sign in to use Hearth.' }, 401);
    c.set('userId', userId);
    await next();
  });
  app.use('/api/*', ownershipGuard(platform.workspace, accounts));
  app.get('/api/auth/config', (c) =>
    c.json({ publishableKey: clerk.publishableKey }),
  );
  app.route(
    '/api',
    clerkWebhook({
      secret: clerk.webhookSecret,
      accounts,
      username: (userId) => auth.username(userId),
      removeDots: async (userId) => {
        for (const dot of await accounts.dots(userId))
          await platform.removeSpace(dot.dotId);
      },
    }),
  );
  app.route('/api', computerRoutes(platform.computers));
  app.route('/api', spaceRoutes(platform.spaces));
  app.route('/api', githubRoutes(platform.spaces));
  app.route(
    '/api',
    workspaceRoutes(platform, accounts, (userId) => auth.username(userId)),
  );
  app.get('/api/state', (c) =>
    c.json({ settings: store.settings(c.get('userId')) }),
  );
  app.patch('/api/settings', async (c) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(40).optional(),
        paused: z.boolean().optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid settings.' }, 400);
    return c.json(store.updateSettings(parsed.data, c.get('userId')));
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
