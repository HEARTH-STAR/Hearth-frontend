// The repo browser, as Hearth-Core's ``/api/repos`` routes answer: read-only views of the bare mirror it
// keeps of each repo that has an API watch. This server forwards the answers unchanged.

export interface Commit {
  /** 40 hex. */
  sha: string;
  /** 7 hex. */
  short: string;
  /** The first line of the message. */
  subject: string;
  author: string;
  /** ISO-8601 commit date. */
  date: string;
}

export interface RepoListItem {
  /** ``owner/name``. */
  repo: string;
  /** Watch names, e.g. ``["Stripe", "OpenAI"]``. */
  providers: string[];
  watch_ids: string[];
  /** The watches' base branches (null: the default branch). */
  branches: (string | null)[];
}

export interface RepoSummary {
  repo: string;
  /** GitHub's description, null when unknown. */
  description: string | null;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  /** The ref this answer is for: as asked, or the default branch. */
  ref: string;
  /** The sha ``ref`` resolves to. */
  commit: string;
  branch_count: number;
  /** Size of the mirror's packed objects. */
  size_bytes: number;
  /** The newest commit on ``ref``. */
  head: Commit;
  /** When the mirror last fetched from GitHub. */
  fetched_at: string;
}

export interface TreeEntry {
  name: string;
  /** Repo-relative. */
  path: string;
  /** Folder, file, submodule. */
  type: 'tree' | 'blob' | 'commit';
  /** Bytes, files only. */
  size: number | null;
  /** The newest commit on ``ref`` touching this path. */
  last_commit: Commit | null;
}

/** Folders first, then files, by name. */
export interface Tree {
  ref: string;
  commit: string;
  path: string;
  entries: TreeEntry[];
}

export interface Blob {
  ref: string;
  commit: string;
  path: string;
  size: number;
  binary: boolean;
  /** The text was cut at 512 KB. */
  truncated: boolean;
  /** Null when binary. */
  text: string | null;
  last_commit: Commit | null;
}

export interface CommitFile {
  path: string;
  /** Set for renames. */
  previous_path: string | null;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  /** Unified diff hunks (from ``@@`` on); null when binary or too big. */
  patch: string | null;
}

export interface CommitDetail {
  commit: Commit & { body: string; parents: string[] };
  files: CommitFile[];
}

export interface Branch {
  name: string;
  sha: string;
  is_default: boolean;
  last_commit: Commit;
}

export interface RepoList {
  repos: RepoListItem[];
}

export interface CommitPage {
  commits: Commit[];
  has_more: boolean;
}

/** The default branch first, then the newest. */
export interface BranchList {
  default: string;
  branches: Branch[];
}

export interface TreeQuery {
  ref?: string;
  path?: string;
}

export interface CommitsQuery extends TreeQuery {
  limit?: number;
  skip?: number;
}
