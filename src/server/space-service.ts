import { AGENTS, DEFAULT_AGENT, type AgentId } from '../shared/agents.js';
import type {
  AgentStatus,
  Space,
  SpaceSetup,
  SpaceStage,
  StoredSpace,
} from '../shared/types.js';
import { agentStatus, githubStatus } from './connections.js';
import type { HearthConfig } from './config.js';
import {
  HearthBackendError,
  type BackendContainer,
  type HearthBackend,
} from './hearth-backend.js';
import { HearthCore, HearthCoreError } from './hearth-core.js';
import type { WorkspaceStore } from './workspace.js';

/** The container port the ``space`` template runs Hearth-Core on. */
export const CORE_PORT = '5010';
const FRESH_MS = 4000;
const AGENT_FRESH_MS = 30_000;
const PROBE_TIMEOUT_MS = 2500;

interface Probe {
  stage: SpaceStage;
  /** Docker's status for the container. */
  status: string | null;
  /** Hearth-Core inside, as this server reaches it. */
  url: string | null;
  error?: string;
}
/** A request needs the Space's Hearth-Core, and the container is not there yet. */
export class SpaceNotReady extends Error {
  constructor(
    message: string,
    readonly stage: SpaceStage,
  ) {
    super(message);
  }
}
function notReady(space: StoredSpace, probe: Probe) {
  const name = `“${space.name}”`;
  switch (probe.stage) {
    case 'none':
      return `${name} has no container yet. Start it from its Setup page.`;
    case 'creating':
      return `${name}’s container is being created.`;
    case 'booting':
      return `Hearth-Core is still starting in ${name}’s container.`;
    case 'stopped':
      return `${name}’s container is stopped. Start it from its Setup page.`;
    case 'unknown':
      return probe.error ?? 'Hearth-backend did not answer.';
    default:
      return `${name}’s container is not running${probe.error ? `: ${probe.error}` : ''}.`;
  }
}
function friendly(error: unknown) {
  // Hearth-backend answers 503 when its Docker daemon does not.
  if (error instanceof HearthBackendError && error.status === 503)
    return new HearthBackendError(
      'Docker is not running. Start Docker Desktop, then try again.',
      503,
    );
  return error;
}
const missing = (error: unknown) =>
  error instanceof HearthBackendError && error.status === 404;

/**
 * Spaces as containers. Creating a Space spins up its container through Hearth-backend (template
 * ``space``: Hearth-Core on port 5010, published on loopback); everything a Space's Dots do (chat
 * turns, files, the agent's and GitHub's sign-in) goes to the Hearth-Core inside it. The agent is
 * the Dot's choice (Claude Code, Cursor or Antigravity), set in the container as it is spun up.
 */
