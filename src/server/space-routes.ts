import { Hono } from 'hono';
import { z } from 'zod';
import type { AgentLogin, AgentLoginState } from '../shared/types.js';
import { agentStatus } from './connections.js';
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
 * Spaces and their setup. A Space is made with its Dot (``POST /api/dots``, which records who owns
 * it) and spins up its container; the container's Hearth-Core then signs the Space's agent in
 * (Claude Code, Cursor or Antigravity, through that agent's adapter).
 * A pasted code passes through once and is never stored or echoed here.
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
  app.get('/spaces/:id/setup', async (c) =>
    c.json(await spaces.setup(c.req.param('id'))),
  );
  /** Spin up the container, start it again, or replace a lost one. Answers before it is ready. */
  app.post('/spaces/:id/container', async (c) => {
    const id = c.req.param('id');
    spaces.start(id);
    return c.json(await spaces.setup(id), 202);
  });
  /** The Space's Hearth-Core and the agent it runs. */
  const agentCore = async (id: string) => ({
    agent: spaces.space(id).agent,
    core: await spaces.core(id),
  });
  app.get('/spaces/:id/agent', async (c) => {
    const { agent, core } = await agentCore(c.req.param('id'));
    return c.json(agentStatus(await core.agentStatus(agent)));
  });
  app.post('/spaces/:id/agent/login', async (c) => {
    const id = c.req.param('id');
    const { agent, core } = await agentCore(id);
    const login = await core.agentLoginStart(agent);
    if (!login.auth_url || !login.session_id) {
      // Already signed in: Cursor and Antigravity say so instead of starting a sign-in.
      spaces.agentChanged(id);
      const body: AgentLogin = {
        sessionId: '',
        authUrl: '',
        expiresIn: 0,
        connected: true,
      };
      return c.json(body);
    }
    const body: AgentLogin = {
      sessionId: login.session_id,
      authUrl: login.auth_url,
      expiresIn: login.expires_in,
    };
    return c.json(body);
  });
  const outcome = async (
    id: string,
    raw: { status: AgentLoginState['status']; error?: string },
  ): Promise<AgentLoginState> => {
    if (raw.status !== 'connected')
      return { status: raw.status, ...(raw.error ? { error: raw.error } : {}) };
    spaces.agentChanged(id);
    return {
      status: 'connected',
      agent: (await spaces.agentStatus(id, true)) ?? undefined,
    };
  };
  app.post('/spaces/:id/agent/login/code', async (c) => {
    const id = c.req.param('id');
    const body = code.parse(await c.req.json());
    const { agent, core } = await agentCore(id);
    return c.json(
      await outcome(
        id,
        await core.agentLoginCode(agent, body.sessionId, body.code),
      ),
    );
  });
  app.post('/spaces/:id/agent/login/poll', async (c) => {
    const id = c.req.param('id');
    const { sessionId } = session.parse(await c.req.json());
    const { agent, core } = await agentCore(id);
    return c.json(
      await outcome(id, await core.agentLoginPoll(agent, sessionId)),
    );
  });
  app.post('/spaces/:id/agent/login/cancel', async (c) => {
    const { sessionId } = session.parse(await c.req.json());
    const { agent, core } = await agentCore(c.req.param('id'));
    await core.agentLoginCancel(agent, sessionId);
    return c.json({ ok: true });
  });
  app.post('/spaces/:id/agent/logout', async (c) => {
    const id = c.req.param('id');
    const { agent, core } = await agentCore(id);
    const raw = await core.agentLogout(agent);
    spaces.agentChanged(id);
    return c.json(agentStatus(raw));
  });
  return app;
}
