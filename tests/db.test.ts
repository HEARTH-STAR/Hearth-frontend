import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { beforeAll, expect, it } from 'vitest';
import { AccountStore } from '../src/server/db/accounts.js';
import { testDatabase } from './helpers.js';

const { db, ready } = testDatabase();
const accounts = new AccountStore(db);
beforeAll(() => ready);
const user = () => `user_${randomUUID().slice(0, 12)}`;
const rows = async <T>(query: ReturnType<typeof sql>) =>
  ((await db.execute(query)) as unknown as { rows: T[] }).rows;

it('migrates to exactly the users, dots and sign_ins tables', async () => {
  const columns = await rows<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>(
    sql`SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
  );
  expect(
    columns.map(
      (c) =>
        `${c.table_name}.${c.column_name} ${c.data_type}${c.is_nullable === 'NO' ? ' not null' : ''}`,
    ),
  ).toEqual([
    'dots.dot_id text not null',
    'dots.dot_name text not null',
    'dots.user_id text not null',
    'sign_ins.sign_in_id text not null',
    'sign_ins.user_id text not null',
    'sign_ins.signed_in_at timestamp with time zone not null',
    'users.user_id text not null',
    'users.username text not null',
  ]);
  const indexes = await rows<{ indexname: string }>(
    sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`,
  );
  expect(indexes.map((i) => i.indexname)).toEqual([
    'dots_pkey',
    'dots_user_id_idx',
    'sign_ins_pkey',
    'sign_ins_user_id_signed_in_at_idx',
    'users_pkey',
    'users_username_unique',
  ]);
});
it('keeps usernames unique and every Dot and sign-in tied to a user', async () => {
  const ada = user();
  await accounts.saveUser(ada, `ada-${ada}`);
  await expect(accounts.saveUser(user(), `ada-${ada}`)).rejects.toThrow();
  await expect(
    accounts.addDot(randomUUID(), 'Orphan', user()),
  ).rejects.toThrow();
  await expect(
    accounts.recordSignIn(`sess_${randomUUID()}`, user(), new Date()),
  ).rejects.toThrow();
});
it('deletes a user with their Dots and sign-ins, and no one else’s', async () => {
  const [gone, stays] = [user(), user()];
  for (const id of [gone, stays]) {
    await accounts.saveUser(id, `name-${id}`);
    await accounts.addDot(randomUUID(), 'Dot', id);
    await accounts.recordSignIn(`sess_${randomUUID()}`, id, new Date());
  }
  // a user who still owns Dots cannot be dropped on its own: the containers come first
  await expect(
    db.execute(sql`DELETE FROM users WHERE user_id = ${gone}`),
  ).rejects.toThrow();
  await accounts.deleteUser(gone);
  expect(await accounts.hasUser(gone)).toBe(false);
  expect(await accounts.dots(gone)).toEqual([]);
  expect(
    await rows(sql`SELECT 1 FROM sign_ins WHERE user_id = ${gone}`),
  ).toEqual([]);
  expect(await accounts.dots(stays)).toHaveLength(1);
  expect(
    await rows(sql`SELECT 1 FROM sign_ins WHERE user_id = ${stays}`),
  ).toHaveLength(1);
});
