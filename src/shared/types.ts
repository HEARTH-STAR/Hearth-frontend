export interface Settings {
  /** The owner's display name, shown at the foot of the sidebar. */
  name: string;
  paused: boolean;
  memoryAllowed: boolean;
}
export interface Memory {
  id: string;
  text: string;
  createdAt: number;
}
export interface State {
  settings: Settings;
  memories: Memory[];
}
export interface Space {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  pageCount: number;
}
export interface Dot {
  id: string;
  /** Default destination for saved pages, not ownership. */
  spaceId: string;
  spaceIds: string[];
  name: string;
  /** A short label under the name, such as "Researcher". */
  role: string;
  instructions: string;
  /** This Dot's folder in the Hearth-Core workspace: its computer's files. */
  directory: string;
  memoryAllowed: boolean;
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
  /** What answered, such as the Hearth-Core agent or the Docker version. */
  detail?: string;
  error?: string;
}
export interface SetupStatus {
  core: ServiceStatus;
  backend: ServiceStatus;
  /** What stops conversations from running; empty when Hearth-Core answers. */
  missing: string[];
}
export interface WorkspaceState {
  spaces: Space[];
  dots: Dot[];
  conversations: Conversation[];
  setup: SetupStatus;
}
