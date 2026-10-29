type TokenSource = () => Promise<string | null>;
let getToken: TokenSource = async () => null;
/**
 * Where requests get the signed-in user's Clerk session token (``useAuth().getToken``, which
 * renews it when it is about to expire). The chat runtime sends Clerk's session cookie instead.
 */
export function setTokenSource(source: TokenSource) {
  getToken = source;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    /** The JSON error body, for categorical fields such as `code`. */
    public body?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const token = await getToken();
  const response = await fetch(`/api${path}`, {
    method,
    signal,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(['GET', 'HEAD'].includes(method)
        ? {}
        : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await response
    .json()
    .catch(() => ({ error: 'Server returned an unreadable response.' }))) as {
    error?: string;
  } & Record<string, unknown>;
  if (!response.ok)
    throw new ApiError(
      data.error ?? `Request failed (${response.status}).`,
      response.status,
      data,
    );
  return data as T;
}
