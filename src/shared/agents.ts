/**
 * The agents a Space can run: Hearth-Core's adapters (its ``AGENT_NAME``). A Dot picks one when it is
 * made; Hearth-backend sets it in the Space's container, and the Setup page signs that agent in through
 * its Hearth-Core connector (``/api/connectors/<connector>``).
 */
export type AgentId = 'claude_code' | 'cursor' | 'antigravity';

export interface Agent {
  id: AgentId;
  /** What the app calls it. */
  name: string;
  /** Hearth-Core's sign-in routes: ``/api/connectors/<connector>/…``. */
  connector: string;
  /** The account the agent signs in with, as in “Sign in with your … account”. */
  account: string;
  /** The link to the approval page, as its button reads. */
  approveLabel: string;
  /** Whether the approval page shows a code to paste back (Cursor's sign-in finishes on its own). */
  pastesCode: boolean;
  /** The pasted code's shape, as the input's placeholder. */
  codeHint: string;
  /** One line for the picker. */
  blurb: string;
}

export const AGENTS: Record<AgentId, Agent> = {
  claude_code: {
    id: 'claude_code',
    name: 'Claude Code',
    connector: 'claude-code',
    account: 'Claude',
    approveLabel: 'Approve on claude.com',
    pastesCode: true,
    codeHint: 'code#state',
    blurb: 'Anthropic’s coding agent, on your Claude account.',
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor',
    connector: 'cursor',
    account: 'Cursor',
    approveLabel: 'Approve on cursor.com',
    pastesCode: false,
    codeHint: '',
    blurb: 'Cursor’s agent CLI, on your Cursor account.',
  },
  antigravity: {
    id: 'antigravity',
    name: 'Antigravity',
    connector: 'antigravity',
    account: 'Google',
    approveLabel: 'Approve with Google',
    pastesCode: true,
    codeHint: 'code',
    blurb: 'Google Antigravity’s agent CLI, on your Google account.',
  },
};

export const AGENT_IDS = Object.keys(AGENTS) as AgentId[];
/** What a Space runs when nothing chose otherwise (every Space made before agents could be picked). */
export const DEFAULT_AGENT: AgentId = 'claude_code';

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && value in AGENTS;
}

export function agentOf(space: { agent?: string | null } | undefined): Agent {
  return AGENTS[isAgentId(space?.agent) ? space.agent : DEFAULT_AGENT];
}
