export function resolveAppOrigins(
  appOrigin: string | undefined,
  nodeEnv: string | undefined,
): string[] | undefined {
  if (appOrigin)
    return appOrigin
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  return nodeEnv === 'development'
    ? ['http://localhost:5173', 'http://127.0.0.1:5173']
    : undefined;
}
/**
 * Why a browser request to ``/api`` is refused (an unknown host, another origin, a cross-site
 * request), or undefined when it may go on. The owner token is checked separately. Plain requests
 * and the terminal's WebSocket upgrade both go through here.
 */
export function originProblem(
  request: {
    url: string;
    origin?: string | null;
    secFetchSite?: string | null;
  },
  origin: string | string[] | undefined,
  ownerToken: string | undefined,
) {
  const requestUrl = new URL(request.url);
  const origins = origin
    ? Array.isArray(origin)
      ? origin
      : [origin]
    : undefined;
  const originHostnames = origins
    ? origins
        .map((o) => {
          try {
            return new URL(o).hostname;
          } catch {
            return '';
          }
        })
        .filter(Boolean)
    : [];
  const allowedHosts = new Set([
    'localhost',
    '127.0.0.1',
    '[::1]',
    ...originHostnames,
  ]);
  if (!ownerToken && !allowedHosts.has(requestUrl.hostname))
    return 'Unrecognized host.';
  const allowedOrigins = new Set(origins ?? [requestUrl.origin]);
  if (request.origin && !allowedOrigins.has(request.origin))
    return 'Cross-origin requests are not allowed.';
  if (request.secFetchSite === 'cross-site')
    return 'Cross-site requests are not allowed.';
  return undefined;
}
