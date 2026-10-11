import {
  computerPermissionsSchema,
  filePath,
  type ComputerStatus,
} from '../shared/computer-types.js';
import type { SpaceService } from './space-service.js';
import type { WorkspaceStore } from './workspace.js';
/**
 * A Dot's computer: its folder in its home Space's container (where that Space's Hearth-Core runs
 * Claude Code and the Files tab reads), the permissions the owner grants it, and the record of
 * what it ran.
 */
export class ComputerService {
  constructor(
    private workspace: WorkspaceStore,
    private spaces: SpaceService,
  ) {}
  private dot(id: string) {
    const dot = this.workspace.dot(id);
    if (!dot) throw new Error('Dot not found.');
    return dot;
  }
  async status(dotId: string): Promise<ComputerStatus> {
    const dot = this.dot(dotId);
    const space = this.spaces.space(dot.spaceId);
    const [probe, blocker] = await Promise.all([
      this.spaces.probe(space.id),
      this.spaces.blocker(space.id),
    ]);
    return {
      state: probe.stage === 'ready' ? 'running' : 'unavailable',
      directory: dot.directory,
      permissions: this.workspace.computers.permissions(dot.id),
      space: {
        id: space.id,
        name: space.name,
        stage: probe.stage,
        container: space.container,
      },
      activity: this.workspace.computers.activity(dot.id),
      ...(blocker ? { error: blocker } : {}),
    };
  }
  permissions(dotId: string, patch: unknown) {
    const dot = this.dot(dotId);
    return this.workspace.computers.patchPermissions(
      dot.id,
      computerPermissionsSchema.partial().strict().parse(patch),
    );
  }
  async files(dotId: string, signal?: AbortSignal) {
    const dot = this.dot(dotId);
    return (await this.spaces.core(dot.spaceId)).files(dot.directory, signal);
  }
  async file(dotId: string, path: unknown, signal?: AbortSignal) {
    const dot = this.dot(dotId);
    const relative = filePath.parse(path);
    return (await this.spaces.core(dot.spaceId)).file(
      `${dot.directory}/${relative}`,
      signal,
    );
  }
}
