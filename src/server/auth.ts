import { createClerkClient } from '@clerk/backend';

/** Hono variables every ``/api`` handler past the session check can read. */
export type HearthEnv = { Variables: { userId: string } };

/** Who is signed in, as Clerk sees it. */
export interface Auth {
  /** The Clerk user id of the request's session, or null when there is none. */
  authenticate(request: Request): Promise<string | null>;
  /** The username Clerk holds for a user (a ``session.created`` webhook carries none). */
  username(userId: string): Promise<string | null>;
}

export interface ClerkConfig {
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
}

/** CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY and CLERK_WEBHOOK_SECRET: all three are required. */
export function clerkFromEnv(
  env: Record<string, string | undefined>,
): ClerkConfig {
  const read = (key: string) => {
    const value = env[key]?.trim();
    if (!value)
      throw new Error(`${key} is not set. Copy it from the Clerk dashboard.`);
    return value;
  };
  return {
    publishableKey: read('CLERK_PUBLISHABLE_KEY'),
    secretKey: read('CLERK_SECRET_KEY'),
    webhookSecret: read('CLERK_WEBHOOK_SECRET'),
  };
}

/**
 * The host of the Clerk Frontend API the browser loads Clerk from: the publishable key is
 * ``pk_<test|live>_`` + base64 of ``<host>$``.
 */
export function clerkFrontendApi(publishableKey: string) {
  const encoded = publishableKey.replace(/^pk_(test|live)_/, '');
  const host = Buffer.from(encoded, 'base64')
    .toString('utf8')
    .replace(/\$$/, '');
  if (!/^[a-z0-9.-]+$/i.test(host))
    throw new Error('CLERK_PUBLISHABLE_KEY is not a Clerk publishable key.');
  return host;
}

/**
 * Sessions checked by Clerk: the browser sends its session token as ``Authorization: Bearer`` (or
 * the ``__session`` cookie). ``authorizedParties`` are the app's origins, so a token minted for
 * another site is refused.
 */
export function clerkAuth(
  config: ClerkConfig,
  authorizedParties?: string[],
): Auth {
  const clerk = createClerkClient({
    secretKey: config.secretKey,
    publishableKey: config.publishableKey,
  });
  return {
    async authenticate(request) {
      const state = await clerk.authenticateRequest(request, {
        ...(authorizedParties ? { authorizedParties } : {}),
      });
      return state.isAuthenticated ? state.toAuth().userId : null;
    },
    async username(userId) {
      return (await clerk.users.getUser(userId)).username;
    },
  };
}
