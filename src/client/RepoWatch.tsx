import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  CircleCheck,
  Flag,
  GitCompareArrows,
  GitPullRequest,
  Radar,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import type {
  ApiChange,
  Detection,
  DetectionSummary,
  Watch,
} from '../shared/watch-types';
import { api } from './api';
import { PullRequestPanel } from './PullRequestPanel';
import type { RepoLink } from './RepoBrowser';
import {
  CHANGE_KINDS,
  KIND_LABEL,
  changeKind,
  changeMix,
  groupChanges,
  impactByFile,
  type ActivityItem,
  type ActivityKind,
} from './repo-view';
import { FIX_LABEL, problemOf, when, exact, type Problem } from './watch-view';
import { WatchProblem } from './WatchProblem';

const ACTIVITY_ICON: Record<ActivityKind, typeof Radar> = {
  watch: Radar,
  baseline: Flag,
  unchanged: CircleCheck,
  changed: GitCompareArrows,
  error: CircleAlert,
  detection: TriangleAlert,
  fix: Wrench,
};

/** The Activity tab: this repo's watch checks, detections and fixes, newest first. */
export function RepoActivity({ items }: { items: ActivityItem[] }) {
  if (!items.length)
    return (
      <p className="muted repo-empty">
        No API watch activity yet. Each check of a watched API shows up here.
      </p>
    );
  return (
    <ol className="repo-timeline">
      {items.map((item, index) => {
        const Icon = ACTIVITY_ICON[item.kind];
        return (
          <li key={`${item.at}:${index}`} className={`repo-event ${item.kind}`}>
            <span className="repo-event-icon" aria-hidden="true">
              <Icon size={14} />
            </span>
            <div className="repo-event-body">
              <span className="repo-event-title">{item.title}</span>
              {item.detail && <small title={item.detail}>{item.detail}</small>}
            </div>
            <time title={exact(item.at)}>{when(item.at)}</time>
          </li>
        );
      })}
    </ol>
  );
}

const DECISION: Record<string, string> = {
  approved: 'Approved',
  changes_requested: 'Changes requested',
  commented: 'Commented',
  pending: 'Review pending',
};

