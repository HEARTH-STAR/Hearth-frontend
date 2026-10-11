import {
  computerPermissionsSchema,
  filePath,
  type ComputerStatus,
} from '../shared/computer-types.js';
import { SpaceNotReady, type SpaceService } from './space-service.js';
import { TerminalTickets } from './terminal.js';
import type { WorkspaceStore } from './workspace.js';
/**
 * A Dot's computer: its container (each Dot is a Space). Claude Code works in the Dot's folder
 * there; the Files tab shows the container's whole workspace, and the Terminal tab is a shell in
 * the container. Plus the permissions the owner grants it and the record of what it ran.
 */
export class ComputerService {
  private terminals = new TerminalTickets();
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
  /** Every file in the container's workspace (``/workspace``), the Dot's folder among them. */
  async files(dotId: string, signal?: AbortSignal) {
    const dot = this.dot(dotId);
    return (await this.spaces.core(dot.spaceId)).files('', signal);
  }
  /** One file, by its path in the container's workspace. */
  async file(dotId: string, path: unknown, signal?: AbortSignal) {
    const dot = this.dot(dotId);
    const relative = filePath.parse(path);
    return (await this.spaces.core(dot.spaceId)).file(relative, signal);
  }
  /**
   * The Docker name of the container a terminal opens in. It only needs the container running,
   * not Hearth-Core inside it, so the terminal also works while Hearth-Core is still starting.
   */
  async terminalContainer(dotId: string) {
    const dot = this.dot(dotId);
    const space = this.spaces.space(dot.spaceId);
    const probe = await this.spaces.probe(space.id);
    if (
      space.container &&
      (probe.stage === 'ready' || probe.stage === 'booting')
    )
      return space.container;
    throw new SpaceNotReady(
      (await this.spaces.blocker(space.id)) ??
        `${dot.name}’s container is not running.`,
      probe.stage,
    );
  }
  /** A one-use ticket for the terminal's WebSocket, once the container is running. */
  async terminalTicket(dotId: string) {
    await this.terminalContainer(dotId);
    return this.terminals.issue(dotId);
  }
  redeemTerminal(ticket: string, dotId: string) {
    return this.terminals.redeem(ticket, dotId);
  }
}
