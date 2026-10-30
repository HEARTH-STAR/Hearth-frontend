import { pageRoutes } from './page-routes.js';
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { folderPath } from '../shared/computer-types.js';
import type { HearthEnv } from './auth.js';
import type { AccountStore } from './db/accounts.js';
import { Platform } from './platform.js';
import { spaceFailure } from './space-service.js';
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
/**
 * Dots, their Spaces and conversations, for the signed-in user only. Each Dot is its own Space: the
 * Dot, its Space and its ``dots`` row share one id, and its container is ``hearth-container-<id>``.
 */
export function workspaceRoutes(
  platform: Platform,
  accounts: AccountStore,
  /** The username Clerk holds for a user, for one whose webhook has not arrived yet. */
  username: (userId: string) => Promise<string | null>,
) {
  const app = new Hono<HearthEnv>();
  const { workspace } = platform;
  /** Whether the user owns every one of these Spaces. */
  const ownsAll = async (userId: string, spaceIds: (string | undefined)[]) => {
    const owned = await accounts.ownedDotIds(userId);
    return spaceIds.every((id) => id === undefined || owned.has(id));
  };
  const ownsDot = async (userId: string, dotId: string) => {
    const space = workspace.dot(dotId)?.spaceId;
    return !!space && (await accounts.owns(userId, space));
  };
  /**
   * A new Dot with its own Space: the ``dots`` row is written first, under the user, then the Dot
   * and its Space here, and only then does Hearth-backend spin up its container.
   */
  const createDot = async (
    userId: string,
    input: {
      name: string;
      instructions: string;
      directory?: string;
      spaceIds?: string[];
      agent?: AgentId;
    },
  ) => {
    const { agent, spaceIds = [], ...dot } = input;
    const id = randomUUID();
    await accounts.ensureUser(userId, username);
    await accounts.addDot(id, dot.name, userId);
    try {
      workspace.createSpace(dot.name, '', agent, id);
      const created = workspace.createDot({
        ...dot,
        id,
        spaceId: id,
        spaceIds: [id, ...spaceIds],
      });
      platform.spaces.start(id);
      return created;
    } catch (error) {
      workspace.deleteSpace(id);
      await accounts.removeDot(id);
      throw error;
    }
  };
  /** A user's first visit: like a fresh Hearth, they start with a Scout. Once, even when asked twice. */
  const firstDots = new Map<string, Promise<unknown>>();
  const firstDot = (userId: string) => {
    let pending = firstDots.get(userId);
    if (!pending) {
      pending = createDot(userId, {
        name: 'Scout',
        instructions: DEFAULT_INSTRUCTIONS,
      }).finally(() => firstDots.delete(userId));
      firstDots.set(userId, pending);
    }
    return pending;
  };
  app.route('/', pageRoutes(platform, ownsDot));
  app.get('/workspace', async (c) => {
    const userId = c.get('userId');
    let owned = await accounts.ownedDotIds(userId);
    if (!owned.size) {
      await firstDot(userId);
      owned = await accounts.ownedDotIds(userId);
    }
    const dots = workspace.dots().filter((dot) => owned.has(dot.spaceId));
    const dotIds = new Set(dots.map((dot) => dot.id));
    const [spaces, setup] = await Promise.all([
      platform.spaces.list(owned),
      platform.setup(),
    ]);
    return c.json({
      spaces,
      dots,
      conversations: workspace
        .conversations()
        .filter((conversation) => dotIds.has(conversation.dotId)),
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
    const userId = c.get('userId');
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
    // Another user's Space is reported like one that does not exist.
    if (!(await ownsAll(userId, [spaceId, ...spaceIds])))
      return c.json({ error: 'Space not found.' }, 404);
    if (spaceId)
      return c.json(
        workspace.createDot({
          ...dot,
          instructions,
          spaceId,
          ...(data.data.spaceIds ? { spaceIds } : {}),
        }),
        201,
      );
    // Each Dot is a Space: it gets its own, and that Space's container starts now.
    return c.json(
      await createDot(userId, { ...dot, instructions, spaceIds, agent }),
      201,
    );
  });
  app.put('/dots/:id', async (c) => {
    const data = dotSchema.safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json({ error: 'Invalid specialist settings.' }, 400);
    if (data.data.agent)
      return c.json({ error: 'A Dot’s agent is chosen when it is made.' }, 400);
    const id = c.req.param('id');
    if (!workspace.dot(id)) return c.json({ error: 'Dot not found.' }, 404);
    const { spaceId, spaceIds = [] } = data.data;
    if (!(await ownsAll(c.get('userId'), [spaceId, ...spaceIds])))
      return c.json({ error: 'Space not found.' }, 404);
    const dot = workspace.updateDot(id, data.data);
    // A Dot that is its own Space carries its name into its row.
    if (dot.id === dot.spaceId) await accounts.renameDot(dot.id, dot.name);
    return c.json(dot);
  });
  /** Deletes a Dot: its container through Hearth-backend, what is kept for it here, then its row. */
  app.delete('/dots/:id', async (c) => {
    const dot = workspace.dot(c.req.param('id'));
    if (!dot) return c.json({ error: 'Dot not found.' }, 404);
    await platform.removeSpace(dot.spaceId);
    await accounts.removeDot(dot.spaceId);
    return c.json({ ok: true });
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
    if (!(await ownsDot(c.get('userId'), data.data.dotId)))
      return c.json({ error: 'Dot not found.' }, 404);
    return c.json(
      platform.createConversation(data.data.dotId, data.data.title),
      201,
    );
  });
  app.patch('/conversations/:id', async (c) => {
    const data = z
      .object({ title: z.string().trim().min(1).max(120) })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json({ error: 'Give the conversation a title.' }, 400);
    return c.json(
      platform.renameConversation(c.req.param('id'), data.data.title),
    );
  });
  app.delete('/conversations/:id', (c) => {
    platform.deleteConversation(c.req.param('id'));
    return c.json({ ok: true });
  });
  /** When each turn was asked and answered, for the times shown on messages. */
  app.get('/conversations/:id/times', (c) => {
    const id = c.req.param('id');
    platform.workspace.requireThread(id);
    return c.json(platform.workspace.turnTimes(id));
  });
  /** Chat: the Dot named in the runtime path must be the user's. */
  app.all('/copilotkit/*', async (c) => {
    const owned = await accounts.ownedDotIds(c.get('userId'));
    const agent = /\/api\/copilotkit\/agent\/([^/]+)\//.exec(c.req.path)?.[1];
    if (agent !== undefined) {
      let dotId = '';
      try {
        dotId = decodeURIComponent(agent);
      } catch {
        // An undecodable id names no Dot.
      }
      if (!owned.has(workspace.dot(dotId)?.spaceId ?? ''))
        return c.json({ error: 'Dot not found.' }, 404);
    }
    return platform.handle(c.req.raw, owned);
  });
  app.onError((error, c) => {
    const text = error.message;
    if (text.startsWith('Space access must include'))
      return c.json({ error: text }, 400);
    // A conversation or Dot the caller named that does not exist is a missing resource, not a
    // server fault.
    if (/^(Dot not found|Conversation does not belong)/.test(text))
      return c.json({ error: text }, 404);
    // A conversation that cannot be deleted right now (running, or a page's own).
    if (
      /^(This conversation is still running|A page’s conversation)/.test(text)
    )
      return c.json({ error: text }, 409);
    // Deleting a Dot needs Hearth-backend (and Docker) to remove its container.
    const failure = spaceFailure(error);
    if (failure) return c.json(failure.body, failure.status);
    console.error('Workspace request failed:', error);
    return c.json(
      { error: 'The request failed. Check the server log and try again.' },
      500,
    );
  });
  return app;
}
