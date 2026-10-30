import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Check,
  ChevronDown,
  Clock,
  Code,
  Copy,
  Download,
  Files,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  GitPullRequest,
  HardDrive,
  Radar,
} from 'lucide-react';
import type { Space } from '../shared/types';
import type { BranchList, RepoSummary } from '../shared/repo-types';
import type { WatchOverview } from '../shared/watch-types';
import { api } from './api';
import { RepoFiles } from './RepoFiles';
import { RepoBranches, RepoCommits } from './RepoHistory';
import { RepoActivity, RepoApiDiff, RepoPulls } from './RepoWatch';
import {
  detectionsOf,
  formatSize,
  openBreaking,
  repoActivity,
  repoHash,
  watchesOf,
  type RepoRoute,
  type RepoTab,
} from './repo-view';
import { problemOf, when, exact, type Problem } from './watch-view';
import { WatchProblem } from './WatchProblem';

/** A link inside the repo page: the same repo, with some of its route changed. */
export type RepoLink = (next: Partial<RepoRoute>) => string;

/** The HTTPS and SSH clone URLs, each with a copy button. */
function CloneMenu({ https, ssh }: { https: string; ssh: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !box.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const copy = async (text: string) => {
    try {
      // Missing outside secure contexts, and refused without the page's focus.
      await navigator.clipboard?.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      setCopied('');
    }
  };
  return (
    <div className="repo-clone" ref={box}>
      <button
        className="repo-clone-button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!open)}
      >
        <Download size={15} aria-hidden="true" />
        Clone
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="repo-clone-menu" role="dialog" aria-label="Clone">
          {[
            ['HTTPS', https],
            ['SSH', ssh],
          ].map(([label, url]) => (
            <label key={label} className="repo-clone-row">
              <span>{label}</span>
              <span className="repo-clone-field">
                <input
                  readOnly
                  value={url}
                  spellCheck={false}
                  onFocus={(event) => event.target.select()}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Copy the ${label} clone URL`}
                  title="Copy"
                  onClick={() => void copy(url)}
                >
                  {copied === url ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** The repo's icon, owner and name, description, Clone, and the meta row under them. */
export function RepoHeader({
  owner,
  name,
  summary,
  watched,
}: {
  owner: string;
  name: string;
  summary?: RepoSummary;
  /** How many API watches this repo has. */
  watched: number;
}) {
  return (
    <>
      <header className="repo-header">
        <span className="repo-icon" aria-hidden="true">
          <FolderGit2 size={26} />
        </span>
        <div className="repo-title">
          <span className="repo-owner">{owner}</span>
          <h1>
            {summary ? (
              <a href={summary.html_url} target="_blank" rel="noreferrer">
                {name}
              </a>
            ) : (
              name
            )}
          </h1>
          {summary?.description && <p>{summary.description}</p>}
        </div>
        <CloneMenu
          https={
            summary?.clone_url ?? `https://github.com/${owner}/${name}.git`
          }
          ssh={summary?.ssh_url ?? `git@github.com:${owner}/${name}.git`}
        />
      </header>
      <ul className="repo-meta">
        {summary && (
          <>
            <li>
              <GitBranch size={14} aria-hidden="true" />
              <code>{summary.ref}</code>
            </li>
            <li>
              <HardDrive size={14} aria-hidden="true" />
              {formatSize(summary.size_bytes)}
            </li>
            <li title={exact(summary.head.date)}>
              <Clock size={14} aria-hidden="true" />
              Updated {when(summary.head.date)} by {summary.head.author}
            </li>
          </>
        )}
        <li>
          <Radar size={14} aria-hidden="true" />
          {watched} API{watched === 1 ? '' : 's'} watched
        </li>
      </ul>
    </>
  );
}

const TABS: { tab: RepoTab; label: string; icon: typeof Files }[] = [
  { tab: 'files', label: 'Files', icon: Files },
  { tab: 'code', label: 'Code', icon: Code },
  { tab: 'commits', label: 'Commits', icon: GitCommitHorizontal },
  { tab: 'branches', label: 'Branches', icon: GitBranch },
  { tab: 'activity', label: 'Activity', icon: Activity },
  { tab: 'pulls', label: 'Pull requests', icon: GitPullRequest },
  { tab: 'diff', label: 'API diff', icon: GitCompareArrows },
];

/** Files, Code, Commits, Branches, Activity, Pull requests and API diff, as links. */
export function RepoTabs({
  active,
  link,
  pulls,
  breaking,
}: {
  active: RepoTab;
  link: RepoLink;
  /** Fix pull requests of this repo's watches. */
  pulls: number;
  /** Breaking detections not fixed yet. */
  breaking: number;
}) {
  const counts: Partial<Record<RepoTab, number>> = { pulls, diff: breaking };
  return (
    <nav className="repo-tabs" aria-label="Repository">
      {TABS.map(({ tab, label, icon: Icon }) => (
        <a
          key={tab}
          href={link({ tab })}
          className={tab === active ? 'active' : undefined}
          aria-current={tab === active ? 'page' : undefined}
        >
          <Icon size={15} aria-hidden="true" />
          {label}
          {counts[tab] !== undefined && (
            <span
              className={
                tab === 'diff' && breaking ? 'repo-count alert' : 'repo-count'
              }
            >
              {counts[tab]}
            </span>
          )}
        </a>
      ))}
    </nav>
  );
}

const WATCH_TABS: RepoTab[] = ['activity', 'pulls', 'diff'];

/**
 * A watched repo, code-host style: its files and code, commits and branches from Hearth-Core's mirror,
 * and its API watch (activity, fix pull requests, the API diff). The summary and branches load once per
 * ref; the watch tabs refresh every 15 seconds while the page is visible.
 */
export function RepoBrowser({
  space,
  route,
}: {
  space: Space;
  route: RepoRoute;
}) {
  const { owner, name, ref, tab } = route;
  const repo = `${owner}/${name}`;
  const apiBase = `/spaces/${encodeURIComponent(space.id)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const link: RepoLink = useCallback(
    (next) =>
      repoHash({
        spaceId: route.spaceId,
        owner,
        name,
        tab: route.tab,
        ref,
        // Anything else (a folder, a commit, a line) is only kept when asked for.
        ...next,
      }),
    [route.spaceId, route.tab, owner, name, ref],
  );
  const [summary, setSummary] = useState<RepoSummary>();
  const [branches, setBranches] = useState<BranchList>();
  const [problem, setProblem] = useState<Problem>();
  useEffect(() => {
    let active = true;
    const query = ref ? `?${new URLSearchParams({ ref })}` : '';
    void (async () => {
      try {
        const [next, list] = await Promise.all([
          api<RepoSummary>(`${apiBase}${query}`),
          api<BranchList>(`${apiBase}/branches`),
        ]);
        if (!active) return;
        setSummary(next);
        setBranches(list);
        setProblem(undefined);
      } catch (cause) {
        if (active) setProblem(problemOf(cause, 'Could not read the repo.'));
      }
    })();
    return () => {
      active = false;
    };
  }, [apiBase, ref]);
  const [overview, setOverview] = useState<WatchOverview>();
  const [watchProblem, setWatchProblem] = useState<Problem>();
  const loadOverview = useCallback(async () => {
    try {
      setOverview(
        await api<WatchOverview>(
          `/spaces/${encodeURIComponent(space.id)}/watch`,
        ),
      );
      setWatchProblem(undefined);
    } catch (cause) {
      setWatchProblem(problemOf(cause, 'Could not read API watch.'));
    }
  }, [space.id]);
  const polling = WATCH_TABS.includes(tab);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!document.hidden) await loadOverview();
      if (!stopped && polling) timer = setTimeout(() => void tick(), 15000);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [loadOverview, polling]);
  const watches = overview ? watchesOf(overview.watches, repo) : [];
  const detections = overview ? detectionsOf(watches, overview.detections) : [];
  const pulls = detections.filter((detection) => detection.fix.pr);
  return (
    <div className="repo-page">
      <a
        className="repo-back"
        href={`#/spaces/${encodeURIComponent(space.id)}/watch`}
      >
        <ArrowLeft size={14} aria-hidden="true" /> API watch
      </a>
      <RepoHeader
        owner={owner}
        name={name}
        summary={summary}
        watched={watches.length}
      />
      <RepoTabs
        active={tab}
        link={link}
        pulls={pulls.length}
        breaking={detections.filter(openBreaking).length}
      />
      <WatchProblem problem={problem} spaceId={space.id} />
      <div className="repo-body">
        {tab === 'files' || tab === 'code' ? (
          <RepoFiles
            mode={tab}
            apiBase={apiBase}
            route={route}
            summary={summary}
            branches={branches}
            link={link}
          />
        ) : tab === 'commits' ? (
          <RepoCommits apiBase={apiBase} route={route} link={link} />
        ) : tab === 'branches' ? (
          <RepoBranches branches={branches} link={link} />
        ) : (
          <>
            <WatchProblem problem={watchProblem} spaceId={space.id} />
            {!overview ? (
              !watchProblem && <p className="muted">Reading API watch…</p>
            ) : tab === 'activity' ? (
              <RepoActivity
                items={repoActivity(watches, overview.detections)}
              />
            ) : tab === 'pulls' ? (
              <RepoPulls
                spaceId={space.id}
                detections={pulls}
                open={route.detection}
                link={link}
                onChanged={() => void loadOverview()}
              />
            ) : (
              <RepoApiDiff
                spaceId={space.id}
                watches={watches}
                detections={detections}
                link={link}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
