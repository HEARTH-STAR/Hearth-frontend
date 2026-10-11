import { Hono } from 'hono';
import { z } from 'zod';
import type { ComputerService } from './computer-service.js';
import { spaceFailure } from './space-service.js';
export function computerRoutes(computers: ComputerService) {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json({ error: 'Invalid computer request.' }, 400);
    if (error.message === 'Dot not found.')
      return c.json({ error: error.message }, 404);
    const failure = spaceFailure(error);
    if (failure) return c.json(failure.body, failure.status);
    return c.json({ error: error.message || 'Computer request failed.' }, 500);
  });
  app.get('/dots/:id/computer', async (c) =>
    c.json(await computers.status(c.req.param('id'))),
  );
  app.patch('/dots/:id/computer/permissions', async (c) =>
    c.json(computers.permissions(c.req.param('id'), await c.req.json())),
  );
  app.get('/dots/:id/computer/files', async (c) =>
    c.json(await computers.files(c.req.param('id'), c.req.raw.signal)),
  );
  app.get('/dots/:id/computer/file', async (c) =>
    c.json(
      await computers.file(
        c.req.param('id'),
        c.req.query('path'),
        c.req.raw.signal,
      ),
    ),
  );
  return app;
}
