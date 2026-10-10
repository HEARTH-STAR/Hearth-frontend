import { randomUUID } from 'node:crypto';
import { PageError } from './pages.js';
import type { WorkspaceStore } from './workspace.js';
export class PageService {
  constructor(private workspace: WorkspaceStore) {}
  /** The page's conversation with this Dot, created on first use. */
  conversation(spaceId: string, pageId: string, dotId: string) {
    const page = this.workspace.pages.get(spaceId, pageId);
    const dot = this.workspace.dot(dotId);
    if (!dot || !this.workspace.canAccessSpace(dotId, spaceId))
      throw new PageError(
        'Choose a specialist in this Space with access enabled.',
        400,
      );
    const current = this.workspace.pages.thread(pageId, dotId);
    if (current?.ready)
      return this.workspace.requireThread(current.threadId, dotId);
    if (!this.workspace.pages.reserveThread(pageId, dotId, randomUUID()))
      throw new PageError(
        'This page conversation is being created. Retry shortly.',
        409,
      );
    const threadId = this.workspace.pages.thread(pageId, dotId)!.threadId;
    try {
      const thread =
        this.workspace.conversations().find((t) => t.id === threadId) ??
        this.workspace.bindThread(threadId, dotId, page.title);
      this.workspace.pages.finishThread(pageId, dotId);
      return thread;
    } catch (error) {
      this.workspace.pages.releaseThread(pageId, dotId);
      throw error;
    }
  }
  saveConversation(threadId: string, title: string, parentId: string | null) {
    const thread = this.workspace.requireThread(threadId);
    const dot = this.workspace.dot(thread.dotId)!;
    const content = this.workspace
      .transcript(threadId)
      .map(
        (entry) =>
          `## ${entry.role === 'user' ? 'You' : dot.name}\n\n${entry.text}`,
      )
      .join('\n\n');
    if (!content)
      throw new PageError('This conversation has no saved text yet.');
    if (content.length > 100000)
      throw new PageError(
        'This conversation exceeds the 100,000 character page limit. Save a shorter conversation.',
      );
    const destination =
      this.workspace.pages.forThread(threadId)?.spaceId ?? dot.spaceId;
    if (!this.workspace.canAccessSpace(dot.id, destination))
      throw new PageError('Space access has been revoked.', 400);
    return this.workspace.pages.create(
      destination,
      { title, content, parentId },
      threadId,
    );
  }
}
