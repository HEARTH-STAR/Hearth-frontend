import { pageRoutes } from './page-routes.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { folderPath } from '../shared/computer-types.js';
import { Platform } from './platform.js';
import { DEFAULT_INSTRUCTIONS } from './workspace.js';
import { AGENT_IDS, type AgentId } from '../shared/agents.js';
const dotSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    /** A new Dot without them gets DEFAULT_INSTRUCTIONS; an edit without them keeps its own. */
    instructions: z.string().trim().min(3).max(2000).optional(),
    directory: folderPath.optional(),
    spaceIds: z.array(z.string().min(1)).min(1).max(100).optional(),
    /** The Dot's home Space. A new Dot without one gets its own; an edit without one keeps it. */
    spaceId: z.string().min(1).optional(),
    /** The agent of a new Dot's own Space (default Claude Code). Fixed once its container exists. */
    agent: z.enum(AGENT_IDS as [AgentId, ...AgentId[]]).optional(),
  })
  .strict();
export function workspaceRoutes(platform: Platform) {
  const app = new Hono();
  app.route('/', pageRoutes(platform));
  app.get('/workspace', async (c) => {
    const [spaces, setup] = await Promise.all([
      platform.spaces.list(),
      platform.setup(),
    ]);
    return c.json({
      spaces,
      dots: platform.workspace.dots(),
      conversations: platform.workspace.conversations(),
      setup,
    });
  });
  app.post('/dots', async (c) => {
    const data = dotSchema.safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json(
        { error: 'Give the Dot a name (up to 40 characters).' },
        400,
      );
    const {
      spaceId,
      spaceIds = [],
      instructions = DEFAULT_INSTRUCTIONS,
      agent,
      ...dot
    } = data.data;
    if (spaceId && agent)
      return c.json(
        {
          error: 'A Dot that joins an existing Space runs that Space’s agent.',
        },
        400,
      );
    if (spaceId)
      return c.json(
        platform.workspace.createDot({
          ...dot,
          instructions,
          spaceId,
          ...(data.data.spaceIds ? { spaceIds } : {}),
        }),
        201,
      );
    // Each Dot is a Space: it gets its own, and that Space's container starts now.
    if (spaceIds.some((id) => !platform.workspace.space(id)))
      return c.json(
        { error: 'Space access must include a valid default destination.' },
        400,
      );
    const home = platform.spaces.create(dot.name, '', agent).id;
    return c.json(
      platform.workspace.createDot({
        ...dot,
        instructions,
        spaceId: home,
        spaceIds: [home, ...spaceIds],
      }),
      201,
    );
  });
  app.put('/dots/:id', async (c) => {
    const data = dotSchema.safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json({ error: 'Invalid specialist settings.' }, 400);
    if (data.data.agent)
      return c.json({ error: 'A Dot’s agent is chosen when it is made.' }, 400);
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
