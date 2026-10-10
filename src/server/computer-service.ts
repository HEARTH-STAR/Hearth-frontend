import {
  computerPermissionsSchema,
  filePath,
  type ComputerStatus,
  type ContainerRecord,
} from '../shared/computer-types.js';
import type { HearthConfig } from './config.js';
import { HearthBackendError, type HearthBackend } from './hearth-backend.js';
import type { HearthCore } from './hearth-core.js';
import type { ServiceMonitor } from './service-status.js';
import { slug, type WorkspaceStore } from './workspace.js';
/**
 * A Dot's computer: its folder in the Hearth-Core workspace (where Claude Code works and the
 * Files tab reads), the permissions the owner grants it, the record of what it ran, and an
 * optional container spun up through Hearth-backend.
 */
export class ComputerService {
  constructor(
    private workspace: WorkspaceStore,
    private core: HearthCore,
    private backend: HearthBackend,
    private monitor: ServiceMonitor,
    private config: Pick<HearthConfig, 'containerTemplate'>,
  ) {}
  private dot(id: string) {
    const dot = this.workspace.dot(id);
    if (!dot) throw new Error('Dot not found.');
    return dot;
  }
  async status(dotId: string): Promise<ComputerStatus> {
    const dot = this.dot(dotId);
    const setup = await this.monitor.status();
    return {
      state: setup.core.reachable ? 'running' : 'unavailable',
      directory: dot.directory,
      permissions: this.workspace.computers.permissions(dot.id),
      container: this.workspace.computers.container(dot.id),
      activity: this.workspace.computers.activity(dot.id),
      ...(setup.core.reachable ? {} : { error: setup.core.error }),
    };
  }
  permissions(dotId: string, patch: unknown) {
    const dot = this.dot(dotId);
    return this.workspace.computers.patchPermissions(
      dot.id,
      computerPermissionsSchema.partial().strict().parse(patch),
    );
  }
  /** The Docker container name Hearth-backend prefixes with its own ``name_prefix``. */
  containerName(dotId: string) {
    const dot = this.dot(dotId);
    return `${slug(dot.name)}-${dot.id.slice(0, 8)}`;
  }
  async spinUp(dotId: string): Promise<ContainerRecord> {
    const dot = this.dot(dotId);
    const name = this.containerName(dot.id);
    try {
      const container = await this.backend.spinUp(
        name,
        this.config.containerTemplate,
      );
      return this.workspace.computers.saveContainer(dot.id, {
        name: container.name,
        shortId: container.short_id,
        template: container.template,
        image: container.image,
        status: container.status,
        createdAt: Date.now(),
      });
    } catch (error) {
      // The container exists from an earlier spin-up (perhaps from another install): record it.
      if (error instanceof HearthBackendError && error.status === 409)
        return this.workspace.computers.saveContainer(dot.id, {
          ...(this.workspace.computers.container(dot.id) ?? {
            name,
            shortId: null,
            template: this.config.containerTemplate ?? null,
            image: null,
            createdAt: Date.now(),
          }),
          status: 'exists',
        });
      throw error;
    }
  }
  async files(dotId: string, signal?: AbortSignal) {
    return this.core.files(this.dot(dotId).directory, signal);
  }
  async file(dotId: string, path: unknown, signal?: AbortSignal) {
    const dot = this.dot(dotId);
    return this.core.file(`${dot.directory}/${filePath.parse(path)}`, signal);
  }
}
