import { WorkspaceStore } from './workspace.js';
/**
 * Lets through only the CopilotKit runtime routes the web app uses (SSE mode), and only for a
 * Dot and a conversation this owner has: ``info``, and ``agent/:dotId/run|connect|stop``.
 * ``owns`` says whether the signed-in user owns a Dot; one they do not own counts as unknown.
 */
export function validateRuntimeScope(
  request: Request,
  workspace: WorkspaceStore,
  body: unknown,
  owns: (dotId: string) => boolean = () => true,
): void {
  const url = new URL(request.url);
  const prefix = '/api/copilotkit/';
  const deny = () => {
    throw new Error('This runtime route is not enabled in Hearth.');
  };
  if (!url.pathname.startsWith(prefix)) return deny();
  const path = url.pathname.slice(prefix.length);
  const data =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const id = (value: string) => {
    const decoded = decodeURIComponent(value);
    if (!decoded || /[/\\\s]/.test(decoded)) return deny();
    return decoded;
  };
  let agentId: string | undefined;
  let threadId: string | undefined;
  let methods: string[];
  let match: RegExpMatchArray | null;
  // Match the whole path. The SDK accepts suffix matches, so accepting arbitrary
  // prefixes here would validate a different thread than the SDK dispatches.
  if (path === 'info') methods = ['GET'];
  else if ((match = path.match(/^agent\/([^/]+)\/(run|connect)$/))) {
    agentId = id(match[1]);
    threadId = typeof data.threadId === 'string' ? data.threadId : undefined;
    if (!threadId) return deny();
    methods = ['POST'];
  } else if ((match = path.match(/^agent\/([^/]+)\/stop\/([^/]+)$/))) {
    agentId = id(match[1]);
    threadId = id(match[2]);
    methods = ['POST'];
  } else return deny();
  if (!methods.includes(request.method)) return deny();
  const bodyAgent = typeof data.agentId === 'string' ? data.agentId : undefined;
  const queryAgent = url.searchParams.get('agentId') ?? undefined;
  for (const candidate of [agentId, bodyAgent, queryAgent]) {
    if (
      candidate &&
      (!workspace.dot(candidate) ||
        !owns(candidate) ||
        (agentId && candidate !== agentId))
    )
      return deny();
  }
  agentId ??= bodyAgent ?? queryAgent;
  for (const candidate of [
    threadId,
    typeof data.threadId === 'string' ? data.threadId : undefined,
    url.searchParams.get('threadId') ?? undefined,
  ]) {
    if (candidate) {
      if (threadId && candidate !== threadId) return deny();
      workspace.requireThread(candidate, agentId);
    }
  }
}
