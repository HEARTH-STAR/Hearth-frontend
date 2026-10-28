import type { AgentId } from './agents.js';
export interface Settings {
  /** The owner's name, which Dots use for the workspace (set in Settings). */
  name: string;
  paused: boolean;
}
export interface State {
  settings: Settings;
}
/** A Space as stored. Each Space runs in its own container, where its Hearth-Core and its agent live. */
export interface StoredSpace {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  pageCount: number;
  /** The Space's container (its Docker name), once one was spun up. */
  container: string | null;
  /** The agent its container runs (Hearth-Core's ``AGENT_NAME``), chosen when its Dot was made. */
  agent: AgentId;
}
/**
 * Where a Space's container is: ``none`` before the first start, ``creating`` while Hearth-backend
 * spins it up, ``booting`` while Hearth-Core inside installs and starts, ``ready`` once it answers.
 * ``stopped``, ``missing`` and ``failed`` need a start; ``unknown`` means Hearth-backend did not answer.
 */
export type SpaceStage =
  | 'none'
  | 'creating'
  | 'booting'
  | 'ready'
  | 'stopped'
  | 'missing'
  | 'failed'
  | 'unknown';
export interface Space extends StoredSpace {
  stage: SpaceStage;
  /** Whether the Space's agent is signed in inside the container; null until the container answers. */
  signedIn: boolean | null;
}
export interface Dot {
  id: string;
  /** Default destination for saved pages, not ownership. */
  spaceId: string;
  spaceIds: string[];
  name: string;
  instructions: string;
  /** This Dot's folder in the Hearth-Core workspace: its computer's files. */
  directory: string;
  createdAt: number;
}
export interface Conversation {
  id: string;
  dotId: string;
  ownerId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** A one-line summary of the latest turn, for the sidebar. */
  preview: string;
}
export interface ServiceStatus {
  url: string;
  reachable: boolean;
  /** What answered, such as the Docker version. */
  detail?: string;
  error?: string;
  /** Whether Hearth-backend's Docker daemon answers, which Space containers need. */
  docker?: boolean;
}
export interface SetupStatus {
  backend: ServiceStatus;
  /** What stops Spaces from starting; empty when Hearth-backend and its Docker answer. */
  missing: string[];
}
/** The Space's agent inside its container: the account it is signed in to, never a credential. */
export interface AgentStatus {
  connected: boolean;
  /** How it is signed in, e.g. ``claude.ai`` for a Claude subscription or ``api_key`` for a key. */
  method: string | null;
  email: string | null;
  organization: string | null;
  subscription: string | null;
  /** Whether Hearth-Core can run the sign-in there (it needs a Linux container). */
  loginSupported: boolean;
  error?: string;
}
export interface AgentLogin {
  sessionId: string;
  /** Where the owner approves (claude.com, cursor.com, Google); Claude and Google then show a code to paste back. */
  authUrl: string;
  expiresIn: number;
  /** The agent was already signed in, so there is nothing to approve. */
  connected?: boolean;
}
export interface AgentLoginState {
  status: 'pending' | 'connected' | 'invalid_code' | 'failed' | 'cancelled';
  error?: string;
  /** The account, once connected. */
  agent?: AgentStatus;
}
/** One Space's setup: its container, then its agent, then GitHub, all inside the container. */
export interface SpaceSetup {
  stage: SpaceStage;
  container: string | null;
  /** Docker's status for the container: running, exited, … */
  status: string | null;
  /** Where this server reaches the Space's Hearth-Core. */
  coreUrl: string | null;
  error?: string;
  /** The Space's agent sign-in; null until Hearth-Core in the container answers. */
  agent: AgentStatus | null;
  github: GitHubStatus | null;
}
/** The Space's GitHub account, held by the gh CLI inside its container. */
export interface GitHubStatus {
  connected: boolean;
  username: string | null;
  name: string | null;
  /** How it was connected; ``terminal`` means gh was signed in outside Hearth. */
  method: 'device' | 'token' | 'terminal' | null;
  expiresAt: string | null;
  warnings: string[];
  /** ``gh auth status`` as gh printed it. */
  detail: string | null;
}
export interface GitHubDeviceLogin {
  sessionId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
}
export type GitHubDevicePoll =
  | { pending: true; userCode: string; verificationUri: string }
  | { pending: false; status: GitHubStatus };
export interface WorkspaceState {
  spaces: Space[];
  dots: Dot[];
  conversations: Conversation[];
  setup: SetupStatus;
}
