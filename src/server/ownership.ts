import type { MiddlewareHandler } from 'hono';
import type { HearthEnv } from './auth.js';
import type { AccountStore } from './db/accounts.js';
import type { WorkspaceStore } from './workspace.js';

/** Paths that name a Dot, a Space or a conversation right after /api. */
export const OWNED_PATH = /^\/api\/(dots|spaces|conversations)\/([^/]+)/;
const missing = {
  dots: 'Dot not found.',
  spaces: 'Space not found.',
  conversations: 'Conversation not found.',
} as const;
type Kind = keyof typeof missing;

/**
 * The Space a path id belongs to: a Space is itself, a Dot its home Space, a conversation its Dot's.
 * Each Dot is a Space, and the Space's id is the ``dots.dot_id`` that records who owns it.
 */
export function homeSpace(workspace: WorkspaceStore, kind: Kind, id: string) {
  if (kind === 'spaces') return id;
  const dotId = kind === 'dots' ? id : workspace.conversation(id)?.dotId;
  return dotId ? workspace.dot(dotId)?.spaceId : undefined;
}

/**
 * Every route under /api/dots/:id, /api/spaces/:id and /api/conversations/:id (chat, files, pages,
 * terminal, setup, delete, …) answers only the user who owns that Dot: anyone else gets the same
 * 404 as for an id that does not exist.
 */
export function ownershipGuard(
  workspace: WorkspaceStore,
  accounts: AccountStore,
): MiddlewareHandler<HearthEnv> {
  return async (c, next) => {
    const match = OWNED_PATH.exec(c.req.path);
    if (match) {
      const kind = match[1] as Kind;
      let id: string;
      try {
        id = decodeURIComponent(match[2]);
      } catch {
        return c.json({ error: missing[kind] }, 404);
      }
      const space = homeSpace(workspace, kind, id);
      if (!space || !(await accounts.owns(c.get('userId'), space)))
        return c.json({ error: missing[kind] }, 404);
    }
    await next();
  };
}
