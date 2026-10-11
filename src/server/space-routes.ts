import { Hono } from 'hono';
import { z } from 'zod';
import type { ClaudeLogin, ClaudeLoginState } from '../shared/types.js';
import { claudeStatus } from './connections.js';
import { spaceFailure, type SpaceService } from './space-service.js';

const session = z
  .object({ sessionId: z.string().regex(/^[0-9a-f]{8,64}$/) })
  .strict();
const code = z
  .object({
    sessionId: z.string().regex(/^[0-9a-f]{8,64}$/),
    code: z.string().trim().min(1).max(4096),
  })
  .strict();
/**
 * Spaces and their setup: creating one spins up its container; the container's Hearth-Core then
 * signs Claude Code in (``claude auth login``, through its claude_code adapter). The pasted code
 * passes through once and is never stored or echoed here.
 */
export function spaceRoutes(spaces: SpaceService) {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json({ error: 'Invalid Space request.' }, 400);
    const failure = spaceFailure(error);
    if (failure) return c.json(failure.body, failure.status);
    console.error('Space request failed:', error);
    return c.json({ error: 'The Space request failed.' }, 500);
  });
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
    return c.json(spaces.create(data.data.name, data.data.description), 201);
  });
  app.get('/spaces/:id/setup', async (c) =>
    c.json(await spaces.setup(c.req.param('id'))),
  );
  /** Spin up the container, start it again, or replace a lost one. Answers before it is ready. */
  app.post('/spaces/:id/container', async (c) => {
    const id = c.req.param('id');
    spaces.start(id);
    return c.json(await spaces.setup(id), 202);
  });
  app.get('/spaces/:id/claude', async (c) =>
    c.json(
      claudeStatus(await (await spaces.core(c.req.param('id'))).claudeStatus()),
    ),
  );
  app.post('/spaces/:id/claude/login', async (c) => {
    const login = await (
      await spaces.core(c.req.param('id'))
    ).claudeLoginStart();
    const body: ClaudeLogin = {
      sessionId: login.session_id,
      authUrl: login.auth_url,
      expiresIn: login.expires_in,
    };
    return c.json(body);
  });
  const outcome = async (
    id: string,
    raw: { status: ClaudeLoginState['status']; error?: string },
  ): Promise<ClaudeLoginState> => {
    if (raw.status !== 'connected')
      return { status: raw.status, ...(raw.error ? { error: raw.error } : {}) };
    spaces.claudeChanged(id);
    return {
      status: 'connected',
      claude: (await spaces.claudeStatus(id, true)) ?? undefined,
    };
  };
  app.post('/spaces/:id/claude/login/code', async (c) => {
    const id = c.req.param('id');
    const body = code.parse(await c.req.json());
    const core = await spaces.core(id);
    return c.json(
      await outcome(id, await core.claudeLoginCode(body.sessionId, body.code)),
    );
  });
  app.post('/spaces/:id/claude/login/poll', async (c) => {
    const id = c.req.param('id');
    const { sessionId } = session.parse(await c.req.json());
    const core = await spaces.core(id);
    return c.json(await outcome(id, await core.claudeLoginPoll(sessionId)));
  });
  app.post('/spaces/:id/claude/login/cancel', async (c) => {
    const { sessionId } = session.parse(await c.req.json());
    await (await spaces.core(c.req.param('id'))).claudeLoginCancel(sessionId);
    return c.json({ ok: true });
  });
  app.post('/spaces/:id/claude/logout', async (c) => {
    const id = c.req.param('id');
    const raw = await (await spaces.core(id)).claudeLogout();
    spaces.claudeChanged(id);
    return c.json(claudeStatus(raw));
  });
  return app;
}
