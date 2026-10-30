import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Settings } from '../shared/types.js';

const defaults: Settings = {
  name: 'Owner',
  paused: false,
};
/**
 * Each user's settings (by Clerk user id), and the settings of a Hearth with no users (no id).
 * Spaces, Dots and conversations live in WorkspaceStore.
 */
export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_settings (userId TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.db
      .prepare('INSERT OR IGNORE INTO settings VALUES (1, ?)')
      .run(JSON.stringify(defaults));
  }
  close() {
    this.db.close();
  }
  settings(userId?: string): Settings {
    const row = (
      userId === undefined
        ? this.db.prepare('SELECT value FROM settings WHERE id=1').get()
        : this.db
            .prepare('SELECT value FROM user_settings WHERE userId=?')
            .get(userId)
    ) as { value: string } | undefined;
    // Keep only known keys so settings saved by older versions stay valid.
    const saved = JSON.parse(row?.value ?? '{}') as Partial<Settings>;
    return {
      name: typeof saved.name === 'string' ? saved.name : defaults.name,
      paused: saved.paused ?? defaults.paused,
    };
  }
  updateSettings(patch: Partial<Settings>, userId?: string): Settings {
    const settings = { ...this.settings(userId), ...patch };
    if (userId === undefined)
      this.db
        .prepare('UPDATE settings SET value=? WHERE id=1')
        .run(JSON.stringify(settings));
    else
      this.db
        .prepare(
          'INSERT INTO user_settings VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET value=excluded.value',
        )
        .run(userId, JSON.stringify(settings));
    return settings;
  }
}
