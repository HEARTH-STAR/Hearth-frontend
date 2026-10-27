// The landing page (/welcome/) shows once per browser: the first visit to the app's
// front door goes there, and seeing it is remembered so later visits open the app.
const KEY = 'hearth-welcomed';
export const WELCOME_URL = '/welcome/';

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;

/** This browser's localStorage, or undefined when it is blocked. */
export function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Where to send this visit instead of the app, if anywhere. Only the bare front
 * door redirects: links into the app (#/spaces/...) never do. Without working
 * storage it never redirects, so a visit can't bounce between the two pages.
 */
export function welcomeRedirect(
  place: Pick<Location, 'pathname' | 'hash'>,
  storage: Reader | undefined,
): string | undefined {
  if (place.pathname !== '/' || place.hash) return undefined;
  try {
    if (!storage || storage.getItem(KEY)) return undefined;
  } catch {
    return undefined;
  }
  return WELCOME_URL;
}

/** Remember that this browser has seen the landing page. */
export function markWelcomed(storage: Writer | undefined) {
  try {
    storage?.setItem(KEY, '1');
  } catch {
    // Blocked storage: welcomeRedirect cannot read it either, so it won't redirect.
  }
}
