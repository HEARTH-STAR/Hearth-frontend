import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  GitMerge,
  LoaderCircle,
  MessageSquare,
} from 'lucide-react';
import type {
  MergeMethod,
  MergeResult,
  PullComment,
  PullDetail,
  PullFile,
  PullSummary,
  ReviewEvent,
} from '../shared/watch-types';
import { api } from './api';
import { parsePatch } from './pull-diff';
import { problemOf, when, exact, type Problem } from './watch-view';
import { WatchProblem } from './WatchProblem';

const DECISION: Record<string, string> = {
  approved: 'Approved',
  changes_requested: 'Changes requested',
  commented: 'Commented',
  pending: 'Review pending',
};
const CHECKS: Record<string, string> = {
  success: 'Checks passed',
  failure: 'Checks failing',
  pending: 'Checks running',
};

/** One file's diff, with a comment box under a new-side line when its number is clicked. */
export function FileDiff({
  file,
  comments,
  onComment,
  defaultOpen = true,
}: {
  file: PullFile;
  comments: PullComment[];
  /** Posts a comment on a new-side line; omitted when the PR takes no comments. */
  onComment?: (path: string, line: number, body: string) => Promise<boolean>;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [line, setLine] = useState<number>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = file.patch === null ? [] : parsePatch(file.patch);
  const onLine = (n: number) =>
    comments.filter(
      (comment) =>
        comment.kind === 'review_comment' &&
        comment.path === file.filename &&
        comment.line === n,
    );
  const send = async () => {
    if (!onComment || line === undefined || !draft.trim()) return;
    setBusy(true);
    if (await onComment(file.filename, line, draft.trim())) {
      setDraft('');
      setLine(undefined);
    }
    setBusy(false);
  };
  return (
    <section className="pull-file">
      <button
        className="pull-file-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <code>
          {file.previous_filename && file.previous_filename !== file.filename
            ? `${file.previous_filename} → ${file.filename}`
            : file.filename}
        </code>
        <span className="pull-file-status">{file.status}</span>
        <span className="diff-count add">+{file.additions}</span>
        <span className="diff-count del">−{file.deletions}</span>
      </button>
      {open &&
        (file.patch === null ? (
          <p className="muted pull-file-empty">
            No diff to show: the file is binary or too large.
          </p>
        ) : (
          <div className="pull-diff-scroll">
            <table className="pull-diff">
              <tbody>
                {rows.map((row, index) => (
                  <Fragment key={index}>
                    <tr className={`diff-${row.kind}`}>
                      {row.kind === 'hunk' || row.kind === 'note' ? (
                        <td colSpan={4} className="diff-meta">
                          {row.text}
                        </td>
                      ) : (
                        <>
                          <td className="diff-num">{row.oldLine ?? ''}</td>
                          <td className="diff-num">
                            {row.newLine !== null && onComment ? (
                              <button
                                className="diff-line-button"
                                title={`Comment on line ${row.newLine}`}
                                aria-label={`Comment on ${file.filename} line ${row.newLine}`}
                                onClick={() => {
                                  setLine(row.newLine ?? undefined);
                                  setDraft('');
                                }}
                              >
                                {row.newLine}
                              </button>
                            ) : (
                              (row.newLine ?? '')
                            )}
                          </td>
                          <td className="diff-mark" aria-hidden="true">
                            {row.kind === 'add'
                              ? '+'
                              : row.kind === 'del'
                                ? '−'
                                : ' '}
                          </td>
                          <td className="diff-code">{row.text}</td>
                        </>
                      )}
                    </tr>
                    {row.newLine !== null &&
                      onLine(row.newLine).map((comment) => (
                        <tr key={`c${comment.id}`} className="diff-thread">
                          <td colSpan={4}>
                            <div className="diff-comment">
                              <strong>@{comment.user}</strong>{' '}
                              <time title={exact(comment.created_at)}>
                                {when(comment.created_at)}
                              </time>
                              <p>{comment.body}</p>
                            </div>
                          </td>
                        </tr>
                      ))}
                    {row.newLine !== null && row.newLine === line && (
                      <tr className="diff-thread">
                        <td colSpan={4}>
                          <form
                            className="diff-comment-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void send();
                            }}
                          >
                            <textarea
                              aria-label={`Comment on line ${line}`}
                              rows={3}
                              autoFocus
                              maxLength={65536}
                              placeholder={`Comment on line ${line}`}
                              value={draft}
                              onChange={(event) => setDraft(event.target.value)}
                            />
                            <div className="watch-actions">
                              <button
                                className="primary"
                                disabled={busy || !draft.trim()}
                              >
                                {busy && (
                                  <LoaderCircle
                                    size={14}
                                    className="spinning"
                                  />
                                )}
                                Comment
                              </button>
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => setLine(undefined)}
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}

/**
 * The conversation's comment box and review buttons. GitHub refuses approving or requesting changes
 * on your own pull request, so those wait for another account when the viewer opened it.
 */
export function ReviewActions({
  pull,
  busy,
  onComment,
  onReview,
}: {
  pull: Pick<PullDetail, 'state' | 'viewer_is_author' | 'author'>;
  busy: string;
  onComment: (body: string) => Promise<boolean>;
  onReview: (event: ReviewEvent, body: string) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const open = pull.state === 'open';
  const own = pull.viewer_is_author;
  const run = async (action: Promise<boolean>) => {
    if (await action) setText('');
  };
  return (
    <div className="review-box">
      <textarea
        aria-label="Comment or review"
        rows={4}
        maxLength={65536}
        placeholder="Leave a comment, or say what should change"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="watch-actions">
        <button
          disabled={!!busy || !text.trim()}
          onClick={() => void run(onComment(text.trim()))}
        >
          {busy === 'comment' ? (
            <LoaderCircle size={14} className="spinning" />
          ) : (
            <MessageSquare size={14} />
          )}
          Comment
        </button>
        <button
          className="approve-button"
          disabled={!!busy || !open || own}
          onClick={() => void run(onReview('APPROVE', text.trim()))}
        >
          {busy === 'APPROVE' && (
            <LoaderCircle size={14} className="spinning" />
          )}
          Approve
        </button>
        <button
          className="request-button"
          disabled={!!busy || !open || own || !text.trim()}
          title={text.trim() ? undefined : 'Say what should change first.'}
          onClick={() => void run(onReview('REQUEST_CHANGES', text.trim()))}
        >
          {busy === 'REQUEST_CHANGES' && (
            <LoaderCircle size={14} className="spinning" />
          )}
          Request changes
        </button>
      </div>
      {own && (
        <p className="muted review-note">
          This pull request was opened by @{pull.author}, the GitHub account
          connected to this Space. GitHub does not let an author approve or
          request changes on their own pull request; comment here, or review it
          on GitHub from another account.
        </p>
      )}
    </div>
  );
}

/** Merge method and button: only an open pull request GitHub has not called unmergeable. */
export function MergeBox({
  pull,
  busy,
  onMerge,
}: {
  pull: Pick<PullDetail, 'state' | 'mergeable' | 'mergeable_state' | 'draft'>;
  busy: string;
  onMerge: (method: MergeMethod) => void;
}) {
  const [method, setMethod] = useState<MergeMethod>('squash');
  const allowed = pull.state === 'open' && pull.mergeable !== false;
  return (
    <div className="merge-box">
      <label className="sr-only" htmlFor="merge-method">
        Merge method
      </label>
      <select
        id="merge-method"
        value={method}
        disabled={!allowed || !!busy}
        onChange={(event) => setMethod(event.target.value as MergeMethod)}
      >
        <option value="squash">Squash and merge</option>
        <option value="merge">Create a merge commit</option>
        <option value="rebase">Rebase and merge</option>
      </select>
      <button
        className="primary"
        disabled={!allowed || !!busy}
        onClick={() => onMerge(method)}
      >
        {busy === 'merge' ? (
          <LoaderCircle size={14} className="spinning" />
        ) : (
          <GitMerge size={14} />
        )}
        Merge
      </button>
      <small className="muted">
        {pull.state !== 'open'
          ? `This pull request is ${pull.state}.`
          : pull.mergeable === false
            ? `GitHub cannot merge it (${pull.mergeable_state}).`
            : pull.mergeable === null
              ? 'GitHub is still checking whether it can merge.'
              : pull.draft
                ? 'It is a draft.'
                : `Merge state: ${pull.mergeable_state}.`}
      </small>
    </div>
  );
}

/**
 * The fix's pull request, reviewed here: its state, its files with their diffs (comment on a line),
 * the conversation, review and merge. GitHub is reached through the Space's gh; an open pull
 * request is refreshed every 15 seconds.
 */
export function PullRequestPanel({
  spaceId,
  detectionId,
  summary,
  onChanged,
}: {
  spaceId: string;
  detectionId: string;
  summary: PullSummary;
  /** The detection changed (a merge, a review): reload it. */
  onChanged: () => void;
}) {
  const base = `/spaces/${encodeURIComponent(spaceId)}/watch/detections/${encodeURIComponent(detectionId)}/pull`;
  const [pull, setPull] = useState<PullDetail>();
  const [files, setFiles] = useState<PullFile[]>();
  const [comments, setComments] = useState<PullComment[]>([]);
  const [tab, setTab] = useState<'files' | 'conversation'>('files');
  const [problem, setProblem] = useState<Problem>();
  const [actionProblem, setActionProblem] = useState<Problem>();
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const head = useRef<string>(undefined);
  const loadComments = useCallback(async () => {
    const next = await api<{ comments: PullComment[] }>(`${base}/comments`);
    setComments(next.comments);
  }, [base]);
  const load = useCallback(async () => {
    try {
      const next = await api<PullDetail>(base);
      setPull(next);
      setProblem(undefined);
      // The files change only with a new head commit.
      if (head.current !== next.head.sha) {
        setFiles((await api<{ files: PullFile[] }>(`${base}/files`)).files);
        head.current = next.head.sha;
      }
      await loadComments();
      return next;
    } catch (cause) {
      setProblem(problemOf(cause, 'Could not read the pull request.'));
      return undefined;
    }
  }, [base, loadComments]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let state: string | undefined;
    const tick = async () => {
      if (!document.hidden || state === undefined)
        state = (await load())?.state;
      if (!stopped && state !== 'closed' && state !== 'merged')
        timer = setTimeout(() => void tick(), 15000);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [load]);
  const act = async (name: string, action: () => Promise<string>) => {
    setBusy(name);
    setActionProblem(undefined);
    setNotice('');
    try {
      setNotice(await action());
      return true;
    } catch (cause) {
      setActionProblem(problemOf(cause, 'GitHub did not take that.'));
      return false;
    } finally {
      setBusy('');
    }
  };
  const comment = (body: string, path?: string, line?: number) =>
    act('comment', async () => {
      await api<PullComment>(
        `${base}/comments`,
        'POST',
        path ? { body, path, line } : { body },
      );
      await loadComments();
      return 'Comment posted.';
    });
  const review = (event: ReviewEvent, body: string) =>
    act(event, async () => {
      await api(`${base}/reviews`, 'POST', body ? { event, body } : { event });
      await load();
      changed.current();
      return event === 'APPROVE' ? 'Approved.' : 'Review sent.';
    });
  const merge = (method: MergeMethod) => {
    if (
      !window.confirm(
        `Merge pull request #${pull?.number ?? summary.number} into ${pull?.base.ref ?? 'its base branch'}?`,
      )
    )
      return;
    void act('merge', async () => {
      const result = await api<MergeResult>(`${base}/merge`, 'POST', {
        method,
      });
      await load();
      changed.current();
      return result.message || (result.merged ? 'Merged.' : 'Not merged.');
    });
  };
  const state = pull?.state ?? summary.state;
  const decision = pull?.review_decision ?? summary.review_decision;
  return (
    <section className="pull-panel" aria-label="Pull request">
      <header className="pull-head">
        <div>
          <h3>
            {pull?.title ?? summary.title}{' '}
            <a href={summary.url} target="_blank" rel="noreferrer">
              #{summary.number} <ArrowUpRight size={12} aria-hidden="true" />
            </a>
          </h3>
          <div className="pull-badges">
            <span className={`pull-state ${state}`}>
              {pull?.draft ? 'Draft' : state}
            </span>
            {decision && (
              <span className={`pull-badge ${decision}`}>
                {DECISION[decision] ?? decision}
              </span>
            )}
            {pull?.checks.state && (
              <span className={`pull-badge checks-${pull.checks.state}`}>
                {CHECKS[pull.checks.state]} ({pull.checks.total})
              </span>
            )}
            {pull && state === 'open' && (
              <span className="pull-badge">
                {pull.mergeable === null
                  ? 'Mergeable: checking'
                  : `Mergeable: ${pull.mergeable ? 'yes' : 'no'} (${pull.mergeable_state})`}
              </span>
            )}
            {pull && (
              <span className="pull-badge">
                <span className="diff-count add">+{pull.additions}</span>{' '}
                <span className="diff-count del">−{pull.deletions}</span> in{' '}
                {pull.changed_files} file{pull.changed_files === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {pull && (
            <small className="muted">
              @{pull.author} wants to merge <code>{pull.head.ref}</code> into{' '}
              <code>{pull.base.ref}</code> · updated{' '}
              <time title={exact(pull.updated_at)}>
                {when(pull.updated_at)}
              </time>
            </small>
          )}
        </div>
      </header>
      <WatchProblem problem={problem} spaceId={spaceId} />
      {pull && (
        <>
          <div className="pull-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'files'}
              className={tab === 'files' ? 'active' : ''}
              onClick={() => setTab('files')}
            >
              Files ({files?.length ?? pull.changed_files})
            </button>
            <button
              role="tab"
              aria-selected={tab === 'conversation'}
              className={tab === 'conversation' ? 'active' : ''}
              onClick={() => setTab('conversation')}
            >
              Conversation ({comments.length})
            </button>
          </div>
          <WatchProblem problem={actionProblem} spaceId={spaceId} />
          {notice && (
            <p className="muted" role="status">
              {notice}
            </p>
          )}
          {tab === 'files' ? (
            files ? (
              files.map((file, index) => (
                <FileDiff
                  key={file.filename}
                  file={file}
                  comments={comments}
                  defaultOpen={index < 10}
                  onComment={
                    state === 'open'
                      ? (path, line, body) => comment(body, path, line)
                      : undefined
                  }
                />
              ))
            ) : (
              <p className="muted">Loading files…</p>
            )
          ) : (
            <div className="pull-conversation">
              {pull.body && (
                <article className="timeline-item">
                  <header>
                    <strong>@{pull.author}</strong> opened this pull request{' '}
                    <time title={exact(pull.created_at)}>
                      {when(pull.created_at)}
                    </time>
                  </header>
                  <p>{pull.body}</p>
                </article>
              )}
              {comments.map((item) => (
                <article
                  key={`${item.kind}${item.id}`}
                  className={`timeline-item ${item.kind}`}
                >
                  <header>
                    <strong>@{item.user}</strong>{' '}
                    {item.kind === 'review' ? (
                      (DECISION[item.state?.toLowerCase() ?? ''] ?? 'Reviewed')
                    ) : item.kind === 'review_comment' ? (
                      <>
                        on{' '}
                        <code>
                          {item.path}
                          {item.line ? `:${item.line}` : ''}
                        </code>
                      </>
                    ) : (
                      'commented'
                    )}{' '}
                    <time title={exact(item.created_at)}>
                      {when(item.created_at)}
                    </time>
                  </header>
                  {item.body && <p>{item.body}</p>}
                </article>
              ))}
              {!pull.body && !comments.length && (
                <p className="muted">No comments yet.</p>
              )}
              <ReviewActions
                pull={pull}
                busy={busy}
                onComment={(body) => comment(body)}
                onReview={review}
              />
            </div>
          )}
          <MergeBox pull={pull} busy={busy} onMerge={merge} />
        </>
      )}
      {!pull && !problem && (
        <p className="muted">
          <LoaderCircle size={14} className="spinning" /> Reading the pull
          request from GitHub…
        </p>
      )}
    </section>
  );
}
