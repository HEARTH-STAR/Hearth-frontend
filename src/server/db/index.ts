import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema.js';

/** Users, their Dots and their sign-ins, in Postgres (PGlite in tests). */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/** drizzle/ in the directory the server runs from, like ./dist/client (src/server/index.ts). */
export const MIGRATIONS_FOLDER = resolve('drizzle');

/** Connects to ``DATABASE_URL`` and applies the migrations in drizzle/ before anything reads. */
export async function openDatabase(url: string) {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db: db as unknown as Database, close: () => client.end() };
}
