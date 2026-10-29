export interface HearthConfig {
  /** Hearth-backend: spins up each Space's container from a template. */
  backendUrl: string;
  /** Sent as a Bearer token when Hearth-backend has HEARTH_API_TOKEN set. */
  backendToken?: string;
  /** Template for Space containers: one that runs Hearth-Core on port 5010. */
  containerTemplate: string;
  /** Where this server reaches the ports Space containers publish (Docker binds them to loopback). */
  spaceHost: string;
  /** Model for conversations; Hearth-Core's manifest default when unset. */
  model?: string;
}
const trimmed = (value: string | undefined) => value?.trim() || undefined;
export function configFromEnv(
  env: Record<string, string | undefined>,
): HearthConfig {
  return {
    backendUrl: (
      trimmed(env.HEARTH_BACKEND_URL) ?? 'http://127.0.0.1:5020'
    ).replace(/\/+$/, ''),
    backendToken: trimmed(env.HEARTH_BACKEND_TOKEN),
    containerTemplate: trimmed(env.HEARTH_CONTAINER_TEMPLATE) ?? 'space',
    spaceHost: trimmed(env.HEARTH_SPACE_HOST) ?? '127.0.0.1',
    model: trimmed(env.HEARTH_MODEL),
  };
}
