import type { ServiceStatus, SetupStatus } from '../shared/types.js';
import type { HearthBackend } from './hearth-backend.js';
const FRESH_MS = 5000;
const PROBE_TIMEOUT_MS = 2500;
/**
 * Whether Hearth-backend and its Docker answer: every Space's container comes from them. Each
 * Space's own Hearth-Core is probed by SpaceService. The app polls its state every few seconds, so
 * results are reused for a short while.
 */
export class ServiceMonitor {
  private cached?: { at: number; value: Promise<SetupStatus> };
  constructor(private backend: HearthBackend) {}
  status(force = false): Promise<SetupStatus> {
    if (!force && this.cached && Date.now() - this.cached.at < FRESH_MS)
      return this.cached.value;
    const value = this.probe();
    this.cached = { at: Date.now(), value };
    return value;
  }
  private async probe(): Promise<SetupStatus> {
    const backend = await this.check();
    return {
      backend,
      missing: !backend.reachable
        ? [`Hearth-backend at ${backend.url}`]
        : backend.docker === false
          ? ['Docker']
          : [],
    };
  }
  private async check(): Promise<ServiceStatus> {
    const url = this.backend.url;
    try {
      const docker = await this.backend.docker(
        AbortSignal.timeout(PROBE_TIMEOUT_MS),
      );
      return docker.reachable
        ? {
            url,
            reachable: true,
            detail: `Docker ${docker.version ?? ''}`.trim(),
            docker: true,
          }
        : {
            url,
            reachable: true,
            detail: 'Docker is not running',
            docker: false,
          };
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
