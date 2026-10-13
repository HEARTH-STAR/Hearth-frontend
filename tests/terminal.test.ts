import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import {
  attachTerminal,
  backendTerminalUrl,
  TerminalTickets,
} from '../src/server/terminal.js';
import { fixture as base, json, SPACE_CONTAINER } from './helpers.js';

const open: { close(): void }[] = [];
afterEach(() => {
  open.splice(0).forEach((item) => item.close());
  vi.useRealTimers();
});
function fixture(options: Parameters<typeof base>[0] = {}) {
  const value = base(options);
  open.push(value);
  return value;
}
const listen = (server: Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve((server.address() as AddressInfo).port),
    ),
  );

it('issues one-use tickets for one Dot that expire', () => {
  vi.useFakeTimers();
  const tickets = new TerminalTickets();
  const ticket = tickets.issue('dot-1');
  expect(ticket).toMatch(/^[0-9a-f]{48}$/);
  expect(tickets.redeem(ticket, 'dot-2')).toBe(false);
  expect(tickets.redeem(ticket, 'dot-1')).toBe(false); // spent by the wrong Dot's try
  const next = tickets.issue('dot-1');
  expect(tickets.redeem(next, 'dot-1')).toBe(true);
  expect(tickets.redeem(next, 'dot-1')).toBe(false);
  const late = tickets.issue('dot-1');
  vi.advanceTimersByTime(31_000);
  expect(tickets.redeem(late, 'dot-1')).toBe(false);
});

it('builds Hearth-backend’s terminal URL', () => {
  expect(
    backendTerminalUrl(
      'http://127.0.0.1:5020',
      'hearth-container-a b',
      100,
      30,
    ),
  ).toBe(
    'ws://127.0.0.1:5020/api/containers/hearth-container-a%20b/terminal?cols=100&rows=30',
  );
  expect(backendTerminalUrl('https://host', 'x', 80, 24)).toMatch(/^wss:/);
});

it('hands out a ticket only while the Dot’s container runs', async () => {
  const running = fixture();
  const dot = running.workspace.dots()[0];
  const response = await running.app.request(
    `/api/dots/${dot.id}/computer/terminal`,
    json({}),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).ticket).toMatch(/^[0-9a-f]{48}$/);
  const none = fixture({ container: false });
  const refused = await none.app.request(
    `/api/dots/${none.workspace.dots()[0].id}/computer/terminal`,
    json({}),
  );
  expect(refused.status).toBe(409);
  expect((await refused.json()).error).toMatch(/has no container yet/);
});

it('pipes the browser’s socket to the container’s shell, after checking it like /api', async () => {
  // A stand-in for Hearth-backend's terminal: greets, then echoes input.
  const backend = createServer();
  const shells = new WebSocketServer({ server: backend });
  const seen: { url: string; auth?: string }[] = [];
  shells.on('connection', (socket, request) => {
    seen.push({
      url: request.url ?? '',
      auth: request.headers.authorization,
    });
    socket.send(Buffer.from('root@scout:/workspace# '));
    socket.on('message', (data) => {
      const message = JSON.parse(String(data)) as { data?: string };
      if (message.data) socket.send(Buffer.from(`you typed ${message.data}`));
    });
  });
  const backendPort = await listen(backend);
  const value = fixture();
  const app = createServer();
  attachTerminal(app, {
    computers: value.platform.computers,
    config: {
      backendUrl: `http://127.0.0.1:${backendPort}`,
      backendToken: 'backend-secret',
    },
    origin: undefined,
  });
  const port = await listen(app);
  open.push({ close: () => app.close() }, { close: () => backend.close() });
  const dot = value.workspace.dots()[0];
  const ticket = async () =>
    (
      await (
        await value.app.request(
          `/api/dots/${dot.id}/computer/terminal`,
          json({}),
        )
      ).json()
    ).ticket as string;
  const url = (query: string) =>
    `ws://localhost:${port}/api/dots/${dot.id}/computer/terminal?${query}`;
  const refusal = (address: string, origin: string) =>
    new Promise<number>((resolve) => {
      const socket = new WebSocket(address, { headers: { Origin: origin } });
      socket.on('unexpected-response', (_request, response) =>
        resolve(response.statusCode ?? 0),
      );
      socket.on('error', () => {});
    });

  expect(await refusal(url('ticket=nope'), `http://localhost:${port}`)).toBe(
    401,
  );
  expect(
    await refusal(url(`ticket=${await ticket()}`), 'https://evil.example'),
  ).toBe(403);
  expect(
    await refusal(
      `ws://localhost:${port}/api/elsewhere`,
      `http://localhost:${port}`,
    ),
  ).toBe(404);

  const browser = new WebSocket(
    url(`ticket=${await ticket()}&cols=120&rows=40`),
    { headers: { Origin: `http://localhost:${port}` } },
  );
  const received: string[] = [];
  const next = () =>
    new Promise<string>((resolve) =>
      browser.once('message', (data) => resolve(String(data))),
    );
  const greeting = next();
  await new Promise((resolve) => browser.once('open', resolve));
  received.push(await greeting);
  const echo = next();
  browser.send(JSON.stringify({ type: 'input', data: 'ls\r' }));
  received.push(await echo);
  expect(received).toEqual(['root@scout:/workspace# ', 'you typed ls\r']);
  expect(seen).toEqual([
    {
      url: `/api/containers/${SPACE_CONTAINER}/terminal?cols=120&rows=40`,
      auth: 'Bearer backend-secret',
    },
  ]);
  const closed = new Promise<number>((resolve) =>
    browser.once('close', (code) => resolve(code)),
  );
  for (const shell of shells.clients) shell.close(4409, 'stopped');
  expect(await closed).toBe(4409);
});