/** The Pull requests tab: the fix PRs of this repo's watches, or one open for review. */
export function RepoPulls({
  spaceId,
  detections,
  open,
  link,
  onChanged,
}: {
  spaceId: string;
  /** Detections whose fix has a PR. */
  detections: DetectionSummary[];
  /** The detection whose PR is open. */
  open?: string;
  link: RepoLink;
  onChanged: () => void;
}) {
  const current = open && detections.find((item) => item.id === open);
  if (open)
    return (
      <div className="repo-pull">
        <a className="repo-back" href={link({ tab: 'pulls' })}>
          <ArrowLeft size={14} aria-hidden="true" /> All pull requests
        </a>
        {current && current.fix.pr ? (
          <PullRequestPanel
            spaceId={spaceId}
            detectionId={current.id}
            summary={current.fix.pr}
            onChanged={onChanged}
          />
        ) : (
          <p className="muted repo-empty">
            That pull request is not one of this repo’s fixes.
          </p>
        )}
      </div>
    );
  if (!detections.length)
    return (
      <p className="muted repo-empty">
        No pull requests yet. When a watched API breaks, Hearth fixes the code,
        validates the fix, and opens a pull request here.
      </p>
    );
  return (
    <ul className="repo-list repo-pull-list">
      {detections.map((detection) => {
        const pr = detection.fix.pr!;
        return (
          <li key={detection.id}>
            <a
              className="repo-pull-row"
              href={link({ tab: 'pulls', detection: detection.id })}
            >
              <GitPullRequest
                size={16}
                className={`repo-pull-icon ${pr.state}`}
                aria-hidden="true"
              />
              <span className="repo-pull-main">
                <strong title={pr.title}>{pr.title}</strong>
                <small>
                  #{pr.number} · {detection.provider} {detection.from_version} →{' '}
                  {detection.to_version} ·{' '}
                  <time
                    title={exact(pr.checked_at ?? detection.fix.updated_at)}
                  >
                    {when(pr.checked_at ?? detection.fix.updated_at)}
                  </time>
                </small>
              </span>
              <span className="pull-badges">
                <span className={`pull-state ${pr.state}`}>{pr.state}</span>
                {pr.review_decision && (
                  <span className={`pull-badge ${pr.review_decision}`}>
                    {DECISION[pr.review_decision]}
                  </span>
                )}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** Breaking vs additive vs deprecated vs other, as one stacked bar with its legend. */
export function ChangeMix({ changes }: { changes: ApiChange[] }) {
  const mix = changeMix(changes);
  const total = changes.length;
  const label = CHANGE_KINDS.filter((kind) => mix[kind])
    .map((kind) => `${mix[kind]} ${KIND_LABEL[kind].toLowerCase()}`)
    .join(', ');
  return (
    <div className="repo-mix-block">
      <div className="repo-mix" role="img" aria-label={label || 'No changes'}>
        {CHANGE_KINDS.filter((kind) => mix[kind]).map((kind) => (
          <span
            key={kind}
            className={`repo-mix-part ${kind}`}
            style={{ flexGrow: mix[kind] }}
            title={`${mix[kind]} ${KIND_LABEL[kind].toLowerCase()}`}
          />
        ))}
      </div>
      <ul className="repo-legend">
        {CHANGE_KINDS.map((kind) => (
          <li key={kind} className={mix[kind] ? undefined : 'none'}>
            <i className={`repo-swatch ${kind}`} aria-hidden="true" />
            {KIND_LABEL[kind]} <strong>{mix[kind]}</strong>
          </li>
        ))}
        <li className="repo-legend-total">{total} total</li>
      </ul>
    </div>
  );
}

/** Each resource's changes, colored by kind, with a compact before → after. */
export function ChangeMap({ changes }: { changes: ApiChange[] }) {
  return (
    <div className="repo-map">
      {groupChanges(changes).map((group) => (
        <section key={group.resource} className="repo-resource">
          <header>
            <code>{group.resource}</code>
            <span className="muted">
              {group.changes.length} change
              {group.changes.length === 1 ? '' : 's'}
              {group.breaking > 0 && ` · ${group.breaking} breaking`}
            </span>
          </header>
          <ul>
            {group.changes.map((change, index) => {
              const kind = changeKind(change);
              return (
                <li key={index} className={`repo-change ${kind}`}>
                  <div className="repo-change-head">
                    <span className={`repo-kind ${kind}`}>
                      {change.type.replace(/_/g, ' ')}
                    </span>
                    <code title={change.symbol}>{change.symbol}</code>
                  </div>
                  {(change.before || change.after) && (
                    <div className="repo-change-sig">
                      <code title={change.before ?? undefined}>
                        {change.before ?? '—'}
                      </code>
                      <ArrowRight size={12} aria-hidden="true" />
                      <code title={change.after ?? undefined}>
                        {change.renamed_to ?? change.after ?? '—'}
                      </code>
                    </div>
                  )}
                  {change.description && (
                    <small title={change.description}>
                      {change.description}
                    </small>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** One watch's newest detection: versions, change mix, change map, and where it hits the code. */
function WatchDiff({
  spaceId,
  watch,
  summary,
  link,
}: {
  spaceId: string;
  watch: Watch;
  summary?: DetectionSummary;
  link: RepoLink;
}) {
  const [detection, setDetection] = useState<Detection>();
  const [problem, setProblem] = useState<Problem>();
  // Only a new detection, or its fix moving on, needs the full detection again.
  const id = summary?.id;
  const updated = summary?.fix.updated_at;
  useEffect(() => {
    if (!id) return;
    let active = true;
    api<Detection>(
      `/spaces/${encodeURIComponent(spaceId)}/watch/detections/${encodeURIComponent(id)}`,
    )
      .then((next) => {
        if (!active) return;
        setDetection(next);
        setProblem(undefined);
      })
      .catch(
        (cause) =>
          active &&
          setProblem(problemOf(cause, 'Could not read the detection.')),
      );
    return () => {
      active = false;
    };
  }, [spaceId, id, updated]);
  const status = watch.status;
  if (!summary)
    return (
      <section className="repo-diff-card quiet">
        <header className="repo-strip">
          <strong>{watch.name}</strong>
          <span className="muted">
            No API changes since {status.spec_version ?? 'the first check'}
            {status.last_checked_at && (
              <>
                {' '}
                (last checked{' '}
                <time title={exact(status.last_checked_at)}>
                  {when(status.last_checked_at)}
                </time>
                )
              </>
            )}
          </span>
        </header>
      </section>
    );
  const shown = detection?.id === summary.id ? detection : undefined;
  const files = impactByFile(shown?.fix.impact ?? summary.fix.impact);
  const ref = watch.base_branch ?? undefined;
  return (
    <section className="repo-diff-card">
      <header className="repo-strip">
        <strong>{summary.provider}</strong>
        <span className="repo-versions">
          <code>{summary.from_version}</code>
          <ArrowRight size={13} aria-hidden="true" />
          <code>{summary.to_version}</code>
        </span>
        <span className={`severity ${summary.severity}`}>
          {summary.severity}
        </span>
        <span className="pull-badge">{FIX_LABEL[summary.fix.status]}</span>
        <time className="muted" title={exact(summary.detected_at)}>
          {when(summary.detected_at)}
        </time>
      </header>
      <p className="repo-diff-summary">{summary.summary}</p>
      <WatchProblem problem={problem} spaceId={spaceId} />
      {shown ? (
        <>
          <ChangeMix changes={shown.changes} />
          <h4>Change map</h4>
          <ChangeMap changes={shown.changes} />
        </>
      ) : (
        !problem && <p className="muted">Reading the changes…</p>
      )}
      <h4>Where it hits your code</h4>
      {files.length ? (
        <ul className="repo-impact">
          {files.map((file) => (
            <li key={file.path}>
              <code title={file.path}>{file.path}</code>
              <div className="repo-chips">
                {file.matches.map((match) => (
                  <a
                    key={`${match.line}:${match.symbol}`}
                    className="repo-chip"
                    href={link({
                      tab: 'files',
                      view: 'blob',
                      path: file.path,
                      line: match.line,
                      ref,
                    })}
                    title={match.snippet ?? match.symbol}
                  >
                    <strong>L{match.line}</strong>
                    <span>{match.symbol}</span>
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          {summary.fix.status === 'no_impact'
            ? 'No call sites in this repo use what changed.'
            : 'No call sites found yet.'}
        </p>
      )}
    </section>
  );
}

/** The API diff tab: for each of this repo's watches, its newest detection drawn as a diff. */
export function RepoApiDiff({
  spaceId,
  watches,
  detections,
  link,
}: {
  spaceId: string;
  watches: Watch[];
  detections: DetectionSummary[];
  link: RepoLink;
}) {
  if (!watches.length)
    return (
      <p className="muted repo-empty">
        This repo has no API watches. Add one from API watch.
      </p>
    );
  return (
    <div className="repo-diff">
      {watches.map((watch) => (
        <WatchDiff
          key={watch.id}
          spaceId={spaceId}
          watch={watch}
          summary={detections.find((item) => item.watch_id === watch.id)}
          link={link}
        />
      ))}
    </div>
  );
}
