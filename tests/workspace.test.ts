import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { slug, WorkspaceStore } from '../src/server/workspace.js';
it('persists spaces, Dots with a folder, and canonical thread ownership', () => {
  const store = new WorkspaceStore(':memory:', 'owner');
  const space = store.createSpace('Design', 'Design decisions');
  const dot = store.createDot({
    spaceId: space.id,
    name: 'Scout Prime!',
    instructions: 'Be concise',
  });
  expect(dot.directory).toBe(`dots/scout-prime-${dot.id.slice(0, 8)}`);
  store.bindThread('thread-1', dot.id, 'Design research');
  expect(store.requireThread('thread-1', dot.id).ownerId).toBe('owner');
  expect(() => store.requireThread('thread-1', 'another-dot')).toThrow();
  expect(() => store.requireThread('unknown')).toThrow();
  expect(store.dot(dot.id)).toEqual({
    id: dot.id,
    spaceId: space.id,
    spaceIds: [space.id],
    name: 'Scout Prime!',
    instructions: 'Be concise',
    directory: dot.directory,
    createdAt: dot.createdAt,
  });
  store.close();
});
it('rejects a dot in a nonexistent space and does not rebind an existing thread', () => {
  const store = new WorkspaceStore(':memory:', 'owner');
  expect(() =>
    store.createDot({
      spaceId: 'missing',
      name: 'Dot',
      instructions: 'Help',
    }),
  ).toThrow();
  const dots = store.dots();
  store.bindThread('one', dots[0].id, 'First');
  expect(() => store.bindThread('one', dots[0].id, 'Second')).toThrow();
  store.close();
});
it('keeps conversation previews and transcripts, newest conversation first', () => {
  const store = new WorkspaceStore(':memory:', 'owner');
  const dot = store.dots()[0];
  store.bindThread('older', dot.id, 'Older');
  store.bindThread('newer', dot.id, 'Newer');
  store.touchThread('older', '  Saved  "notes.md"\n into Launch ');
  expect(store.conversations()[0]).toMatchObject({
    id: 'older',
    preview: 'Saved "notes.md" into Launch',
  });
  store.appendTranscript('older', 'user', 'Hi');
  store.appendTranscript('older', 'assistant', '   ');
  store.appendTranscript('older', 'assistant', 'Hello');
  expect(store.transcript('older').map((entry) => entry.text)).toEqual([
    'Hi',
    'Hello',
  ]);
  expect(() => store.transcript('missing')).toThrow();
  store.close();
});
it('never restores revoked Space access on restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hearth-access-'));
  const path = join(dir, 'workspace.sqlite');
  try {
    const ws = new WorkspaceStore(path, 'owner');
    const dot = ws.dots()[0];
    const other = ws.createSpace('New', '');
    expect(() => ws.updateDot(dot.id, { spaceIds: ['missing'] })).toThrow();
    expect(ws.dot(dot.id)?.spaceIds).toEqual([dot.spaceId]);
    ws.bindThread('existing-thread', dot.id, 'Keep me');
    ws.updateDot(dot.id, { spaceId: other.id, spaceIds: [other.id] });
    ws.close();
    const reopened = new WorkspaceStore(path, 'owner');
    expect(reopened.dot(dot.id)?.spaceIds).toEqual([other.id]);
    expect(reopened.canAccessSpace(dot.id, dot.spaceId)).toBe(false);
    expect(reopened.requireThread('existing-thread').dotId).toBe(dot.id);
    expect(reopened.dots()).toHaveLength(1);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it('names each Dot’s own Space after the Dot, renaming older ones once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hearth-names-'));
  const path = join(dir, 'workspace.sqlite');
  try {
    const ws = new WorkspaceStore(path, 'owner');
    const scout = ws.dots()[0];
    expect(ws.space(scout.spaceId)).toMatchObject({
      name: 'Scout',
      description: '',
    });
    const shared = ws.createSpace('Team', 'Shared notes');
    const first = ws.createDot({
      spaceId: shared.id,
      name: 'Ada',
      instructions: 'Help',
    });
    ws.createDot({ spaceId: shared.id, name: 'Lin', instructions: 'Help' });
    ws.close();
    // A database from before the rule: the first Space was "Everyday".
    const legacy = new DatabaseSync(path);
    legacy
      .prepare('UPDATE spaces SET name=?, description=? WHERE id=?')
      .run('Everyday', 'A little space for your day.', scout.spaceId);
    legacy.close();
    const reopened = new WorkspaceStore(path, 'owner');
    expect(reopened.space(scout.spaceId)).toMatchObject({
      name: 'Scout',
      description: '',
    });
    // a Space two Dots call home is not one Dot's, so it keeps its name
    expect(reopened.space(shared.id)?.name).toBe('Team');
    reopened.updateDot(scout.id, { name: 'Scout Prime' });
    expect(reopened.space(scout.spaceId)?.name).toBe('Scout Prime');
    expect(reopened.dot(first.id)?.spaceId).toBe(shared.id);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it('slugs names for folders and container names', () => {
  expect(slug('Scout')).toBe('scout');
  expect(slug('  Ünïcode Dot!! ')).toBe('unicode-dot');
  expect(slug('***')).toBe('dot');
  expect(slug('a'.repeat(50))).toHaveLength(32);
});
