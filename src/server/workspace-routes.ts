import { pageRoutes } from './page-routes.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { folderPath } from '../shared/computer-types.js';
import { Platform } from './platform.js';
const dotSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    role: z.string().trim().max(40).default(''),
    instructions: z.string().trim().min(3).max(2000),
    memoryAllowed: z.boolean(),
    directory: folderPath.optional(),
    spaceIds: z.array(z.string().min(1)).min(1).max(100).optional(),
    spaceId: z.string().min(1),
  })
  .strict();
export function workspaceRoutes(platform: Platform) {
  const app = new Hono();
  app.route('/', pageRoutes(platform));
  app.get('/workspace', async (c) =>
    c.json({
      spaces: platform.workspace.spaces(),
      dots: platform.workspace.dots(),
      conversations: platform.workspace.conversations(),
      setup: await platform.setup(),
    }),
  );
  app.post('/spaces', async (c) => {
    const data = z
      .object({
        name: z.string().trim().min(1).max(60),
        description: z.string().max(500).default(''),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json(
        { error: 'Enter a Space name (up to 60 characters).' },
        400,
      );
    return c.json(
      platform.workspace.createSpace(data.data.name, data.data.description),
      201,
    );
  });
  app.post('/dots', async (c) => {
    const data = dotSchema.safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json(
        { error: 'Provide a name, role instructions, and Space access.' },
        400,
      );
    return c.json(platform.workspace.createDot(data.data), 201);
  });
  app.put('/dots/:id', async (c) => {
    const data = dotSchema.safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json({ error: 'Invalid specialist settings.' }, 400);
    if (!platform.workspace.dot(c.req.param('id')))
      return c.json({ error: 'Dot not found.' }, 404);
    return c.json(platform.workspace.updateDot(c.req.param('id'), data.data));
  });
  app.post('/conversations', async (c) => {
    const data = z
      .object({
        dotId: z.string(),
        title: z.string().trim().min(1).max(120).default('A new thought'),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json({ error: 'Select a Dot and a conversation title.' }, 400);
    return c.json(
      platform.createConversation(data.data.dotId, data.data.title),
      201,
    );
  });
  app.all('/copilotkit/*', (c) => platform.handle(c.req.raw));
  app.onError((error, c) => {
    const text = error.message;
    if (text.startsWith('Space access must include'))
      return c.json({ error: text }, 400);
    // A conversation or Dot the caller named that does not exist is a missing resource, not a
    // server fault.
    if (/^(Dot not found|Conversation does not belong)/.test(text))
      return c.json({ error: text }, 404);
    console.error('Workspace request failed:', error);
    return c.json(
      { error: 'The request failed. Check the server log and try again.' },
      500,
    );
  });
  return app;
}
