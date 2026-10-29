import { and, eq } from 'drizzle-orm';
import type { Database } from './index.js';
import { dots, signIns, users } from './schema.js';

export type DotRow = typeof dots.$inferSelect;

/**
 * Users, the Dots each one owns, and their sign-ins. A Dot's id is also its Space's id and names its
 * container (``hearth-container-<dot_id>``), so "does this user own this Space" is one row lookup.
 */
export class AccountStore {
  constructor(private db: Database) {}
  /** Adds the user, or sets the username of one already known: Clerk's webhooks arrive in any order. */
  async saveUser(userId: string, username: string) {
    await this.db
      .insert(users)
      .values({ userId, username })
      .onConflictDoUpdate({ target: users.userId, set: { username } });
  }
  async hasUser(userId: string) {
    const [row] = await this.db
      .select({ userId: users.userId })
      .from(users)
      .where(eq(users.userId, userId));
    return !!row;
  }
  /**
   * Adds a signed-in user whose ``user.created`` webhook has not arrived yet. ``username`` asks Clerk;
   * a user without one (made in the dashboard, say) is listed under their user id, which is unique too.
   */
  async ensureUser(
    userId: string,
    username: (userId: string) => Promise<string | null>,
  ) {
    if (await this.hasUser(userId)) return;
    await this.db
      .insert(users)
      .values({ userId, username: (await username(userId)) || userId })
      .onConflictDoNothing({ target: users.userId });
  }
  /** Records a Clerk session once; ``false`` when it was already recorded (a redelivered webhook). */
  async recordSignIn(signInId: string, userId: string, signedInAt: Date) {
    const added = await this.db
      .insert(signIns)
      .values({ signInId, userId, signedInAt })
      .onConflictDoNothing({ target: signIns.signInId })
      .returning({ signInId: signIns.signInId });
    return added.length > 0;
  }
  async addDot(dotId: string, dotName: string, userId: string) {
    await this.db.insert(dots).values({ dotId, dotName, userId });
  }
  async renameDot(dotId: string, dotName: string) {
    await this.db.update(dots).set({ dotName }).where(eq(dots.dotId, dotId));
  }
  async removeDot(dotId: string) {
    await this.db.delete(dots).where(eq(dots.dotId, dotId));
  }
  dots(userId: string): Promise<DotRow[]> {
    return this.db.select().from(dots).where(eq(dots.userId, userId));
  }
  async ownedDotIds(userId: string) {
    const rows = await this.db
      .select({ dotId: dots.dotId })
      .from(dots)
      .where(eq(dots.userId, userId));
    return new Set(rows.map((row) => row.dotId));
  }
  async owns(userId: string, dotId: string) {
    const [row] = await this.db
      .select({ dotId: dots.dotId })
      .from(dots)
      .where(and(eq(dots.dotId, dotId), eq(dots.userId, userId)));
    return !!row;
  }
  async ownerOf(dotId: string) {
    const [row] = await this.db
      .select({ userId: dots.userId })
      .from(dots)
      .where(eq(dots.dotId, dotId));
    return row?.userId;
  }
  /** Deletes the user's Dot rows and the user (their sign-ins go with it). Remove the containers first. */
  async deleteUser(userId: string) {
    await this.db.transaction(async (tx) => {
      await tx.delete(dots).where(eq(dots.userId, userId));
      await tx.delete(users).where(eq(users.userId, userId));
    });
  }
}