export class SpaceService {
  private starting = new Map<string, Promise<void>>();
  private failures = new Map<string, string>();
  private probes = new Map<string, { at: number; value: Promise<Probe> }>();
  private agents = new Map<
    string,
    { at: number; value: Promise<AgentStatus | null> }
  >();
  private clients = new Map<string, HearthCore>();
  constructor(
    private workspace: WorkspaceStore,
    private backend: HearthBackend,
    private config: Pick<HearthConfig, 'containerTemplate' | 'spaceHost'>,
    private coreAt: (url: string) => HearthCore = (url) => new HearthCore(url),
  ) {}
  space(id: string) {
    const space = this.workspace.space(id);
    if (!space) throw new Error('Space not found.');
    return space;
  }
  /** The name Hearth-backend gets; it adds its prefix, so the container is ``hearth-container-<dot_id>``. */
  containerName(space: StoredSpace) {
    return space.id;
  }
  /** A new Space running ``agent``, its container already on the way. ``id`` is its Dot's id. */
  create(
    name: string,
    description: string,
    agent: AgentId = DEFAULT_AGENT,
    id?: string,
  ) {
    const space = this.workspace.createSpace(name, description, agent, id);
    this.start(space.id);
    return space;
  }
  /**
   * Removes the Space's container through Hearth-backend, after a spin-up in flight has ended (or
   * it would come back). A container Docker no longer has counts as removed.
   */
  async remove(spaceId: string) {
    await this.settled(spaceId);
    const space = this.workspace.space(spaceId);
    if (!space) return;
    try {
      await this.backend.remove(space.container ?? this.containerName(space));
    } catch (error) {
      if (!missing(error)) throw friendly(error);
    }
    this.failures.delete(spaceId);
    this.forget(spaceId);
  }
  /**
   * Spins up the Space's container, starts it again when it was stopped, or replaces it when
   * Docker lost it. Returns at once: a first spin-up builds the image and takes minutes, and the
   * Space shows ``creating`` meanwhile.
   */
  start(spaceId: string) {
    const space = this.space(spaceId);
    if (this.starting.has(space.id)) return;
    this.failures.delete(space.id);
    const run = this.bringUp(space)
      .catch((error: unknown) => {
        const reason = friendly(error);
        this.failures.set(
          space.id,
          reason instanceof Error
            ? reason.message
            : 'The container did not start.',
        );
      })
      .finally(() => {
        this.starting.delete(space.id);
        this.forget(space.id);
      });
    this.starting.set(space.id, run);
    this.forget(space.id);
  }
  /** Resolves once a start in flight has ended. */
  settled(spaceId: string) {
    return this.starting.get(spaceId) ?? Promise.resolve();
  }
  private async bringUp(space: StoredSpace) {
    if (space.container) {
      try {
        const existing = await this.backend.container(space.container);
        if (existing.status !== 'running')
          await this.backend.start(existing.name);
        return;
      } catch (error) {
        if (!missing(error)) throw error;
        // Docker no longer has it: spin up a new one under the same name.
      }
    }
    const name = space.container ?? this.containerName(space);
    // Recorded first: if the answer is lost (a first build can outlast the request), the probe
    // still finds the container once Hearth-backend finishes.
    this.workspace.setSpaceContainer(space.id, name);
    try {
      const container = await this.backend.spinUp(
        name,
        this.config.containerTemplate,
        // Claude Code is Hearth-Core's own default: a Claude Space sends no agent, so it also
        // spins up on a Hearth-backend that predates the choice.
        space.agent === DEFAULT_AGENT ? undefined : space.agent,
      );
      this.workspace.setSpaceContainer(space.id, container.name);
    } catch (error) {
      if (!(error instanceof HearthBackendError && error.status === 409))
        throw error;
      // It exists from an earlier spin-up: use it.
      const existing = await this.backend.container(name);
      this.workspace.setSpaceContainer(space.id, existing.name);
      if (existing.status !== 'running')
        await this.backend.start(existing.name);
    }
  }
  private forget(spaceId: string) {
    this.probes.delete(spaceId);
    this.agents.delete(spaceId);
  }
  private client(url: string) {
    let client = this.clients.get(url);
    if (!client) {
      client = this.coreAt(url);
      this.clients.set(url, client);
    }
    return client;
  }
  /** Where the Space's container is. Cached briefly: the app polls every few seconds. */
  probe(spaceId: string, force = false): Promise<Probe> {
    const space = this.space(spaceId);
    const cached = this.probes.get(space.id);
    if (!force && cached && Date.now() - cached.at < FRESH_MS)
      return cached.value;
    const value = this.look(space);
    this.probes.set(space.id, { at: Date.now(), value });
    return value;
  }
  private async look(space: StoredSpace): Promise<Probe> {
    const none = { status: null, url: null };
    if (this.starting.has(space.id)) return { stage: 'creating', ...none };
    const failure = this.failures.get(space.id);
    if (!space.container)
      return failure
        ? { stage: 'failed', ...none, error: failure }
        : { stage: 'none', ...none };
    let container: BackendContainer;
    try {
      container = await this.backend.container(
        space.container,
        AbortSignal.timeout(PROBE_TIMEOUT_MS),
      );
    } catch (error) {
      if (missing(error))
        return {
          stage: failure ? 'failed' : 'missing',
          ...none,
          error: failure ?? 'Docker has no container for this Space.',
        };
      return {
        stage: 'unknown',
        ...none,
        error:
          error instanceof HearthBackendError
            ? error.message
            : 'Hearth-backend did not answer.',
      };
    }
    const status = container.status;
    if (status !== 'running') return { stage: 'stopped', status, url: null };
    const port = container.ports?.[CORE_PORT];
    if (!port)
      return {
        stage: 'failed',
        status,
        url: null,
        error: `The container does not publish Hearth-Core’s port ${CORE_PORT}; spaces need the “space” template.`,
      };
    // On Azure the container's private IP, which can change when it restarts; HEARTH_SPACE_HOST otherwise.
    const url = `http://${container.host || this.config.spaceHost}:${port}`;
    try {
      await this.client(url).health(AbortSignal.timeout(PROBE_TIMEOUT_MS));
      return { stage: 'ready', status, url };
    } catch {
      return { stage: 'booting', status, url };
    }
  }
  /** The Space's Hearth-Core, or SpaceNotReady saying what is missing. */
  async core(spaceId: string): Promise<HearthCore> {
    const space = this.space(spaceId);
    const probe = await this.probe(space.id);
    if (probe.stage !== 'ready' || !probe.url)
      throw new SpaceNotReady(notReady(space, probe), probe.stage);
    return this.client(probe.url);
  }
  /** Why the Space cannot run turns right now, or undefined when it can. */
  async blocker(spaceId: string) {
    const space = this.space(spaceId);
    const probe = await this.probe(space.id);
    return probe.stage === 'ready' ? undefined : notReady(space, probe);
  }
  /** The Space agent's sign-in inside the container; null while the container does not answer. */
  agentStatus(spaceId: string, force = false): Promise<AgentStatus | null> {
    const cached = this.agents.get(spaceId);
    if (!force && cached && Date.now() - cached.at < AGENT_FRESH_MS)
      return cached.value;
    const agent = this.space(spaceId).agent;
    const value = this.core(spaceId).then(
      async (core) => agentStatus(await core.agentStatus(agent)),
      () => null,
    );
    this.agents.set(spaceId, { at: Date.now(), value });
    return value;
  }
  /** Forget the cached sign-in after a login or logout. */
  agentChanged(spaceId: string) {
    this.agents.delete(spaceId);
  }
  /** The Spaces whose ids are in ``only`` (default: every Space), each with its container's stage. */
  async list(only?: ReadonlySet<string>): Promise<Space[]> {
    const spaces = this.workspace.spaces();
    return Promise.all(
      (only ? spaces.filter((space) => only.has(space.id)) : spaces).map(
        async (space) => {
          const { stage } = await this.probe(space.id);
          const agent =
            stage === 'ready' ? await this.agentStatus(space.id) : null;
          return { ...space, stage, signedIn: agent ? agent.connected : null };
        },
      ),
    );
  }
  async setup(spaceId: string): Promise<SpaceSetup> {
    const space = this.space(spaceId);
    const probe = await this.probe(space.id);
    const ready = probe.stage === 'ready' && probe.url;
    const client = ready ? this.client(probe.url!) : undefined;
    const agentName = AGENTS[space.agent].name;
    const [agent, github] = client
      ? await Promise.all([
          // Asked directly, so the setup can say why the sign-in is unavailable.
          client
            .agentStatus(space.agent)
            .then(agentStatus, (error: unknown) => ({
              connected: false,
              method: null,
              email: null,
              organization: null,
              subscription: null,
              loginSupported: false,
              error: `This Space’s Hearth-Core cannot report ${agentName}’s sign-in${
                error instanceof HearthCoreError && error.status === 404
                  ? `: it does not run ${agentName}. Update Hearth-Core, then start the container again`
                  : error instanceof Error
                    ? `: ${error.message}`
                    : ''
              }.`,
            })),
          client.githubStatus().then(githubStatus, () => null),
        ])
      : [null, null];
    if (agent)
      this.agents.set(space.id, {
        at: Date.now(),
        value: Promise.resolve(agent.error ? null : agent),
      });
    return {
      stage: probe.stage,
      container: space.container,
      status: probe.status,
      coreUrl: probe.url,
      ...(probe.error ? { error: probe.error } : {}),
      agent,
      github,
    };
  }
}
/** The HTTP answer for a Space or Hearth service failure, or undefined for anything else. */
export function spaceFailure(error: Error) {
  if (error.message === 'Space not found.')
    return { status: 404 as const, body: { error: error.message } };
  if (error instanceof SpaceNotReady)
    return {
      status: 409 as const,
      body: { error: error.message, stage: error.stage },
    };
  if (error instanceof HearthCoreError || error instanceof HearthBackendError)
    return {
      status:
        error.status === 400
          ? (400 as const)
          : error.status === 404
            ? (404 as const)
            : error.status === 503
              ? (503 as const)
              : (502 as const),
      body: { error: error.message },
    };
  return undefined;
}
