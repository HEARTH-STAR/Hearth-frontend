import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { Dot } from '../shared/types';
import { api } from './api';

type Connection =
  | { state: 'connecting' }
  | { state: 'open' }
  | { state: 'closed'; reason: string };

/** What the server says when a terminal ends, in words for the owner. */
export function closeReason(code: number, reason: string) {
  if (reason) return reason;
  if (code === 1000) return 'The shell exited.';
  return 'The terminal disconnected.';
}

/**
 * A shell inside the Dot's container (xterm.js over a WebSocket to this server, which pipes it to
 * Hearth-backend's ``docker exec``). It stays connected while the panel is open, also when another
 * tab is showing.
 */
export function TerminalView({ dot, visible }: { dot: Dot; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const refit = useRef<() => void>(() => {});
  const [connection, setConnection] = useState<Connection>({
    state: 'connecting',
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily:
        "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace",
      fontSize: 12.5,
      scrollback: 5000,
      theme: {
        background: '#1f2126',
        foreground: '#d9dbe0',
        cursor: '#7fd1b9',
        selectionBackground: '#3a4250',
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    let socket: WebSocket | undefined;
    let stopped = false;
    const resize = () => {
      // A hidden tab has no size to fit to.
      if (!element.clientWidth || !element.clientHeight) return;
      fit.fit();
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(
          JSON.stringify({
            type: 'resize',
            cols: terminal.cols,
            rows: terminal.rows,
          }),
        );
    };
    refit.current = resize;
    // Fit on the next frame: fitting inside the observer's callback would resize what it observes.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    });
    observer.observe(element);
    const input = terminal.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'input', data }));
    });
    setConnection({ state: 'connecting' });
    void (async () => {
      resize();
      const path = `/dots/${encodeURIComponent(dot.id)}/computer/terminal`;
      let ticket: string;
      try {
        ({ ticket } = await api<{ ticket: string }>(path, 'POST', {}));
      } catch (cause) {
        if (!stopped)
          setConnection({
            state: 'closed',
            reason:
              cause instanceof Error
                ? cause.message
                : 'The terminal could not open.',
          });
        return;
      }
      if (stopped) return;
      const url = new URL(`/api${path}`, location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.search = new URLSearchParams({
        ticket,
        cols: String(terminal.cols),
        rows: String(terminal.rows),
      }).toString();
      socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => {
        if (stopped) return;
        setConnection({ state: 'open' });
        resize();
        terminal.focus();
      };
      socket.onmessage = (event) =>
        terminal.write(
          typeof event.data === 'string'
            ? event.data
            : new Uint8Array(event.data as ArrayBuffer),
        );
      socket.onclose = (event) => {
        if (!stopped)
          setConnection({
            state: 'closed',
            reason: closeReason(event.code, event.reason),
          });
      };
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      input.dispose();
      socket?.close();
      terminal.dispose();
    };
  }, [dot.id, attempt]);
  // Coming back to the tab: fit to the size it has now.
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => refit.current());
    return () => cancelAnimationFrame(frame);
  }, [visible]);
  return (
    <section className="computer-shell" aria-label="Terminal" hidden={!visible}>
      <div className="computer-shell-screen" ref={host} />
      {connection.state !== 'open' && (
        <div className="computer-shell-status" role="status">
          {connection.state === 'connecting' ? (
            <span>Connecting to {dot.name}’s container…</span>
          ) : (
            <>
              <span>{connection.reason}</span>
              <button onClick={() => setAttempt((n) => n + 1)}>
                <RotateCcw size={13} /> Reconnect
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
