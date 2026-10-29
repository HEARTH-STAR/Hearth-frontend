import { randomBytes } from 'node:crypto';
import { STATUS_CODES, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import { originProblem } from './app-origin.js';
import type { HearthConfig } from './config.js';
import type { ComputerService } from './computer-service.js';

// The Computer panel's terminal: a shell inside the Dot's container. The browser opens a
// WebSocket here; this server checks it like any /api request, then pipes it to Hearth-backend's
// terminal (``docker exec`` with a TTY). The browser never reaches Hearth-backend.

const TICKET_MS = 30_000;
const PATH = /^\/api\/dots\/([^/]+)\/computer\/terminal$/;

/**
 * One-use tickets for the terminal's WebSocket. A browser cannot send ``Authorization`` on a
 * WebSocket, so the owner asks for a ticket through the guarded API and opens the socket with it.
 */
export class TerminalTickets {
  private tickets = new Map<string, { dotId: string; expires: number }>();
  issue(dotId: string) {
    const now = Date.now();
    for (const [ticket, entry] of this.tickets)
      if (entry.expires <= now) this.tickets.delete(ticket);
    const ticket = randomBytes(24).toString('hex');
    this.tickets.set(ticket, { dotId, expires: now + TICKET_MS });
    return ticket;
  }
  redeem(ticket: string, dotId: string) {
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    return !!entry && entry.dotId === dotId && entry.expires > Date.now();
  }
}

export function backendTerminalUrl(
  backendUrl: string,
  container: string,
  cols: number,
  rows: number,
) {
  const url = new URL(
    `${backendUrl}/api/containers/${encodeURIComponent(container)}/terminal`,
  );
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('cols', String(cols));
  url.searchParams.set('rows', String(rows));
  return url.toString();
}

/** A close code this side may send on: the reserved ones (1005, 1006, 1015) become 1000. */
function sendable(code: number) {
  return code === 1000 ||
    (code >= 1001 && code <= 1014 && ![1004, 1005, 1006].includes(code)) ||
    (code >= 3000 && code <= 4999)
    ? code
    : 1000;
}

/** Pipe the browser's socket and Hearth-backend's together until either side closes. */
export function bridge(
  browser: WebSocket,
  upstream: WebSocket,
  early: [RawData, boolean][] = [],
) {
  for (const [data, binary] of early) browser.send(data, { binary });
  browser.on('message', (data, binary) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
  });
  upstream.on('message', (data, binary) => {
    if (browser.readyState === WebSocket.OPEN) browser.send(data, { binary });
  });
  const close = (other: WebSocket) => (code: number, reason: Buffer) => {
    if (
      other.readyState === WebSocket.OPEN ||
      other.readyState === WebSocket.CONNECTING
    )
      other.close(sendable(code), reason.toString().slice(0, 120));
  };
  browser.on('close', close(upstream));
  upstream.on('close', close(browser));
  browser.on('error', () => upstream.terminate());
  upstream.on('error', () => browser.terminate());
}

function refuse(socket: Duplex, status: number, message: string) {
  if (socket.destroyed) return;
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
  );
}

const size = (value: string | null, fallback: number, max: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 2 && n <= max ? n : fallback;
};

export interface TerminalOptions {
  computers: ComputerService;
  config: Pick<HearthConfig, 'backendUrl' | 'backendToken'>;
  origin?: string | string[];
}
/** Serve ``/api/dots/:id/computer/terminal`` WebSocket upgrades on ``server``. */
export function attachTerminal(server: Server, options: TerminalOptions) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head) => {
    handle(request, socket, head).catch(() =>
      refuse(socket, 500, 'The terminal could not open.'),
    );
  });
  async function handle(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) {
    const url = new URL(
      request.url ?? '/',
      `http://${request.headers.host ?? 'localhost'}`,
    );
    const match = PATH.exec(url.pathname);
    if (!match) return refuse(socket, 404, 'Not found.');
    const problem = originProblem(
      {
        url: url.toString(),
        origin: request.headers.origin,
        secFetchSite: request.headers['sec-fetch-site'] as string | undefined,
      },
      options.origin,
    );
    if (problem) return refuse(socket, 403, problem);
    const dotId = decodeURIComponent(match[1]);
    if (
      !options.computers.redeemTerminal(
        url.searchParams.get('ticket') ?? '',
        dotId,
      )
    )
      return refuse(
        socket,
        401,
        'This terminal link expired. Open the terminal again.',
      );
    let container: string;
    try {
      container = await options.computers.terminalContainer(dotId);
    } catch (error) {
      return refuse(
        socket,
        409,
        error instanceof Error
          ? error.message
          : 'The container is not running.',
      );
    }
    const upstream = new WebSocket(
      backendTerminalUrl(
        options.config.backendUrl,
        container,
        size(url.searchParams.get('cols'), 80, 1000),
        size(url.searchParams.get('rows'), 24, 500),
      ),
      options.config.backendToken
        ? {
            headers: { Authorization: `Bearer ${options.config.backendToken}` },
          }
        : {},
    );
    // The shell's first prompt can arrive before the browser's side is ready.
    const early: [RawData, boolean][] = [];
    const hold = (data: RawData, binary: boolean) => early.push([data, binary]);
    upstream.on('message', hold);
    const gone = () => upstream.terminate();
    socket.once('close', gone);
    upstream.once('unexpected-response', (_request, response) => {
      socket.off('close', gone);
      refuse(
        socket,
        502,
        `Hearth-backend refused the terminal (HTTP ${response.statusCode}).`,
      );
      upstream.terminate();
    });
    upstream.once('error', () => {
      socket.off('close', gone);
      refuse(socket, 502, 'Hearth-backend is not reachable for the terminal.');
    });
    upstream.once('open', () => {
      socket.off('close', gone);
      sockets.handleUpgrade(request, socket, head, (browser) => {
        upstream.off('message', hold);
        bridge(browser, upstream, early);
      });
    });
  }
  return sockets;
}
