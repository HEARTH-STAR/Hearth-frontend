import type { WebhookEvent } from '@clerk/backend';
import { Hono } from 'hono';
import { Webhook } from 'svix';
import type { AccountStore } from './db/accounts.js';

export interface ClerkWebhookOptions {
  /** CLERK_WEBHOOK_SECRET (``whsec_…``), from the endpoint's page in the Clerk dashboard. */
  secret: string;
  accounts: AccountStore;
  /** The username Clerk holds for a user. */
  username: (userId: string) => Promise<string | null>;
  /** Removes each of the user's Dots: its container (through Hearth-backend) and what is kept for it. */
  removeDots: (userId: string) => Promise<void>;
}

/**
 * ``POST /api/webhooks/clerk``: Clerk's events, signed by Svix. A request whose signature does not
 * verify (or is older than five minutes) changes nothing. Every event can arrive twice or out of
 * order, so each handler is idempotent:
 *
 *   user.created, user.updated  add the user or set their username
 *   session.created             add the sign-in once (keyed by session id), adding the user first
 *   user.deleted                remove their containers, then their Dot rows and the user
 *
 * A failure answers 500, and Clerk delivers the event again later.
 */
export function clerkWebhook(options: ClerkWebhookOptions) {
  const app = new Hono();
  const verifier = new Webhook(options.secret);
  const { accounts } = options;
  // Hearth asks for a username at sign-up; a user Clerk made without one (the dashboard, an
  // import) is listed under their user id, which is unique too.
  const nameOf = (userId: string, username: string | null) =>
    username || userId;
  app.post('/webhooks/clerk', async (c) => {
    const payload = await c.req.text();
    let event: WebhookEvent;
    try {
      // Throws unless the signature covers this exact payload; only then is it read.
      verifier.verify(payload, {
        'svix-id': c.req.header('svix-id') ?? '',
        'svix-timestamp': c.req.header('svix-timestamp') ?? '',
        'svix-signature': c.req.header('svix-signature') ?? '',
      });
      event = JSON.parse(payload) as WebhookEvent;
    } catch {
      return c.json({ error: 'The webhook signature did not verify.' }, 400);
    }
    switch (event.type) {
      case 'user.created':
      case 'user.updated':
        await accounts.saveUser(
          event.data.id,
          nameOf(event.data.id, event.data.username),
        );
        break;
      case 'session.created': {
        const userId = event.data.user_id;
        await accounts.ensureUser(userId, options.username);
        await accounts.recordSignIn(
          event.data.id,
          userId,
          new Date(event.data.created_at),
        );
        break;
      }
      case 'user.deleted':
        if (event.data.id) {
          await options.removeDots(event.data.id);
          await accounts.deleteUser(event.data.id);
        }
        break;
    }
    return c.json({ ok: true });
  });
  app.onError((error, c) => {
    console.error('Clerk webhook failed:', error.message);
    return c.json({ error: 'The webhook could not be handled.' }, 500);
  });
  return app;
}
