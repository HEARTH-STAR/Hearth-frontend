import { expect, it, vi } from 'vitest';
import { WorkspaceStore } from '../src/server/workspace.js';
import { PageService } from '../src/server/page-service.js';
import { pageAccess } from '../src/server/page-tools.js';
it('reuses one thread per page and Dot', () => {
  const ws = new WorkspaceStore(':memory:', 'owner');
  const dot = ws.dots()[0];
  const page = ws.pages.create(dot.spaceId, { title: 'Design' });
  const service = new PageService(ws);
  const a = service.conversation(dot.spaceId, page.id, dot.id);
  const b = service.conversation(dot.spaceId, page.id, dot.id);
  expect(a.id).toBe(b.id);
  expect(a.title).toBe('Design');
  expect(ws.pages.forThread(a.id, dot.spaceId)?.id).toBe(page.id);
  ws.close();
});
it('saves the conversation transcript as a page and rejects empty or oversized history', () => {
  const ws = new WorkspaceStore(':memory:', 'owner');
  const dot = ws.dots()[0];
  ws.bindThread('thread', dot.id, 'Thread');
  const service = new PageService(ws);
  expect(() => service.saveConversation('thread', 'Empty', null)).toThrow(
    /no saved text/,
  );
  ws.appendTranscript('thread', 'user', 'Question');
  ws.appendTranscript('thread', 'assistant', 'Answer');
  const page = service.saveConversation('thread', 'Saved', null);
  expect(page.content).toBe('## You\n\nQuestion\n\n## Scout\n\nAnswer');
  expect(page.sourceThreadId).toBe('thread');
  ws.appendTranscript('thread', 'assistant', 'x'.repeat(100001));
  expect(() => service.saveConversation('thread', 'Too long', null)).toThrow(
    /exceeds/,
  );
  expect(ws.pages.list(dot.spaceId)).toHaveLength(1);
  ws.close();
});
it('scopes agent tools to the Dot Space and re-reads current context with CAS and pause enforcement', () => {
  const ws = new WorkspaceStore(':memory:', 'owner');
  const dot = ws.dots()[0];
  const other = ws.createSpace('Other', '');
  const foreign = ws.pages.create(other.id, { title: 'Private' });
  const page = ws.pages.create(dot.spaceId, { title: 'Here' });
  ws.bindThread('thread', dot.id, 'Page');
  ws.pages.reserveThread(page.id, dot.id, 'thread');
  ws.pages.finishThread(page.id, dot.id);
  let paused = false;
  const access = pageAccess(ws, dot.spaceId, 'thread', () => {
    if (paused) throw new Error('Paused');
  });
  expect(() => access.read(foreign.id)).toThrow();
  access.edit(page.id, { expectedRevision: 1, content: 'Fresh' });
  expect(access.context()?.content).toBe('Fresh');
  expect(() =>
    access.edit(page.id, { expectedRevision: 1, content: 'Stale' }),
  ).toThrow();
  paused = true;
  expect(() => access.create({ title: 'No write' })).toThrow('Paused');
  expect(ws.pages.list(dot.spaceId)).toHaveLength(1);
  ws.close();
});
it('recovers a reserved thread after its lease expires', () => {
  const ws = new WorkspaceStore(':memory:', 'owner');
  const dot = ws.dots()[0];
  const page = ws.pages.create(dot.spaceId, { title: 'Recover' });
  ws.pages.reserveThread(page.id, dot.id, 'stable-thread');
  const service = new PageService(ws);
  expect(() => service.conversation(dot.spaceId, page.id, dot.id)).toThrow(
    /being created/,
  );
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61000);
  expect(service.conversation(dot.spaceId, page.id, dot.id).id).toBe(
    'stable-thread',
  );
  vi.restoreAllMocks();
  ws.close();
});
it('rejects a specialist in another Space', () => {
  const ws = new WorkspaceStore(':memory:', 'owner');
  const dot = ws.dots()[0];
  const space = ws.createSpace('Other', '');
  const page = ws.pages.create(space.id, { title: 'Other' });
  const service = new PageService(ws);
  expect(() => service.conversation(space.id, page.id, dot.id)).toThrow(
    /specialist in this Space/,
  );
  ws.close();
});
it('grants multiple Spaces without changing thread identity and enforces revocation on existing tools', () => {
  const ws = new WorkspaceStore(':memory:', 'owner');
  const dot = ws.dots()[0];
  const other = ws.createSpace('Launch', '');
  const page = ws.pages.create(other.id, { title: 'Brief' });
  ws.updateDot(dot.id, { spaceIds: [dot.spaceId, other.id] });
  const service = new PageService(ws);
  const thread = service.conversation(other.id, page.id, dot.id);
  ws.appendTranscript(thread.id, 'assistant', 'Saved text');
  const access = pageAccess(ws, dot.spaceId, thread.id, () => {});
  expect(access.context()?.id).toBe(page.id);
  expect(access.read(page.id).title).toBe('Brief');
  expect(access.spaces()).toHaveLength(2);
  expect(service.saveConversation(thread.id, 'Copy', null).spaceId).toBe(
    other.id,
  );
  ws.updateDot(dot.id, { spaceIds: [dot.spaceId] });
  expect(() => access.read(page.id, other.id)).toThrow(/access/);
  expect(() =>
    access.edit(page.id, { expectedRevision: 1, content: 'No' }, other.id),
  ).toThrow(/access/);
  expect(() => service.conversation(other.id, page.id, dot.id)).toThrow();
  expect(() => service.saveConversation(thread.id, 'No', null)).toThrow(
    /revoked/,
  );
  ws.updateDot(dot.id, { spaceIds: [dot.spaceId, other.id] });
  expect(service.conversation(other.id, page.id, dot.id).id).toBe(thread.id);
  ws.close();
});
