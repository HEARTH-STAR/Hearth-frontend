import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/store.js';

const dirs: string[] = [];
afterEach(() =>
  dirs
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);
function databasePath() {
  const dir = mkdtempSync(join(tmpdir(), 'hearth-store-'));
  dirs.push(dir);
  return join(dir, 'test.sqlite');
}
it('persists settings across connections', () => {
  const path = databasePath();
  const store = new Store(path);
  store.updateSettings({ name: 'Sam', paused: true });
  store.close();
  const reopened = new Store(path);
  expect(reopened.settings()).toEqual({ name: 'Sam', paused: true });
  reopened.close();
});
it('drops settings an older version saved instead of returning them', () => {
  const path = databasePath();
  const legacy = new DatabaseSync(path);
  legacy.exec(
    'CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)',
  );
  legacy.prepare('INSERT INTO settings VALUES (1, ?)').run(
    JSON.stringify({
      name: 'Dot',
      paused: false,
      researchAllowed: true,
      memoryAllowed: false,
    }),
  );
  legacy.close();
  const store = new Store(path);
  expect(store.settings()).toEqual({ name: 'Dot', paused: false });
  store.close();
});
