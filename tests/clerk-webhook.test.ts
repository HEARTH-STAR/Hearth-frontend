import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Webhook } from 'svix';
import { afterEach, describe, expect, it } from 'vitest';
import { dots, signIns, users } from '../src/server/db/schema.js';
import { as, fixture as base, WEBHOOK_SECRET, type Route } from './helpers.js';

const open: { close(): void }[] = [];
afterEach(() => open.splice(0).forEach((item) => item.close()));
function fixture(options: Parameters<typeof base>[0] = {}) {
  const value = base(options);
  open.push(value);
  return value;
}
/** A Clerk event as Svix delivers it: signed with ``secret`` at ``at``. */
function delivery(
  event: unknown,
  { secret = WEBHOOK_SECRET, at = new Date(), id = `msg_${randomUUID()}` } = {},
) {
  const payload = JSON.stringify(event);
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'svix-id': id,
      'svix-timestamp': String(Math.floor(at.getTime() / 1000)),
      'svix-signature': new Webhook(secret).sign(id, at, payload),
    },
    body: payload,
  };
}
const post = (app: ReturnType<typeof fixture>['app'], init: RequestInit) =>
  // Clerk's servers have no session: the webhook answers without one.
  app.request('/api/webhooks/clerk', as('', init));
const newUser = () => `user_${randomUUID().slice(0, 12)}`;
const userEvent = (
  type: 'user.created' | 'user.updated',
  id: string,
  username: string | null,
) => ({ type, object: 'event', data: { id, username } });
const sessionEvent = (id: string, userId: string, createdAt: number) => ({
  type: 'session.created',
  object: 'event',
  data: { id, user_id: userId, created_at: createdAt },
});

describe('Clerk webhook signature', () => {
  it('changes nothing unless Svix signed exactly this payload, recently, with our secret', async () => {
    const { app, db } = fixture();
    const id = newUser();
    const event = userEvent('user.created', id, 'mallory');
    const signed = delivery(event);
    const refused: RequestInit[] = [
      // unsigned
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      },
      // signed with another endpoint's secret
      delivery(event, {
        secret: `whsec_${Buffer.from('another secret, 24 bytes!').toString('base64')}`,
      }),
      // the signature of one payload over another
      { ...signed, body: JSON.stringify(userEvent('user.created', id, 'eve')) },
      // a captured delivery replayed an hour later
      delivery(event, { at: new Date(Date.now() - 3_600_000) }),
    ];
    for (const init of refused) {
      const response = await post(app, init);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'The webhook signature did not verify.',
      });
    }
    expect(await db.select().from(users).where(eq(users.userId, id))).toEqual(
      [],
    );
    expect((await post(app, signed)).status).toBe(200);
    expect(await db.select().from(users).where(eq(users.userId, id))).toEqual([
      { userId: id, username: 'mallory' },
    ]);
  });
});

describe('Clerk webhook events', () => {
  it('adds a user once and follows their username changes', async () => {
    const { app, db } = fixture();
    const id = newUser();
    const created = delivery(userEvent('user.created', id, 'ada'));
    expect((await post(app, created)).status).toBe(200);
    // Svix redelivers the same message: nothing changes
    expect((await post(app, created)).status).toBe(200);
    // and so does the same event sent again as a new message
    expect(
      (await post(app, delivery(userEvent('user.created', id, 'ada')))).status,
    ).toBe(200);
    expect(await db.select().from(users).where(eq(users.userId, id))).toEqual([
      { userId: id, username: 'ada' },
    ]);
    await post(app, delivery(userEvent('user.updated', id, 'ada-l')));
    expect(await db.select().from(users).where(eq(users.userId, id))).toEqual([
      { userId: id, username: 'ada-l' },
    ]);
    // an update that arrives before its user.created adds the user
    const late = newUser();
    await post(app, delivery(userEvent('user.updated', late, 'grace')));
    expect(await db.select().from(users).where(eq(users.userId, late))).toEqual(
      [{ userId: late, username: 'grace' }],
    );
    // a user Clerk holds without a username is listed under their id
    const nameless = newUser();
    await post(app, delivery(userEvent('user.created', nameless, null)));
    expect(
      await db.select().from(users).where(eq(users.userId, nameless)),
    ).toEqual([{ userId: nameless, username: nameless }]);
  });
  it('records each sign-in once, adding a user it has not heard of first', async () => {
    const asked: string[] = [];
    const { app, db } = fixture({
      username: async (userId) => {
        asked.push(userId);
        return 'linus';
      },
    });
    const id = newUser();
    const session = `sess_${randomUUID()}`;
    const at = Date.UTC(2026, 9, 29, 8, 30);
    const signedIn = delivery(sessionEvent(session, id, at));
    // session.created can come before user.created: Clerk is asked for the username
    expect((await post(app, signedIn)).status).toBe(200);
    expect(asked).toEqual([id]);
    expect(await db.select().from(users).where(eq(users.userId, id))).toEqual([
      { userId: id, username: 'linus' },
    ]);
    // the session id is the key: a redelivery (even as a new message) adds no row
    expect((await post(app, signedIn)).status).toBe(200);
    await post(app, delivery(sessionEvent(session, id, at)));
    const second = `sess_${randomUUID()}`;
    await post(app, delivery(sessionEvent(second, id, at + 60_000)));
    expect(
      await db
        .select()
        .from(signIns)
        .where(eq(signIns.userId, id))
        .orderBy(signIns.signedInAt),
    ).toEqual([
      { signInId: session, userId: id, signedInAt: new Date(at) },
      { signInId: second, userId: id, signedInAt: new Date(at + 60_000) },
    ]);
    // the user was known by then: Clerk was asked once
    expect(asked).toEqual([id]);
    // and user.created arriving last keeps the user (and their sign-ins)
    await post(app, delivery(userEvent('user.created', id, 'linus')));
    expect(
      await db.select().from(signIns).where(eq(signIns.userId, id)),
    ).toHaveLength(2);
  });
  it('ignores events Hearth does not keep', async () => {
    const { app } = fixture();
    const response = await post(
      app,
      delivery({ type: 'email.created', object: 'event', data: {} }),
    );
    expect(response.status).toBe(200);
  });
});

