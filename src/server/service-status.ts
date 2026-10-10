import type { ServiceStatus, SetupStatus } from '../shared/types.js';
import type { HearthBackend } from './hearth-backend.js';
import type { HearthCore } from './hearth-core.js';
const FRESH_MS = 5000;
const PROBE_TIMEOUT_MS = 2500;
/**
 * Whether Hearth-Core and Hearth-backend answer. The app polls its state every few seconds, so
 * results are reused for a short while instead of probing both services on every request.
 */
export class ServiceMonitor {
  private cached?: { at: number; value: Promise<SetupStatus> };
  constructor(
    private core: HearthCore,
    private backend: HearthBackend,
  ) {}
  status(force = false): Promise<SetupStatus> {
    if (!force && this.cached && Date.now() - this.cached.at < FRESH_MS)
      return this.cached.value;
    const value = this.probe();
    this.cached = { at: Date.now(), value };
    return value;
  }
  private async probe(): Promise<SetupStatus> {
    const [core, backend] = await Promise.all([
      this.check(this.core.url, async (signal) => {
        const health = await this.core.health(signal);
        return health.agent ? `agent ${health.agent}` : undefined;
      }),
      this.check(this.backend.url, async (signal) => {
        const docker = await this.backend.docker(signal);
        return docker.reachable
          ? `Docker ${docker.version ?? ''}`.trim()
          : `Docker not reachable${docker.error ? `: ${docker.error}` : ''}`;
      }),
    ]);
    return {
      core,
      backend,
      missing: core.reachable ? [] : [`Hearth-Core at ${core.url}`],
    };
  }
  private async check(
    url: string,
    probe: (signal: AbortSignal) => Promise<string | undefined>,
  ): Promise<ServiceStatus> {
    try {
      const detail = await probe(AbortSignal.timeout(PROBE_TIMEOUT_MS));
      return { url, reachable: true, ...(detail ? { detail } : {}) };
    } catch (error) {
      return {
        url,
        reachable: false,
        error:
          error instanceof Error && error.name !== 'TimeoutError'
            ? error.message
            : `No answer from ${url}.`,
      };
    }
  }
}
