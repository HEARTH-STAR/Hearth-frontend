// API watch, as Hearth-Core's ``/api/watch`` routes answer: each Space's Hearth-Core polls OpenAPI
// specs, diffs them, and on a breaking change has its agent fix the watched GitHub repo and open a PR.
// This server forwards those answers unchanged, so the browser and the server share these types.

export type WatchState = 'idle' | 'checking' | 'error';

/** One poll of a spec, newest first (Hearth-Core keeps the last 20). */
export interface WatchCheck {
  at: string;
  result: 'baseline' | 'unchanged' | 'changed' | 'error';
  from_version: string | null;
  to_version: string | null;
  breaking: number;
  total: number;
  /** Set when the diff had breaking changes. */
  detection_id: string | null;
  error: string | null;
}

export interface Watch {
  id: string;
  /** The provider label, e.g. ``stripe``. */
  name: string;
  spec_url: string;
  /** ``owner/name``: the GitHub repo to fix. */
  repo: string;
  /** Null: the repo's default branch. */
  base_branch: string | null;
  validate_commands: string[];
  interval_minutes: number;
  /** Breaking changes start an AI fix and a PR on their own. */
  auto_pr: boolean;
  enabled: boolean;
  /** The provider's SDKs the repo depends on (watches made from a repo). */
  packages?: string[];
  created_at: string;
  status: {
    state: WatchState;
    last_checked_at: string | null;
    last_changed_at: string | null;
    /** Null while the watch is off. */
    next_check_at: string | null;
    last_error: string | null;
    spec_version: string | null;
    spec_sha: string | null;
  };
  history: WatchCheck[];
}

export type FixStatus =
  | 'detected'
  | 'queued'
  | 'syncing'
  | 'scanning'
  | 'baseline'
  | 'fixing'
  | 'opening_pr'
  | 'pr_open'
  | 'merged'
  | 'closed'
  | 'no_impact'
  | 'failed';

/** A call site the change reaches in the repo. */
export interface ImpactMatch {
  path: string;
  line: number;
  symbol: string;
  snippet: string | null;
  confidence: number;
}

export interface ValidationCommandResult {
  command: string;
  exit_code: number;
  duration_seconds: number;
  failed_tests: string[];
  log_tail: string;
}

export interface ValidationResult {
  phase: 'baseline' | 'candidate';
  passed: boolean;
  commands: ValidationCommandResult[];
  regressions: string[];
  flaky: string[];
}

export type ReviewDecision =
  'approved' | 'changes_requested' | 'commented' | 'pending';

/** The fix's PR as Hearth-Core last synced it. */
export interface PullSummary {
  number: number;
  url: string;
  title: string;
  state: 'open' | 'closed' | 'merged';
  review_decision: ReviewDecision | null;
  head_sha: string | null;
  checked_at: string | null;
}

export interface Fix {
  status: FixStatus;
  message: string | null;
  updated_at: string;
  attempts: number;
  branch: string | null;
  pr: PullSummary | null;
  agent: string | null;
  agent_summary: string | null;
  needs_human_attention: string[];
  baseline: ValidationResult | null;
  /** The candidate validation that gated the PR. */
  validation: ValidationResult | null;
  impact: ImpactMatch[];
}

export interface DetectionSummary {
  id: string;
  watch_id: string;
  provider: string;
  detected_at: string;
  from_version: string;
  to_version: string;
  summary: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  breaking_count: number;
  total_count: number;
  fix: Fix;
}

/** One difference between the previous and the current spec. */
export interface ApiChange {
  type: string;
  /** ``POST /v1/payment_intents`` or ``schema:Customer``. */
  symbol: string;
  kind: string;
  /** The previous signature. */
  before: string | null;
  /** The current signature. */
  after: string | null;
  detail: string;
  renamed_to: string | null;
  breaking: boolean;
  description: string;
}

/** A detection with its changes, breaking ones first. */
export interface Detection extends DetectionSummary {
  changes: ApiChange[];
}

export interface PollerStatus {
  running: boolean;
  tick_at: string | null;
  /** The one fix running now. */
  active: { detection_id: string; status: FixStatus } | null;
  /** Detection ids waiting for the fixer. */
  queue: string[];
}

export interface WatchOverview {
  poller: PollerStatus;
  watches: Watch[];
  /** Newest first. */
  detections: DetectionSummary[];
}

export interface WatchInput {
  name: string;
  spec_url: string;
  repo: string;
  base_branch?: string | null;
  validate_commands: string[];
  interval_minutes?: number;
  auto_pr?: boolean;
}

/** Watch the APIs a repo uses: Hearth-Core finds the providers, their specs and how to validate. */
export interface RepoWatchInput {
  repo: string;
  base_branch?: string | null;
}

export interface RepoWatchResult {
  branch: string;
  commit: string;
  providers: {
    id: string;
    name: string;
    packages: string[];
    files: string[];
  }[];
  validate_commands: string[];
  /** The watches made now (fix PRs on), and the ones this repo already had. */
  watches: Watch[];
  existing: Watch[];
}

export type WatchPatch = Partial<
  Omit<WatchInput, 'repo'> & { enabled: boolean }
>;

export interface PullReview {
  id: number;
  user: string;
  state:
    'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  body: string;
  submitted_at: string | null;
}

export interface PullDetail {
  number: number;
  title: string;
  body: string;
  url: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  author: string;
  viewer: string | null;
  /** GitHub refuses approving or requesting changes on your own PR. */
  viewer_is_author: boolean;
  head: { ref: string; sha: string };
  base: { ref: string };
  /** Null while GitHub computes it. */
  mergeable: boolean | null;
  mergeable_state: string;
  additions: number;
  deletions: number;
  changed_files: number;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  review_decision: ReviewDecision;
  reviews: PullReview[];
  checks: { state: 'success' | 'failure' | 'pending' | null; total: number };
}

export interface PullFile {
  filename: string;
  previous_filename: string | null;
  status:
    | 'added'
    | 'removed'
    | 'modified'
    | 'renamed'
    | 'copied'
    | 'changed'
    | 'unchanged';
  additions: number;
  deletions: number;
  /** Unified diff hunks; null for binary or very large files. */
  patch: string | null;
}

export interface PullComment {
  id: number;
  kind: 'issue' | 'review_comment' | 'review';
  user: string;
  body: string;
  created_at: string;
  /** Review comments only. */
  path: string | null;
  /** Review comments only: the line on the new side of the diff. */
  line: number | null;
  /** Reviews only. */
  state: string | null;
  url: string | null;
}

export interface CommentInput {
  body: string;
  path?: string;
  line?: number;
}

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
export type MergeMethod = 'merge' | 'squash' | 'rebase';

export interface MergeResult {
  merged: boolean;
  sha: string | null;
  message: string;
}
