import { Hono } from 'hono';
import { z } from 'zod';
import type { ComputerService } from './computer-service.js';
import { HearthBackendError } from './hearth-backend.js';
import { HearthCoreError } from './hearth-core.js';
export function computerRoutes(computers: ComputerService) {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json({ error: 'Invalid computer request.' }, 400);
    if (error.message === 'Dot not found.')
      return c.json({ error: error.message }, 404);
    if (
      error instanceof HearthCoreError ||
      error instanceof HearthBackendError
    ) {
      const status =
        error.status === 404 ? 404 : error.status === 400 ? 400 : 502;
      return c.json({ error: error.message }, status);
    }
    return c.json({ error: error.message || 'Computer request failed.' }, 500);
  });
  app.get('/dots/:id/computer', async (c) =>
    c.json(await computers.status(c.req.param('id'))),
  );
  app.patch('/dots/:id/computer/permissions', async (c) =>
    c.json(computers.permissions(c.req.param('id'), await c.req.json())),
  );
  app.post('/dots/:id/computer/container', async (c) =>
    c.json(await computers.spinUp(c.req.param('id')), 201),
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
