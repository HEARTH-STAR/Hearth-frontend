import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  defaultPermissions,
  type ComputerActivity,
  type ComputerPermissions,
  type ContainerRecord,
} from '../shared/computer-types.js';
const KEPT_ACTIVITY = 500;
const DETAIL_LIMIT = 8000;
export class ComputerStore {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS computer_permissions(dotId TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS computer_containers(dotId TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS computer_activity(id TEXT PRIMARY KEY, dotId TEXT NOT NULL, threadId TEXT, tool TEXT NOT NULL, summary TEXT NOT NULL, detail TEXT, outcome TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS computer_activity_dot ON computer_activity(dotId, createdAt);`);
  }
  permissions(dotId: string): ComputerPermissions {
    const row = this.db
      .prepare('SELECT value FROM computer_permissions WHERE dotId=?')
      .get(dotId);
    return row
      ? { ...defaultPermissions, ...JSON.parse(String(row.value)) }
      : { ...defaultPermissions };
  }
  patchPermissions(dotId: string, patch: Partial<ComputerPermissions>) {
    const value = { ...this.permissions(dotId), ...patch };
    this.db
      .prepare('INSERT OR REPLACE INTO computer_permissions VALUES (?, ?)')
      .run(dotId, JSON.stringify(value));
    return value;
  }
  container(dotId: string): ContainerRecord | null {
    const row = this.db
      .prepare('SELECT value FROM computer_containers WHERE dotId=?')
      .get(dotId);
    return row ? (JSON.parse(String(row.value)) as ContainerRecord) : null;
  }
  saveContainer(dotId: string, record: ContainerRecord) {
    this.db
      .prepare('INSERT OR REPLACE INTO computer_containers VALUES (?, ?)')
      .run(dotId, JSON.stringify(record));
    return record;
  }
  begin(
    dotId: string,
    threadId: string | null,
    tool: string,
    summary: string,
    id: string = randomUUID(),
  ) {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO computer_activity VALUES (?, ?, ?, ?, ?, NULL, ?, ?)',
      )
      .run(
        id,
        dotId,
        threadId,
        tool,
        summary.slice(0, 500),
        'pending',
        Date.now(),
      );
    return id;
  }
  finish(
    id: string,
    outcome: Exclude<ComputerActivity['outcome'], 'pending'>,
    detail: string | null = null,
  ) {
    this.db
      .prepare(
        "UPDATE computer_activity SET outcome=?, detail=? WHERE id=? AND outcome='pending'",
      )
      .run(outcome, detail?.slice(0, DETAIL_LIMIT) ?? null, id);
    this.db
      .prepare(
        `DELETE FROM computer_activity WHERE dotId=(SELECT dotId FROM computer_activity WHERE id=?) AND id NOT IN (SELECT id FROM computer_activity WHERE dotId=(SELECT dotId FROM computer_activity WHERE id=?) ORDER BY createdAt DESC, rowid DESC LIMIT ${KEPT_ACTIVITY})`,
      )
      .run(id, id);
  }
  /** Marks a run's calls that never reported back (Claude Code reports only successful tools). */
  settle(ids: string[], detail: string) {
    for (const id of ids) this.finish(id, 'failed', detail);
  }
  activity(dotId: string, limit = 100): ComputerActivity[] {
    return this.db
      .prepare(
        'SELECT id, threadId, tool, summary, detail, outcome, createdAt FROM computer_activity WHERE dotId=? ORDER BY createdAt DESC, rowid DESC LIMIT ?',
      )
      .all(dotId, limit) as unknown as ComputerActivity[];
  }
}
