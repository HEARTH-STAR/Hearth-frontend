import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { AbstractAgent } from '@ag-ui/client';
import {
  CopilotRuntime,
  createCopilotHonoHandler,
  type CopilotHonoApp,
} from '@copilotkit/runtime/v2';
import { SqliteAgentRunner } from '@copilotkit/sqlite-runner';
import { ComputerService } from './computer-service.js';
import type { HearthConfig } from './config.js';
import { HearthAgent } from './hearth-agent.js';
import { HearthBackend } from './hearth-backend.js';
import { HearthCore } from './hearth-core.js';
import { PageService } from './page-service.js';
import { validateRuntimeScope } from './runtime-scope.js';
import { ServiceMonitor } from './service-status.js';
import { SpaceService } from './space-service.js';
import { Store } from './store.js';
import { WorkspaceStore } from './workspace.js';
/**
 * The runner records ``is_running`` per conversation in its database. A run cut short by a restart
 * (``npm run dev`` restarts on every save) would leave its conversation "already running" for good,
 * and no run survives a restart, so the flags are cleared before the runner opens the file.
 */
export function clearInterruptedRuns(path: string) {
  if (path === ':memory:' || !existsSync(path)) return;
  const db = new DatabaseSync(path);
  try {
    const table = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='run_state'",
      )
      .get();
    if (table)
      db.exec(
        'UPDATE run_state SET is_running=0, current_run_id=NULL WHERE is_running=1',
      );
  } finally {
    db.close();
  }
}
/** Runs ``use`` on the runner's database when it is a file with run tables (not ``:memory:``). */
function withRunTables<T>(path: string, use: (db: DatabaseSync) => T) {
  if (path === ':memory:' || !existsSync(path)) return undefined;
  const db = new DatabaseSync(path);
  try {
    const table = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_runs'",
      )
      .get();
    return table ? use(db) : undefined;
  } finally {
    db.close();
  }
}
/** Whether the runner has a turn of this conversation in progress. */
export function threadIsRunning(path: string, threadId: string) {
  return !!withRunTables(
    path,
    (db) =>
      db
        .prepare('SELECT 1 FROM run_state WHERE thread_id=? AND is_running=1')
        .get(threadId) !== undefined,
  );
}
/** Removes a conversation's recorded history (its AG-UI run events) from the runner. */
export function deleteThreadRuns(path: string, threadId: string) {
  withRunTables(path, (db) => {
    db.prepare('DELETE FROM agent_runs WHERE thread_id=?').run(threadId);
    db.prepare('DELETE FROM run_state WHERE thread_id=?').run(threadId);
  });
}
export interface PlatformOptions {
  /** SQLite file for conversation history (AG-UI run events); ``:memory:`` in tests. */
  threadsDatabase: string;
  backend?: HearthBackend;
  /** The client for the Hearth-Core a Space's container serves at ``url`` (faked in tests). */
  coreAt?: (url: string) => HearthCore;
}
/**
 * Everything behind ``/api``: the CopilotKit runtime (SSE mode, no Intelligence) whose agents are
 * one HearthAgent per Dot, the Hearth-backend client, the Spaces (one container each, with its own
 * Hearth-Core), and the computer and page services.
 */
export class Platform {
  readonly backend: HearthBackend;
  readonly monitor: ServiceMonitor;
  readonly spaces: SpaceService;
  readonly computers: ComputerService;
  readonly pages: PageService;
  readonly handler: CopilotHonoApp;
  private runner: SqliteAgentRunner;
  private readonly threadsDatabase: string;
  constructor(
    readonly store: Store,
    readonly workspace: WorkspaceStore,
    readonly config: HearthConfig,
    options: PlatformOptions,
  ) {
    this.backend =
      options.backend ??
      new HearthBackend(config.backendUrl, config.backendToken);
    this.monitor = new ServiceMonitor(this.backend);
    this.spaces = new SpaceService(
      workspace,
      this.backend,
      config,
      options.coreAt,
    );
    this.computers = new ComputerService(workspace, this.spaces);
    this.pages = new PageService(workspace);
    this.threadsDatabase = options.threadsDatabase;
    clearInterruptedRuns(options.threadsDatabase);
    this.runner = new SqliteAgentRunner({ dbPath: options.threadsDatabase });
    // Each Dot runs in its home Space's container.
    const deps = {
      store,
      workspace,
      core: (spaceId: string) => this.spaces.core(spaceId),
      config,
    };
    const runtime = new CopilotRuntime({
      runner: this.runner,
      agents: () =>
        Object.fromEntries(
          workspace
            .dots()
            .map((dot) => [dot.id, new HearthAgent(deps, dot.id)]),
        ) as Record<string, AbstractAgent> & { [key: string]: AbstractAgent },
    });
    this.handler = createCopilotHonoHandler({
      runtime,
      basePath: '/api/copilotkit',
      cors: { origin: [] },
    });
  }
  setup() {
    return this.monitor.status();
  }
  createConversation(dotId: string, title: string) {
    if (!this.workspace.dot(dotId)) throw new Error('Dot not found.');
    return this.workspace.bindThread(randomUUID(), dotId, title);
  }
  renameConversation(id: string, title: string) {
    return this.workspace.renameThread(id, title);
  }
  /**
   * Deletes a conversation from Hearth and its history from the runner. A running one is stopped
   * first by its owner, and a page's own conversation stays with its page. The agent's copy of the
   * session inside the Dot's container is out of reach from here and is left alone.
   */
  deleteConversation(id: string) {
    this.workspace.requireThread(id);
    if (this.workspace.isPageThread(id))
      throw new Error(
        'A page’s conversation stays with its page. Rename it instead.',
      );
    if (threadIsRunning(this.threadsDatabase, id))
      throw new Error(
        'This conversation is still running. Stop it, then delete it.',
      );
    this.workspace.deleteThread(id);
    deleteThreadRuns(this.threadsDatabase, id);
  }
  async handle(request: Request): Promise<Response> {
    let body: unknown;
    if (request.method !== 'GET' && request.method !== 'HEAD')
      body = await request
        .clone()
        .json()
        .catch(() => null);
    try {
      validateRuntimeScope(request, this.workspace, body);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Conversation scope denied.',
        },
        { status: 403 },
      );
    }
    return this.handler.fetch(request);
  }
  stop() {
    this.runner.close();
  }
}
