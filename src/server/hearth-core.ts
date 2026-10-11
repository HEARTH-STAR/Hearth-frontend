import type {
  WorkspaceFile,
  WorkspaceListing,
} from '../shared/computer-types.js';
// Hearth-Core's HTTP API, as the Hearth web app uses it. Each Space's container runs one Hearth-Core;
// only this server talks to it, the browser never does.

/** A tool this app runs itself, offered to Claude Code for one turn (Hearth-Core ``ChatTool``). */
export interface ChatTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** The owner answers later; the agent is told to end its turn and wait. */
  handoff?: boolean;
}
export interface ChatSpec {
  session: string;
  message: string;
  system?: string;
  directory?: string;
  model?: string;
  permissions: { files: boolean; shell: boolean };
  tools?: ChatTool[];
  limits?: {
    max_turns?: number;
    wall_clock_seconds?: number;
    tool_result_timeout_seconds?: number;
  };
}
/** Hearth-Core ``engine/stream_events.py``: the events of one chat turn. */
export type CoreEvent =
  | { type: 'token'; token: string; partial?: boolean }
  | { type: 'model-loading'; label: string; partial?: boolean }
  | { type: 'session_id'; session_id: string }
  | { type: 'result'; [key: string]: unknown }
  | { type: 'error'; error: string }
  | {
      type: 'tool-call';
      tool: string;
      tool_use_id: string | null;
      input: Record<string, unknown>;
    }
  | {
      type: 'tool-result';
      tool: string | null;
      tool_use_id: string | null;
      output: string;
    }
  | {
      type: 'policy-denied';
      tool: string;
      tool_use_id: string | null;
      input: Record<string, unknown>;
      reason: string;
    }
  | { type: 'validation'; [key: string]: unknown }
  | {
      type?: undefined;
      done: true;
      native_session_id: string | null;
      result: Record<string, unknown>;
    };
