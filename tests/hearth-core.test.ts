import { expect, it } from 'vitest';
import {
  HearthBackend,
  HearthBackendError,
} from '../src/server/hearth-backend.js';
import {
  HearthCore,
  HearthCoreError,
  readSse,
} from '../src/server/hearth-core.js';
import { configFromEnv } from '../src/server/config.js';
import { fakeFetch } from './helpers.js';
function chunked(parts: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}
it('reads SSE events split across chunks, with CRLF and multi-line data', async () => {
  const events: unknown[] = [];
  for await (const event of readSse(
    chunked([
      'data: {"type":"tok',
      'en","token":"a"}\n\n: comment\r\n\r\ndata: {"type":',
      '\ndata: "error","error":"x"}\n\ndata: {"done":true}',
    ]),
  ))
    events.push(event);
  expect(events).toEqual([
    { type: 'token', token: 'a' },
    { type: 'error', error: 'x' },
    { done: true },
  ]);
});
it('turns Hearth-Core failures into readable errors', async () => {
  const offline = new HearthCore('http://core.test', (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch);
  await expect(offline.health()).rejects.toThrow(
    'Hearth-Core is not reachable at http://core.test.',
  );
  const { fetch, calls } = fakeFetch({
    'GET /api/workspace/file': () =>
      Response.json({ detail: 'File not found.' }, { status: 404 }),
    'POST /api/chat': () =>
      Response.json(
        { detail: 'This conversation is already running a turn.' },
        { status: 409 },
      ),
  });
  const core = new HearthCore('http://core.test', fetch);
  const missing = await core.file('dots/scout/a.md').catch((error) => error);
  expect(missing).toBeInstanceOf(HearthCoreError);
  expect(missing).toMatchObject({ status: 404, message: 'File not found.' });
  const busy = core.chat(
    {
      session: 's',
      message: 'hi',
      permissions: { files: false, shell: false },
    },
    new AbortController().signal,
  );
  await expect(busy.next()).rejects.toMatchObject({ status: 409 });
  expect(calls.map((call) => call.path)).toEqual([
    '/api/workspace/file',
    '/api/chat',
  ]);
});
it('sends the backend token and keeps the backend detail', async () => {
  let authorization: string | null = null;
  const backend = new HearthBackend('http://backend.test', 'secret', (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    authorization = new Request(input, init).headers.get('authorization');
    return Response.json(
      { detail: 'container name hearth-container-x is taken' },
      { status: 409 },
    );
  }) as typeof fetch);
  const error = await backend.spinUp('x').catch((cause) => cause);
  expect(error).toBeInstanceOf(HearthBackendError);
  expect(error).toMatchObject({
    status: 409,
    message: 'container name hearth-container-x is taken',
  });
  expect(authorization).toBe('Bearer secret');
});
it('reads its service addresses from the environment', () => {
  expect(configFromEnv({})).toMatchObject({
    backendUrl: 'http://127.0.0.1:5020',
    containerTemplate: 'space',
    spaceHost: '127.0.0.1',
  });
  expect(
    configFromEnv({
      HEARTH_BACKEND_URL: 'http://host:5020//',
      HEARTH_BACKEND_TOKEN: ' ',
      HEARTH_CONTAINER_TEMPLATE: 'my-space',
      HEARTH_SPACE_HOST: ' host.docker.internal ',
    }),
  ).toMatchObject({
    backendUrl: 'http://host:5020',
    backendToken: undefined,
    containerTemplate: 'my-space',
    spaceHost: 'host.docker.internal',
  });
});
