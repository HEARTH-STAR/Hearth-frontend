import type {
  WorkspaceFile,
  WorkspaceListing,
} from '../shared/computer-types.js';
import { AGENTS, type AgentId } from '../shared/agents.js';
import type { CoreCommit, CoreUpdate } from '../shared/types.js';
import type {
  Blob,
  BranchList,
  CommitDetail,
  CommitPage,
  CommitsQuery,
  RepoList,
  RepoSummary,
  Tree,
  TreeQuery,
} from '../shared/repo-types.js';
import type {
  CommentInput,
  Detection,
  DetectionSummary,
  MergeMethod,
  MergeResult,
  PullComment,
  PullDetail,
  PullFile,
  PullReview,
  RepoWatchInput,
  RepoWatchResult,
  ReviewEvent,
  Watch,
  WatchInput,
  WatchOverview,
  WatchPatch,
} from '../shared/watch-types.js';
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
/** An agent adapter's sign-in routes (``/api/connectors/<connector>``), as returned. */
export interface AgentConnection {
  status: 'connected' | 'needs_auth' | 'unavailable' | string;
  method?: string | null;
  email?: string | null;
  organization?: string | null;
  subscription?: string | null;
  login_supported?: boolean;
  error?: string;
}
export interface AgentLoginStart {
  /** Null when the agent was already signed in (Cursor and Antigravity say so instead of a link). */
  session_id: string | null;
  auth_url: string | null;
  expires_in: number;
  status?: string;
}
export interface AgentLoginOutcome {
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
  // FastAPI's validation errors (422) carry a list: [{msg: 'Value error, …', loc: […]}, …].
  const first = Array.isArray(body?.detail)
    ? (body.detail[0] as { msg?: unknown } | undefined)?.msg
    : undefined;
  const message =
    typeof body?.detail === 'string'
      ? body.detail
      : typeof first === 'string'
        ? first.replace(/^Value error, /, '')
        : typeof body?.error === 'string'
          ? body.error
          : `Hearth-Core returned HTTP ${response.status}.`;
  return new HearthCoreError(message, response.status, body ?? undefined);
}
/** Hearth-Core's `GET /api/core/version`, as it answers. */
export interface RawCoreVersion {
  enabled: boolean;
  branch: string | null;
  current: CoreCommit | null;
  latest: CoreCommit | null;
  update_available: boolean;
  checked_at: string | null;
  error: string | null;
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
  /** Hearth-Core's running commit and the newest on its branch (`refresh` fetches it now). */
  async coreVersion(refresh = false): Promise<RawCoreVersion> {
    const query = refresh ? '?refresh=true' : '';
    return (await this.request(`/api/core/version${query}`)).json();
  }
  /** Move Hearth-Core to the newest commit of its branch; it restarts itself right after answering. */
  async coreUpdate(): Promise<CoreUpdate> {
    return (await this.request('/api/core/update', { method: 'POST' })).json();
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
  // The agent's sign-in, run by Hearth-Core inside the container through the agent's adapter
  // (``claude auth login``, ``cursor-agent login``, a throwaway ``agy -p``).
  private async connector<T>(
    agent: AgentId,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const init =
      path === '/status'
        ? { method: 'GET' }
        : { method: 'POST', body: JSON.stringify(body ?? {}) };
    return (
      await this.request(
        `/api/connectors/${AGENTS[agent].connector}${path}`,
        init,
      )
    ).json() as Promise<T>;
  }
  agentStatus(agent: AgentId) {
    return this.connector<AgentConnection>(agent, '/status');
  }
  agentLoginStart(agent: AgentId) {
    return this.connector<AgentLoginStart>(agent, '/login/start');
  }
  /** Hands the CLI the code the owner pasted (Claude, Antigravity); waits briefly for its verdict. */
  agentLoginCode(agent: AgentId, sessionId: string, code: string) {
    return this.connector<AgentLoginOutcome>(agent, '/login/code', {
      session_id: sessionId,
      code,
    });
  }
  agentLoginPoll(agent: AgentId, sessionId: string) {
    return this.connector<AgentLoginOutcome>(agent, '/login/poll', {
      session_id: sessionId,
    });
  }
  agentLoginCancel(agent: AgentId, sessionId: string) {
    return this.connector<AgentLoginOutcome>(agent, '/login/cancel', {
      session_id: sessionId,
    });
  }
  agentLogout(agent: AgentId) {
    return this.connector<AgentConnection>(agent, '/logout');
  }
  // API watch: Hearth-Core polls OpenAPI specs, and on a breaking change its agent fixes the watched
  // repo and opens a PR through the Space's gh. A 204 answer has no body.
  private async watch<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
    const response = await this.request(`/api/watch${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: (response.status === 204 ? undefined : await response.json()) as T,
    };
  }
  watchOverview() {
    return this.watch<WatchOverview>('GET', '');
  }
  watchCreate(input: WatchInput) {
    return this.watch<Watch>('POST', '', input);
  }
  /** One watch per API provider the repo's dependencies name; takes a while (it fetches the repo). */
  watchFromRepo(input: RepoWatchInput) {
    return this.watch<RepoWatchResult>('POST', '/repo', input);
  }
  watchUpdate(watchId: string, patch: WatchPatch) {
    return this.watch<Watch>('PATCH', `/${encodeURIComponent(watchId)}`, patch);
  }
  watchDelete(watchId: string) {
    return this.watch<undefined>('DELETE', `/${encodeURIComponent(watchId)}`);
  }
  /** Checks the spec now; 409 while a check runs. */
  watchCheck(watchId: string) {
    return this.watch<Watch>(
      'POST',
      `/${encodeURIComponent(watchId)}/check`,
      {},
    );
  }
  detection(detectionId: string) {
    return this.watch<Detection>(
      'GET',
      `/detections/${encodeURIComponent(detectionId)}`,
    );
  }
  /** Starts or retries the AI fix; 409 while one runs or once its PR is open or merged. */
  detectionFix(detectionId: string) {
    return this.watch<DetectionSummary>(
      'POST',
      `/detections/${encodeURIComponent(detectionId)}/fix`,
      {},
    );
  }
  private pull<T>(
    method: 'GET' | 'POST',
    detectionId: string,
    path: string,
    body?: unknown,
  ) {
    return this.watch<T>(
      method,
      `/detections/${encodeURIComponent(detectionId)}/pull${path}`,
      body,
    );
  }
  pullDetail(detectionId: string) {
    return this.pull<PullDetail>('GET', detectionId, '');
  }
  pullFiles(detectionId: string) {
    return this.pull<{ files: PullFile[] }>('GET', detectionId, '/files');
  }
  pullComments(detectionId: string) {
    return this.pull<{ comments: PullComment[] }>(
      'GET',
      detectionId,
      '/comments',
    );
  }
  pullComment(detectionId: string, comment: CommentInput) {
    return this.pull<PullComment>('POST', detectionId, '/comments', comment);
  }
  pullReview(
    detectionId: string,
    review: { event: ReviewEvent; body?: string },
  ) {
    return this.pull<PullReview>('POST', detectionId, '/reviews', review);
  }
  pullMerge(detectionId: string, method: MergeMethod) {
    return this.pull<MergeResult>('POST', detectionId, '/merge', { method });
  }
  // The repo browser: read-only views of Hearth-Core's mirror of each watched repo.
  private async repo<T>(
    owner: string,
    name: string,
    path: string,
    query: Record<string, string | number | undefined> = {},
  ): Promise<T> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) params.set(key, String(value));
    const search = params.toString() ? `?${params}` : '';
    return (
      await this.request(
        `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}${path}${search}`,
      )
    ).json() as Promise<T>;
  }
  /** The repos that have an API watch, which are the ones that can be browsed. */
  async repoList(): Promise<RepoList> {
    return (await this.request('/api/repos')).json();
  }
  repoSummary(owner: string, name: string, ref?: string) {
    return this.repo<RepoSummary>(owner, name, '', { ref });
  }
  repoTree(owner: string, name: string, query: TreeQuery) {
    return this.repo<Tree>(owner, name, '/tree', { ...query });
  }
  repoBlob(owner: string, name: string, query: TreeQuery & { path: string }) {
    return this.repo<Blob>(owner, name, '/blob', { ...query });
  }
  repoCommits(owner: string, name: string, query: CommitsQuery) {
    return this.repo<CommitPage>(owner, name, '/commits', { ...query });
  }
  repoCommit(owner: string, name: string, sha: string) {
    return this.repo<CommitDetail>(
      owner,
      name,
      `/commits/${encodeURIComponent(sha)}`,
    );
  }
  repoBranches(owner: string, name: string) {
    return this.repo<BranchList>(owner, name, '/branches');
  }
}
