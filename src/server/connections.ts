import type { AgentStatus, GitHubStatus } from '../shared/types.js';
import type { AgentConnection, GitHubConnection } from './hearth-core.js';
// Hearth-Core's connector answers, mapped to the shapes the app shows.

/** The GitHub connector (the gh CLI inside the container). */
export function githubStatus(raw: GitHubConnection): GitHubStatus {
  const connected = raw.status === 'connected';
  const warnings = [
    ...(Array.isArray(raw.warnings) ? raw.warnings : []),
    ...(raw.warning ? [raw.warning] : []),
  ].filter((value, index, all) => all.indexOf(value) === index);
  return {
    connected,
    username: connected ? raw.username || null : null,
    name: connected ? raw.name || null : null,
    method: !connected
      ? null
      : raw.auth_method === 'cli'
        ? 'device'
        : raw.auth_method === 'pat'
          ? 'token'
          : 'terminal',
    expiresAt: connected ? (raw.expires_at ?? null) : null,
    warnings,
    detail: raw.gh_status || null,
  };
}

/** The Space agent's sign-in (its Hearth-Core adapter). Never carries a credential. */
export function agentStatus(raw: AgentConnection): AgentStatus {
  const connected = raw.status === 'connected';
  return {
    connected,
    method: connected ? (raw.method ?? null) : null,
    email: connected ? (raw.email ?? null) : null,
    organization: connected ? (raw.organization ?? null) : null,
    subscription: connected ? (raw.subscription ?? null) : null,
    loginSupported: raw.login_supported !== false,
    ...(raw.status === 'unavailable' && raw.error ? { error: raw.error } : {}),
  };
}
