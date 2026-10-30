import { Fragment, useEffect, useRef, useState } from 'react';
import { File, FileText, Folder, FolderGit2, LoaderCircle } from 'lucide-react';
import type {
  Blob,
  BranchList,
  Commit,
  RepoSummary,
  Tree,
  TreeEntry,
} from '../shared/repo-types';
import { api } from './api';
import { highlightLines, type CodeToken } from './code-view';
import type { RepoLink } from './RepoBrowser';
import { openPageLink } from './page-navigation';
import {
  fileType,
  formatSize,
  initials,
  repoQuery,
  type RepoRoute,
} from './repo-view';
import { problemOf, when, exact, type Problem } from './watch-view';
import { WatchProblem } from './WatchProblem';

/** ``repo / dir / dir``: each part links to its folder; the last is where the page stands. */
export function RepoCrumbs({
  name,
  path,
  tab,
  link,
}: {
  name: string;
  path: string;
  tab: 'files' | 'code';
  link: RepoLink;
}) {
  const parts = path.split('/').filter(Boolean);
  return (
    <nav className="repo-crumbs" aria-label="Path">
      {parts.length ? (
        <a href={link({ tab, view: 'tree', path: '' })}>{name}</a>
      ) : (
        <strong>{name}</strong>
      )}
      {parts.map((part, index) => (
        <Fragment key={index}>
          <span aria-hidden="true">/</span>
          {index === parts.length - 1 ? (
            <strong>{part}</strong>
          ) : (
            <a
              href={link({
                tab,
                view: 'tree',
                path: parts.slice(0, index + 1).join('/'),
              })}
            >
              {part}
            </a>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

function EntryIcon({ entry }: { entry: TreeEntry }) {
  const Icon =
    entry.type === 'tree'
      ? Folder
      : entry.type === 'commit'
        ? FolderGit2
        : File;
  return (
    <span className={`repo-row-icon ${entry.type}`} aria-hidden="true">
      <Icon size={16} />
    </span>
  );
}

/** An author's initials in a circle. */
export function Avatar({ author }: { author: string }) {
  return (
    <span className="repo-avatar" aria-hidden="true" title={author}>
      {initials(author)}
    </span>
  );
}

/** The newest commit of the folder: avatar, author, subject, short sha and when. */
function LatestCommit({ commit }: { commit: Commit }) {
  return (
    <div className="repo-latest">
      <Avatar author={commit.author} />
      <strong>{commit.author}</strong>
      <span className="repo-latest-subject" title={commit.subject}>
        {commit.subject}
      </span>
      <code>{commit.short}</code>
      <time title={exact(commit.date)}>{when(commit.date)}</time>
    </div>
  );
}

const newest = (entries: TreeEntry[]) =>
  entries
    .map((entry) => entry.last_commit)
    .filter((commit): commit is Commit => !!commit)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];

/** A folder: Files lists names, types and sizes; Code lists each entry's last commit. */
function TreeView({
  mode,
  apiBase,
  route,
  summary,
  branches,
  link,
}: {
  mode: 'files' | 'code';
  apiBase: string;
  route: RepoRoute;
  summary?: RepoSummary;
  branches?: BranchList;
  link: RepoLink;
}) {
  const path = route.path ?? '';
  const [tree, setTree] = useState<Tree>();
  const [problem, setProblem] = useState<Problem>();
  useEffect(() => {
    let active = true;
    setTree(undefined);
    setProblem(undefined);
    api<Tree>(`${apiBase}/tree${repoQuery({ ref: route.ref, path })}`)
      .then((next) => active && setTree(next))
      .catch(
        (cause) =>
          active && setProblem(problemOf(cause, 'Could not read the folder.')),
      );
    return () => {
      active = false;
    };
  }, [apiBase, route.ref, path]);
  const current = route.ref ?? summary?.default_branch ?? '';
  const latest = tree && (path ? newest(tree.entries) : summary?.head);
  return (
    <div className="repo-tree">
      <div className="repo-toolbar">
        {mode === 'code' && (
          <label className="repo-branch-select">
            <span className="sr-only">Branch</span>
            <select
              value={current}
              disabled={!branches}
              onChange={(event) =>
                openPageLink(
                  link({
                    tab: 'code',
                    view: 'tree',
                    path,
                    ref:
                      event.target.value === branches?.default
                        ? undefined
                        : event.target.value,
                  }),
                )
              }
            >
              {/* A sha or unknown ref stays selectable as it is. */}
              {current &&
                !branches?.branches.some((item) => item.name === current) && (
                  <option value={current}>{current}</option>
                )}
              {branches?.branches.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <RepoCrumbs name={route.name} path={path} tab={mode} link={link} />
      </div>
      <WatchProblem problem={problem} spaceId={route.spaceId} />
      {!tree && !problem && (
        <p className="muted repo-loading">
          <LoaderCircle size={14} className="spinning" /> Reading the folder…
        </p>
      )}
      {tree && (
        <div className="repo-list">
          {mode === 'code' && latest && <LatestCommit commit={latest} />}
          {!tree.entries.length && (
            <p className="muted repo-empty">This folder is empty.</p>
          )}
          <ul className={`repo-rows ${mode}`}>
            {tree.entries.map((entry) => {
              const time = entry.last_commit && (
                <time title={exact(entry.last_commit.date)}>
                  {when(entry.last_commit.date)}
                </time>
              );
              const body =
                mode === 'files' ? (
                  <>
                    <EntryIcon entry={entry} />
                    <span className="repo-row-main">
                      <strong>{entry.name}</strong>
                      <small>
                        {entry.type === 'tree'
                          ? 'Folder'
                          : entry.type === 'commit'
                            ? 'Submodule'
                            : `${fileType(entry.name)} · ${formatSize(entry.size ?? 0)}`}
                      </small>
                    </span>
                    {time}
                  </>
                ) : (
                  <>
                    <EntryIcon entry={entry} />
                    <span className="repo-row-name">{entry.name}</span>
                    <span
                      className="repo-row-subject"
                      title={entry.last_commit?.subject}
                    >
                      {entry.last_commit?.subject}
                    </span>
                    {time}
                  </>
                );
              return (
                <li key={entry.path}>
                  {entry.type === 'commit' ? (
                    <div className="repo-row">{body}</div>
                  ) : (
                    <a
                      className="repo-row"
                      href={link({
                        tab: mode,
                        view: entry.type,
                        path: entry.path,
                      })}
                    >
                      {body}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A file's text, split into lines (no empty last line for a final newline). */
export function textLines(text: string) {
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
}

/** One file: its text with line numbers, highlighted when Shiki knows the language. */
function FileView({
  mode,
  apiBase,
  route,
  link,
}: {
  mode: 'files' | 'code';
  apiBase: string;
  route: RepoRoute;
  link: RepoLink;
}) {
  const path = route.path ?? '';
  const [blob, setBlob] = useState<Blob>();
  const [tokens, setTokens] = useState<CodeToken[][] | null>(null);
  const [problem, setProblem] = useState<Problem>();
  const code = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    setBlob(undefined);
    setTokens(null);
    setProblem(undefined);
    api<Blob>(`${apiBase}/blob${repoQuery({ ref: route.ref, path })}`)
      .then(async (next) => {
        if (!active) return;
        setBlob(next);
        if (next.text !== null) {
          const lines = await highlightLines(next.text, next.path);
          if (active) setTokens(lines);
        }
      })
      .catch(
        (cause) =>
          active && setProblem(problemOf(cause, 'Could not read the file.')),
      );
    return () => {
      active = false;
    };
  }, [apiBase, route.ref, path]);
  const line = route.line;
  useEffect(() => {
    if (!blob || !line) return;
    code.current
      ?.querySelector(`[data-line="${line}"]`)
      ?.scrollIntoView({ block: 'center' });
  }, [blob, line]);
  const fileName = path.split('/').pop() ?? path;
  const lines = blob?.text != null ? textLines(blob.text) : [];
  return (
    <div className="repo-file-view">
      <div className="repo-toolbar">
        <RepoCrumbs name={route.name} path={path} tab={mode} link={link} />
      </div>
      <WatchProblem problem={problem} spaceId={route.spaceId} />
      {!blob && !problem && (
        <p className="muted repo-loading">
          <LoaderCircle size={14} className="spinning" /> Reading the file…
        </p>
      )}
      {blob && (
        <section className="repo-file">
          <header className="repo-file-head">
            <FileText size={15} aria-hidden="true" />
            <strong>{fileName}</strong>
            <span className="repo-file-label">Source</span>
            <span className="muted">
              {blob.text !== null && `${lines.length} lines · `}
              {formatSize(blob.size)}
            </span>
            {blob.last_commit && (
              <span
                className="repo-file-commit"
                title={`${blob.last_commit.subject} (${blob.last_commit.short})`}
              >
                {blob.last_commit.subject} ·{' '}
                <time title={exact(blob.last_commit.date)}>
                  {when(blob.last_commit.date)}
                </time>
              </span>
            )}
          </header>
          {blob.binary || blob.text === null ? (
            <p className="repo-file-note">
              Binary file, {formatSize(blob.size)}
            </p>
          ) : (
            <div className="repo-code" ref={code}>
              <table>
                <tbody>
                  {lines.map((text, index) => {
                    const n = index + 1;
                    return (
                      <tr
                        key={n}
                        data-line={n}
                        className={n === line ? 'repo-line-hit' : undefined}
                      >
                        <td className="repo-line-number">
                          <a
                            href={link({
                              tab: mode,
                              view: 'blob',
                              path,
                              line: n,
                            })}
                          >
                            {n}
                          </a>
                        </td>
                        <td className="repo-line-text">
                          {tokens?.[index]
                            ? tokens[index].map((token, at) => (
                                <span
                                  key={at}
                                  style={
                                    token.color
                                      ? { color: token.color }
                                      : undefined
                                  }
                                >
                                  {token.content}
                                </span>
                              ))
                            : text}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {blob.truncated && (
            <p className="repo-file-note">
              The file is longer than 512 KB; only its start is shown.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

/** The Files and Code tabs: a folder, or a file opened from one. */
export function RepoFiles(props: {
  mode: 'files' | 'code';
  apiBase: string;
  route: RepoRoute;
  summary?: RepoSummary;
  branches?: BranchList;
  link: RepoLink;
}) {
  return props.route.view === 'blob' ? (
    <FileView {...props} />
  ) : (
    <TreeView {...props} />
  );
}
