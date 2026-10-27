import { expect, it } from 'vitest';
import {
  markWelcomed,
  WELCOME_URL,
  welcomeRedirect,
} from '../src/client/first-visit';

/** A tiny in-memory stand-in for localStorage. */
function memory() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}
const front = { pathname: '/', hash: '' };

it('sends a first visit to the front door to the landing page, once', () => {
  const storage = memory();
  expect(welcomeRedirect(front, storage)).toBe(WELCOME_URL);
  // The landing page remembers it was seen.
  markWelcomed(storage);
  expect(welcomeRedirect(front, storage)).toBeUndefined();
});

it('never redirects links into the app or other paths', () => {
  const storage = memory();
  expect(
    welcomeRedirect({ pathname: '/', hash: '#/spaces/s1/setup' }, storage),
  ).toBeUndefined();
  expect(
    welcomeRedirect({ pathname: '/welcome/', hash: '' }, storage),
  ).toBeUndefined();
});

it('opens the app when storage is blocked, so nothing can loop', () => {
  expect(welcomeRedirect(front, undefined)).toBeUndefined();
  const throwing = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  expect(welcomeRedirect(front, throwing)).toBeUndefined();
  expect(() => markWelcomed(throwing)).not.toThrow();
  expect(() => markWelcomed(undefined)).not.toThrow();
});