export class HearthCoreError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** The JSON error body, for categorical fields such as ``code``. */
    readonly body?: Record<string, unknown>,
  ) {
    super(message);
  }
}
/** Hearth-Core's GitHub connector (``routers/hearth_agent/connectors``), as returned. */
export interface GitHubConnection {
  status: 'connected' | 'needs_auth' | string;
  username?: string;
  name?: string;
  auth_method?: 'pat' | 'cli' | string | null;
  expires_at?: string | null;
  warning?: string;
  warnings?: string[];
  gh_status?: string;
}
export interface GitHubDeviceLogin {
  session_id: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
}
/** The claude_code adapter's sign-in routes (``/api/connectors/claude-code``), as returned. */
export interface ClaudeConnection {
  status: 'connected' | 'needs_auth' | 'unavailable' | string;
  method?: string | null;
  email?: string | null;
  organization?: string | null;
  subscription?: string | null;
  login_supported?: boolean;
  error?: string;
}
export interface ClaudeLoginStart {
  session_id: string;
  auth_url: string;
  expires_in: number;
}
export interface ClaudeLoginOutcome {
  status: 'pending' | 'connected' | 'invalid_code' | 'failed' | 'cancelled';
  session_id: string;
  error?: string;
}
type Fetch = typeof fetch;
/** Reads a ``text/event-stream`` body: one parsed JSON value per ``data:`` event. */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';
  const parse = function* (block: string) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (data) yield JSON.parse(data) as unknown;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        yield* parse(block);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield* parse(buffer);
  } finally {
    reader.releaseLock();
  }
}
/** The error a non-2xx answer carries: FastAPI's ``detail``, or a connector's ``error``. */
async function failure(response: Response) {
  const body = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const message =
    typeof body?.detail === 'string'
      ? body.detail
      : typeof body?.error === 'string'
        ? body.error
        : `Hearth-Core returned HTTP ${response.status}.`;
  return new HearthCoreError(message, response.status, body ?? undefined);
}
export class HearthCore {
  constructor(
    readonly url: string,
    private fetchImpl: Fetch = fetch,
  ) {}
  private async request(
    path: string,
    init: RequestInit & { signal?: AbortSignal } = {},
  ) {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.url}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new HearthCoreError(`Hearth-Core is not reachable at ${this.url}.`);
    }
    if (!response.ok) throw await failure(response);
    return response;
  }
  async health(signal?: AbortSignal): Promise<{ ok: boolean; agent?: string }> {
    return (await this.request('/health', { signal })).json();
  }
  /** One chat turn. Aborting ``signal`` closes the stream, which stops the turn in Hearth-Core. */
  async *chat(spec: ChatSpec, signal: AbortSignal): AsyncGenerator<CoreEvent> {
    const response = await this.request('/api/chat', {
      method: 'POST',
      body: JSON.stringify(spec),
      signal,
    });
    if (!response.body)
      throw new HearthCoreError('Hearth-Core returned an empty chat stream.');
    for await (const event of readSse(response.body)) yield event as CoreEvent;
  }
  async toolResult(
    session: string,
    toolUseId: string,
    output: string,
    isError: boolean,
    signal?: AbortSignal,
  ) {
    await this.request(
      `/api/chat/${encodeURIComponent(session)}/tool-results`,
      {
        method: 'POST',
        body: JSON.stringify({
          tool_use_id: toolUseId,
          output,
          is_error: isError,
        }),
        signal,
      },
    );
  }
  async files(
    directory: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceListing> {
    const query = new URLSearchParams({ directory });
    return (
      await this.request(`/api/workspace/files?${query}`, { signal })
    ).json();
  }
  async file(path: string, signal?: AbortSignal): Promise<WorkspaceFile> {
    const query = new URLSearchParams({ path });
    return (
      await this.request(`/api/workspace/file?${query}`, { signal })
    ).json();
  }
  // GitHub connector: one account per space, held by the gh CLI where Hearth-Core runs.
  private async github<T>(path: string, body?: unknown): Promise<T> {
    const init: { method: string; body?: string } =
      body === undefined
        ? { method: path === '/status' ? 'GET' : 'POST' }
        : { method: 'POST', body: JSON.stringify(body) };
    return (
      await this.request(`/api/connectors/github${path}`, init)
    ).json() as Promise<T>;
  }
  githubStatus() {
    return this.github<GitHubConnection>('/status');
  }
  githubToken(token: string) {
    return this.github<GitHubConnection>('/token', { token });
  }
  githubDeviceStart() {
    return this.github<GitHubDeviceLogin>('/cli/start');
  }
  /** ``{status: "pending", user_code, verification_uri}`` until the owner authorizes. */
  githubDevicePoll(sessionId: string) {
    return this.github<
      GitHubConnection | (GitHubConnection & GitHubDeviceLogin)
    >('/cli/poll', { session_id: sessionId });
  }
  githubDeviceCancel(sessionId: string) {
    return this.github<Record<string, unknown>>('/cli/cancel', {
      session_id: sessionId,
    });
  }
  githubRecheck() {
    return this.github<GitHubConnection>('/reconnect');
  }
  githubDisconnect() {
    return this.github<GitHubConnection>('/disconnect');
  }
  // Claude Code sign-in: ``claude auth login`` run by Hearth-Core inside the container.
  private async claude<T>(path: string, body?: unknown): Promise<T> {
    const init =
      path === '/status'
        ? { method: 'GET' }
        : { method: 'POST', body: JSON.stringify(body ?? {}) };
    return (
      await this.request(`/api/connectors/claude-code${path}`, init)
    ).json() as Promise<T>;
  }
  claudeStatus() {
    return this.claude<ClaudeConnection>('/status');
  }
  claudeLoginStart() {
    return this.claude<ClaudeLoginStart>('/login/start');
  }
  /** Hands the CLI the ``code#state`` the owner pasted; waits briefly for its verdict. */
  claudeLoginCode(sessionId: string, code: string) {
    return this.claude<ClaudeLoginOutcome>('/login/code', {
      session_id: sessionId,
      code,
    });
  }
  claudeLoginPoll(sessionId: string) {
    return this.claude<ClaudeLoginOutcome>('/login/poll', {
      session_id: sessionId,
    });
  }
  claudeLoginCancel(sessionId: string) {
    return this.claude<ClaudeLoginOutcome>('/login/cancel', {
      session_id: sessionId,
    });
  }
  claudeLogout() {
    return this.claude<ClaudeConnection>('/logout');
  }
}
