import { ComputerStore } from './computer-store.js';
import { Pages } from './pages.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Conversation, Dot, StoredSpace } from '../shared/types.js';
import { DEFAULT_AGENT, isAgentId, type AgentId } from '../shared/agents.js';
export type DotInput = Pick<Dot, 'name' | 'instructions'> & {
  spaceId: string;
  spaceIds?: string[];
  directory?: string;
};
export type DotPatch = Partial<DotInput>;
export interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
}
/** What a Dot is told when nobody gave it other instructions (every Dot made from the + button). */
export const DEFAULT_INSTRUCTIONS =
  'Be thoughtful, practical, and concise. Read what is in your folder before answering, keep notes as Markdown files, and show drafts for review before saving them to a Space.';
/** Lowercase letters, digits and dashes: safe for a folder and a container name. */
export function slug(value: string, fallback = 'dot') {
  const result = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
  return result || fallback;
}
export class WorkspaceStore {
  private db: DatabaseSync;
  readonly pages: Pages;
  readonly computers: ComputerStore;
  constructor(
    path: string,
    readonly ownerId: string,
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS space_containers(spaceId TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS space_agents(spaceId TEXT PRIMARY KEY, agent TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dots(id TEXT PRIMARY KEY, spaceId TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, instructions TEXT NOT NULL, directory TEXT NOT NULL, memoryAllowed INTEGER NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS dot_spaces(dotId TEXT NOT NULL, spaceId TEXT NOT NULL, PRIMARY KEY(dotId, spaceId));
      CREATE TABLE IF NOT EXISTS thread_bindings(id TEXT PRIMARY KEY, dotId TEXT NOT NULL, ownerId TEXT NOT NULL, title TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, preview TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS transcripts(id INTEGER PRIMARY KEY AUTOINCREMENT, threadId TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS transcripts_thread ON transcripts(threadId, id);
      CREATE TABLE IF NOT EXISTS handoffs(threadId TEXT NOT NULL, toolCallId TEXT NOT NULL, tool TEXT NOT NULL, answered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(threadId, toolCallId));`);
    this.computers = new ComputerStore(this.db);
    this.pages = new Pages(this.db, (id) =>
      this.spaces().some((space) => space.id === id),
    );
    if (!this.spaces().length) {
      const space = this.createSpace('Scout', '');
      this.createDot({
        spaceId: space.id,
        name: 'Scout',
        instructions: DEFAULT_INSTRUCTIONS,
      });
    }
    this.nameSpacesAfterDots();
  }
  /**
   * Each Dot is a Space, so a Space that is home to one Dot carries that Dot's name. Spaces made
   * before that rule (the first one was "Everyday", next to "Scout") are renamed once here, and
   * their old seeded description goes with it.
   */
  private nameSpacesAfterDots() {
    const homes = new Map<string, Dot[]>();
    for (const dot of this.dots())
      homes.set(dot.spaceId, [...(homes.get(dot.spaceId) ?? []), dot]);
    for (const space of this.spaces()) {
      const dots = homes.get(space.id);
      if (dots?.length !== 1) continue;
      if (space.name !== dots[0].name)
        this.db
          .prepare('UPDATE spaces SET name=? WHERE id=?')
          .run(dots[0].name, space.id);
      if (space.description === 'A little space for your day.')
        this.db
          .prepare("UPDATE spaces SET description='' WHERE id=?")
          .run(space.id);
    }
  }
  close() {
    this.db.close();
  }
  spaces(): StoredSpace[] {
    return this.db
      .prepare(
        'SELECT spaces.*, (SELECT COUNT(*) FROM pages WHERE pages.spaceId=spaces.id) AS pageCount, space_containers.name AS container, space_agents.agent AS agent FROM spaces LEFT JOIN space_containers ON space_containers.spaceId=spaces.id LEFT JOIN space_agents ON space_agents.spaceId=spaces.id ORDER BY spaces.createdAt',
      )
      .all()
      .map((row) => ({
        ...row,
        pageCount: Number(row.pageCount),
        container: row.container === null ? null : String(row.container),
        // Spaces made before agents could be picked have no row: they run Claude Code.
        agent: isAgentId(row.agent) ? row.agent : DEFAULT_AGENT,
      })) as unknown as StoredSpace[];
  }
  space(id: string) {
    return this.spaces().find((space) => space.id === id);
  }
  createSpace(
    name: string,
    description: string,
    agent: AgentId = DEFAULT_AGENT,
  ): StoredSpace {
    const space = {
      id: randomUUID(),
      name,
      description,
      createdAt: Date.now(),
      pageCount: 0,
      container: null,
      agent,
    };
    this.transaction(() => {
      this.db
        .prepare('INSERT INTO spaces VALUES (?, ?, ?, ?)')
        .run(space.id, name, description, space.createdAt);
      this.db
        .prepare('INSERT INTO space_agents VALUES (?, ?)')
        .run(space.id, agent);
    });
    return space;
  }
  /** Records the Docker name of the Space's container. */
  setSpaceContainer(spaceId: string, name: string) {
    this.db
      .prepare(
        'INSERT INTO space_containers VALUES (?, ?, ?) ON CONFLICT(spaceId) DO UPDATE SET name=excluded.name',
      )
      .run(spaceId, name, Date.now());
  }
  dots(): Dot[] {
    // role and memoryAllowed are leftover columns: older databases have them, nothing reads them.
    return this.db
      .prepare(
        'SELECT id, spaceId, name, instructions, directory, createdAt FROM dots ORDER BY createdAt',
      )
      .all()
      .map((row) => ({
        ...row,
        spaceIds: this.db
          .prepare(
            'SELECT spaceId FROM dot_spaces WHERE dotId=? ORDER BY spaceId',
          )
          .all(String(row.id))
          .map((grant) => String(grant.spaceId)),
      })) as unknown as Dot[];
  }
  dot(id: string) {
    return this.dots().find((dot) => dot.id === id);
  }
  createDot(input: DotInput): Dot {
    const spaceIds = [...new Set(input.spaceIds ?? [input.spaceId])].sort();
    this.validateSpaceAccess(input.spaceId, spaceIds);
    const id = randomUUID();
    const dot: Dot = {
      id,
      spaceId: input.spaceId,
      spaceIds,
      name: input.name,
      instructions: input.instructions,
      directory:
        input.directory ?? `dots/${slug(input.name)}-${id.slice(0, 8)}`,
      createdAt: Date.now(),
    };
    this.transaction(() => {
      this.db
        .prepare('INSERT INTO dots VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          dot.id,
          dot.spaceId,
          dot.name,
          '',
          dot.instructions,
          dot.directory,
          0,
          dot.createdAt,
        );
      for (const space of dot.spaceIds)
        this.db.prepare('INSERT INTO dot_spaces VALUES (?, ?)').run(id, space);
    });
    return dot;
  }
  updateDot(id: string, patch: DotPatch): Dot {
    const current = this.dot(id);
    if (!current) throw new Error('Dot not found.');
    const next = {
      ...current,
      ...Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ),
    };
    const spaceIds = [...new Set(patch.spaceIds ?? current.spaceIds)].sort();
    this.validateSpaceAccess(next.spaceId, spaceIds);
    this.transaction(() => {
      this.db
        .prepare(
          'UPDATE dots SET spaceId=?, name=?, instructions=?, directory=? WHERE id=?',
        )
        .run(next.spaceId, next.name, next.instructions, next.directory, id);
      this.db.prepare('DELETE FROM dot_spaces WHERE dotId=?').run(id);
      for (const space of spaceIds)
        this.db.prepare('INSERT INTO dot_spaces VALUES (?, ?)').run(id, space);
    });
    // A renamed Dot renames its own Space.
    this.nameSpacesAfterDots();
    return this.dot(id)!;
  }
  canAccessSpace(dotId: string, spaceId: string) {
    return !!this.db
      .prepare('SELECT 1 FROM dot_spaces WHERE dotId=? AND spaceId=?')
      .get(dotId, spaceId);
  }
  private validateSpaceAccess(defaultSpace: string, spaceIds: string[]) {
    const known = new Set(this.spaces().map((space) => space.id));
    if (
      !spaceIds.includes(defaultSpace) ||
      spaceIds.some((id) => !known.has(id))
    )
      throw new Error('Space access must include a valid default destination.');
  }
  private transaction(fn: () => void) {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  conversations(): Conversation[] {
    return this.db
      .prepare(
        'SELECT * FROM thread_bindings WHERE ownerId=? ORDER BY updatedAt DESC',
      )
      .all(this.ownerId) as unknown as Conversation[];
  }
  bindThread(id: string, dotId: string, title: string): Conversation {
    if (!this.dot(dotId)) throw new Error('Dot not found.');
    const now = Date.now();
    const value: Conversation = {
      id,
      dotId,
      ownerId: this.ownerId,
      title,
      createdAt: now,
      updatedAt: now,
      preview: '',
    };
    this.db
      .prepare('INSERT INTO thread_bindings VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, dotId, this.ownerId, title, now, now, '');
    return value;
  }
  requireThread(id: string, dotId?: string): Conversation {
    const thread = this.db
      .prepare('SELECT * FROM thread_bindings WHERE id=? AND ownerId=?')
      .get(id, this.ownerId) as unknown as Conversation | undefined;
    if (!thread || (dotId && thread.dotId !== dotId))
      throw new Error('Conversation does not belong to this Dot and owner.');
    return thread;
  }
  /** Moves a conversation to the top of the sidebar with a fresh one-line preview. */
  touchThread(id: string, preview: string) {
    this.db
      .prepare('UPDATE thread_bindings SET updatedAt=?, preview=? WHERE id=?')
      .run(Date.now(), preview.replace(/\s+/g, ' ').trim().slice(0, 160), id);
  }
  appendTranscript(
    threadId: string,
    role: TranscriptEntry['role'],
    text: string,
  ) {
    if (!text.trim()) return;
    this.db
      .prepare(
        'INSERT INTO transcripts(threadId, role, text, createdAt) VALUES (?, ?, ?, ?)',
      )
      .run(threadId, role, text, Date.now());
  }
  /** A decision handed to the owner (a review card); their answer goes to the agent next turn. */
  openHandoff(threadId: string, toolCallId: string, tool: string) {
    this.db
      .prepare('INSERT OR IGNORE INTO handoffs VALUES (?, ?, ?, 0)')
      .run(threadId, toolCallId, tool);
  }
  /** Handoffs whose answer has not reached the agent yet: tool call id → tool name. */
  openHandoffs(threadId: string) {
    return new Map(
      this.db
        .prepare(
          'SELECT toolCallId, tool FROM handoffs WHERE threadId=? AND answered=0',
        )
        .all(threadId)
        .map((row) => [String(row.toolCallId), String(row.tool)]),
    );
  }
  answerHandoffs(threadId: string, toolCallIds: string[]) {
    for (const id of toolCallIds)
      this.db
        .prepare(
          'UPDATE handoffs SET answered=1 WHERE threadId=? AND toolCallId=?',
        )
        .run(threadId, id);
  }
  transcript(threadId: string): TranscriptEntry[] {
    this.requireThread(threadId);
    return this.db
      .prepare(
        'SELECT role, text, createdAt FROM transcripts WHERE threadId=? ORDER BY id',
      )
      .all(threadId) as unknown as TranscriptEntry[];
  }
}
