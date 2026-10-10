export interface HearthConfig {
  /** Hearth-Core: runs Claude Code for every conversation and serves the workspace files. */
  coreUrl: string;
  /** Hearth-backend: spins up containers from templates. */
  backendUrl: string;
  /** Sent as a Bearer token when Hearth-backend has HEARTH_API_TOKEN set. */
  backendToken?: string;
  /** Template for new containers; Hearth-backend's default when unset. */
  containerTemplate?: string;
  /** Model for conversations; Hearth-Core's manifest default when unset. */
  model?: string;
  ownerToken?: string;
}
const trimmed = (value: string | undefined) => value?.trim() || undefined;
export function configFromEnv(
  env: Record<string, string | undefined>,
): HearthConfig {
  return {
    coreUrl: (trimmed(env.HEARTH_CORE_URL) ?? 'http://127.0.0.1:5010').replace(
      /\/+$/,
      '',
    ),
    backendUrl: (
      trimmed(env.HEARTH_BACKEND_URL) ?? 'http://127.0.0.1:5020'
    ).replace(/\/+$/, ''),
    backendToken: trimmed(env.HEARTH_BACKEND_TOKEN),
    containerTemplate: trimmed(env.HEARTH_CONTAINER_TEMPLATE),
    model: trimmed(env.HEARTH_MODEL),
    ownerToken: trimmed(env.OWNER_TOKEN),
  };
}
