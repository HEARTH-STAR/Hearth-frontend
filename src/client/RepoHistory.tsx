import { useEffect, useState } from 'react';
import { ArrowLeft, GitCommitHorizontal, LoaderCircle } from 'lucide-react';
import type {
  BranchList,
  CommitDetail,
  CommitFile,
  CommitPage,
} from '../shared/repo-types';
import type { PullFile } from '../shared/watch-types';
import { api } from './api';
import { FileDiff } from './PullRequestPanel';
import type { RepoLink } from './RepoBrowser';
import { Avatar } from './RepoFiles';
import { commitsByDay, repoQuery, type RepoRoute } from './repo-view';
import { problemOf, when, exact, type Problem } from './watch-view';
import { WatchProblem } from './WatchProblem';

const PAGE = 30;

/** A commit's file in the shape the pull request diff renders. */
export function asPullFile(file: CommitFile): PullFile {
  return {
    filename: file.path,
    previous_filename: file.previous_path,
    status: file.status === 'deleted' ? 'removed' : file.status,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch,
  };
}

/** The commits on the page's ref, by day, 30 at a time. */
function CommitList({
  apiBase,
  route,
  link,
}: {
  apiBase: string;
  route: RepoRoute;
  link: RepoLink;
}) {
  const [page, setPage] = useState<CommitPage>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>();
  const load = async (skip: number, active = () => true) => {
    setBusy(true);
    try {
      const next = await api<CommitPage>(
        `${apiBase}/commits${repoQuery({ ref: route.ref, limit: PAGE, skip: skip || undefined })}`,
      );
      if (!active()) return;
      setPage((previous) =>
        skip && previous
          ? {
              commits: [...previous.commits, ...next.commits],
              has_more: next.has_more,
            }
          : next,
      );
      setProblem(undefined);
    } catch (cause) {
      if (active()) setProblem(problemOf(cause, 'Could not read the commits.'));
    } finally {
      if (active()) setBusy(false);
    }
  };
  useEffect(() => {
    let alive = true;
    setPage(undefined);
    void load(0, () => alive);
    return () => {
      alive = false;
    };
    // `load` reads only these.
  }, [apiBase, route.ref]);
  return (
    <div className="repo-commits">
      <WatchProblem problem={problem} spaceId={route.spaceId} />
      {!page && !problem && (
        <p className="muted repo-loading">
          <LoaderCircle size={14} className="spinning" /> Reading the commits…
        </p>
      )}
      {page && !page.commits.length && (
        <p className="muted repo-empty">No commits on this branch.</p>
      )}
      {page &&
        commitsByDay(page.commits).map(({ day, commits }) => (
          <section key={day} className="repo-day">
            <h3>
              <GitCommitHorizontal size={14} aria-hidden="true" />
              Commits on {day}
            </h3>
            <ul className="repo-list repo-commit-list">
              {commits.map((commit) => (
                <li key={commit.sha}>
                  <a
                    className="repo-commit-row"
                    href={link({ tab: 'commits', sha: commit.sha })}
                  >
                    <span className="repo-commit-main">
                      <strong title={commit.subject}>{commit.subject}</strong>
                      <small>
                        <Avatar author={commit.author} />
                        {commit.author} ·{' '}
                        <time title={exact(commit.date)}>
                          {when(commit.date)}
                        </time>
                      </small>
                    </span>
                    <code className="repo-sha">{commit.short}</code>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      {page?.has_more && (
        <button
          className="repo-more"
          disabled={busy}
          onClick={() => void load(page.commits.length)}
        >
          {busy && <LoaderCircle size={14} className="spinning" />}
          Load more
        </button>
      )}
    </div>
  );
}

/** One commit: its message, author, parents, and each file's diff. */
function CommitView({
  apiBase,
  route,
  sha,
  link,
}: {
  apiBase: string;
  route: RepoRoute;
  sha: string;
  link: RepoLink;
}) {
  const [detail, setDetail] = useState<CommitDetail>();
  const [problem, setProblem] = useState<Problem>();
  useEffect(() => {
    let active = true;
    setDetail(undefined);
    api<CommitDetail>(`${apiBase}/commits/${encodeURIComponent(sha)}`)
      .then((next) => active && setDetail(next))
      .catch(
        (cause) =>
          active && setProblem(problemOf(cause, 'Could not read the commit.')),
      );
    return () => {
      active = false;
    };
  }, [apiBase, sha]);
  const files = detail?.files ?? [];
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return (
    <div className="repo-commit">
      <a className="repo-back" href={link({ tab: 'commits' })}>
        <ArrowLeft size={14} aria-hidden="true" /> All commits
      </a>
      <WatchProblem problem={problem} spaceId={route.spaceId} />
      {!detail && !problem && (
        <p className="muted repo-loading">
          <LoaderCircle size={14} className="spinning" /> Reading the commit…
        </p>
      )}
      {detail && (
        <>
          <header className="repo-commit-head">
            <h2>{detail.commit.subject}</h2>
            {detail.commit.body.trim() && (
              <pre>{detail.commit.body.trim()}</pre>
            )}
            <div className="repo-commit-facts">
              <span>
                <Avatar author={detail.commit.author} />
                <strong>{detail.commit.author}</strong> committed{' '}
                <time title={exact(detail.commit.date)}>
                  {when(detail.commit.date)}
                </time>
              </span>
              <span>
                Commit <code className="repo-sha">{detail.commit.sha}</code>
              </span>
              {detail.commit.parents.length > 0 && (
                <span>
                  {detail.commit.parents.length > 1 ? 'Parents' : 'Parent'}{' '}
                  {detail.commit.parents.map((parent) => (
                    <a
                      key={parent}
                      className="repo-sha"
                      href={link({ tab: 'commits', sha: parent })}
                    >
                      {parent.slice(0, 7)}
                    </a>
                  ))}
                </span>
              )}
            </div>
          </header>
          <p className="repo-commit-stats">
            {files.length} file{files.length === 1 ? '' : 's'} changed{' '}
            <span className="diff-count add">+{additions}</span>{' '}
            <span className="diff-count del">−{deletions}</span>
          </p>
          <div className="repo-diffs">
            {files.map((file) => (
              <FileDiff
                key={file.path}
                file={asPullFile(file)}
                comments={[]}
                defaultOpen={files.length <= 20}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** The Commits tab: the list, or one commit. */
export function RepoCommits({
  apiBase,
  route,
  link,
}: {
  apiBase: string;
  route: RepoRoute;
  link: RepoLink;
}) {
  return route.sha ? (
    <CommitView apiBase={apiBase} route={route} sha={route.sha} link={link} />
  ) : (
    <CommitList apiBase={apiBase} route={route} link={link} />
  );
}

/** The Branches tab: each branch's last commit; picking one makes it the page's ref. */
export function RepoBranches({
  branches,
  link,
}: {
  branches?: BranchList;
  link: RepoLink;
}) {
  if (!branches)
    return (
      <p className="muted repo-loading">
        <LoaderCircle size={14} className="spinning" /> Reading the branches…
      </p>
    );
  return (
    <ul className="repo-list repo-branch-list">
      {branches.branches.map((branch) => (
        <li key={branch.name}>
          <a
            className="repo-branch-row"
            href={link({
              tab: 'code',
              view: 'tree',
              path: '',
              ref: branch.is_default ? undefined : branch.name,
            })}
          >
            <span className="repo-branch-main">
              <span className="repo-branch-name">
                <code>{branch.name}</code>
                {branch.is_default && (
                  <span className="repo-default">default</span>
                )}
              </span>
              <small title={branch.last_commit.subject}>
                {branch.last_commit.subject}
              </small>
            </span>
            <span className="repo-branch-side">
              <span>
                {branch.last_commit.author} ·{' '}
                <time title={exact(branch.last_commit.date)}>
                  {when(branch.last_commit.date)}
                </time>
              </span>
              <code className="repo-sha">{branch.last_commit.short}</code>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