describe('user.deleted', () => {
  /** Hearth-backend's DELETE: each name removed once, 404 for one Docker does not have. */
  function backend(fail = false) {
    const removed: string[] = [];
    const routes: Record<string, Route> = {
      'POST /api/containers': async (request) => {
        const { name } = (await request.json()) as { name: string };
        return Response.json({
          id: 'e'.repeat(64),
          short_id: 'e'.repeat(12),
          name: `hearth-container-${name}`,
          template: 'space',
          image: 'hearth/container:space',
          status: 'running',
          ports: { '5010': 50010 },
        });
      },
      'DELETE /api/containers/*': (_request, url) => {
        if (fail)
          return Response.json(
            { detail: 'cannot reach the Docker daemon' },
            { status: 503 },
          );
        const name = decodeURIComponent(url.pathname.split('/')[3]);
        if (removed.includes(name))
          return Response.json({ detail: 'no container' }, { status: 404 });
        removed.push(name);
        return new Response(null, { status: 204 });
      },
    };
    return { removed, routes };
  }
  it('removes the user’s containers through Hearth-backend, then their Dots and the user', async () => {
    const docker = backend();
    const { app, db, platform, workspace, accounts } = fixture({
      backend: docker.routes,
    });
    const id = newUser();
    await post(app, delivery(userEvent('user.created', id, 'kathleen')));
    await post(
      app,
      delivery(sessionEvent(`sess_${randomUUID()}`, id, Date.now())),
    );
    const made: string[] = [];
    for (const name of ['Ink', 'Ledger']) {
      const dot = await (
        await app.request(
          '/api/dots',
          as(id, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          }),
        )
      ).json();
      made.push(dot.id);
      await platform.spaces.settled(dot.id);
    }
    const bystander = (await accounts.dots('user_owner')).length;

    expect(
      (
        await post(
          app,
          delivery({
            type: 'user.deleted',
            object: 'event',
            data: { id, deleted: true },
          }),
        )
      ).status,
    ).toBe(200);
    expect([...docker.removed].sort()).toEqual(
      made.map((dot) => `hearth-container-${dot}`).sort(),
    );
    expect(await db.select().from(dots).where(eq(dots.userId, id))).toEqual([]);
    expect(await db.select().from(users).where(eq(users.userId, id))).toEqual(
      [],
    );
    expect(
      await db.select().from(signIns).where(eq(signIns.userId, id)),
    ).toEqual([]);
    // what Hearth kept for those Dots goes too; other users keep theirs
    for (const dot of made) {
      expect(workspace.dot(dot)).toBeUndefined();
      expect(workspace.space(dot)).toBeUndefined();
    }
    expect(await accounts.dots('user_owner')).toHaveLength(bystander);
    // a redelivery finds nothing left to do
    expect(
      (
        await post(
          app,
          delivery({
            type: 'user.deleted',
            object: 'event',
            data: { id, deleted: true },
          }),
        )
      ).status,
    ).toBe(200);
  });
  it('keeps the user while a container cannot be removed, so Clerk delivers again', async () => {
    const docker = backend(true);
    const { app, db, accounts } = fixture({ backend: docker.routes });
    const id = newUser();
    await post(app, delivery(userEvent('user.created', id, 'barbara')));
    const dot = await (
      await app.request(
        '/api/dots',
        as(id, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Keep' }),
        }),
      )
    ).json();
    const errors = console.error;
    console.error = () => {};
    try {
      expect(
        (
          await post(
            app,
            delivery({
              type: 'user.deleted',
              object: 'event',
              data: { id, deleted: true },
            }),
          )
        ).status,
      ).toBe(500);
    } finally {
      console.error = errors;
    }
    expect(await accounts.owns(id, dot.id)).toBe(true);
    expect(
      await db.select().from(users).where(eq(users.userId, id)),
    ).toHaveLength(1);
  });
});
