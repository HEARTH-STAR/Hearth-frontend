import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Who may sign in. Clerk keeps the passwords; Hearth keeps only the id and the username. */
export const users = pgTable('users', {
  /** Clerk user id. */
  userId: text('user_id').primaryKey(),
  username: text('username').notNull().unique(),
});

/** One row per Dot, which is one Space and one container: ``hearth-container-<dot_id>``. */
export const dots = pgTable(
  'dots',
  {
    dotId: text('dot_id').primaryKey(),
    dotName: text('dot_name').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.userId),
  },
  (table) => [index('dots_user_id_idx').on(table.userId)],
);

/** Each Clerk session, once: the session id is the key, so a redelivered webhook adds nothing. */
export const signIns = pgTable(
  'sign_ins',
  {
    /** Clerk session id. */
    signInId: text('sign_in_id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'cascade' }),
    signedInAt: timestamp('signed_in_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('sign_ins_user_id_signed_in_at_idx').on(
      table.userId,
      table.signedInAt,
    ),
  ],
);
