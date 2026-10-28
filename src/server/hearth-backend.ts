// Hearth-backend's HTTP API: Docker status, and the containers Spaces run in.
export interface BackendContainer {
  id: string;
  short_id: string;
  name: string;
  template: string;
  image: string;
  /** Docker's status: running, exited, created, … */
  status: string;
  /** Container port → the 127.0.0.1 port Docker published it on, e.g. ``{"5010": 49153}``. */
  ports?: Record<string, number>;
}
export class HearthBackendError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
type Fetch = typeof fetch;
export class HearthBackend {
  constructor(
    readonly url: string,
    private token?: string,
    private fetchImpl: Fetch = fetch,
  ) {}
  private async request(path: string, init: RequestInit = {}) {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.url}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
      });
    } catch {
      throw new HearthBackendError(
        `Hearth-backend is not reachable at ${this.url}. Start it, or set HEARTH_BACKEND_URL.`,
      );
    }
    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const detail =
        body && typeof body === 'object' && 'detail' in body
          ? body.detail
          : undefined;
      throw new HearthBackendError(
        typeof detail === 'string'
          ? detail
          : `Hearth-backend returned HTTP ${response.status}.`,
        response.status,
      );
    }
    return body;
  }
  async docker(
    signal?: AbortSignal,
  ): Promise<{ reachable: boolean; version?: string; error?: string }> {
    return (await this.request('/api/status/docker', { signal })) as {
      reachable: boolean;
      version?: string;
      error?: string;
    };
  }
  /**
   * Builds or pulls the template's image on first use, so this can take minutes. ``agent`` is set in the
   * container (the ``space`` template offers Hearth-Core's agents); Hearth-backend refuses one it does not offer.
   */
  async spinUp(
    name: string,
    template?: string,
    agent?: string,
  ): Promise<BackendContainer> {
    return (await this.request('/api/containers', {
      method: 'POST',
      body: JSON.stringify({
        name,
        ...(template ? { template } : {}),
        ...(agent ? { agent } : {}),
      }),
    })) as BackendContainer;
  }
  /** One Hearth container with its published ports; 404 when Docker has no such container. */
  async container(
    name: string,
    signal?: AbortSignal,
  ): Promise<BackendContainer> {
    return (await this.request(`/api/containers/${encodeURIComponent(name)}`, {
      signal,
    })) as BackendContainer;
  }
  /** Starts a stopped container; Docker may publish it on new host ports. */
  async start(name: string): Promise<BackendContainer> {
    return (await this.request(
      `/api/containers/${encodeURIComponent(name)}/start`,
      { method: 'POST', body: '{}' },
    )) as BackendContainer;
  }
}
