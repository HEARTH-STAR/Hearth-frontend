import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  GitPullRequest,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { Space } from '../shared/types';
import type {
  DetectionSummary,
  PollerStatus,
  RepoWatchInput,
  RepoWatchResult,
  Watch,
  WatchOverview,
  WatchPatch,
} from '../shared/watch-types';
import { api } from './api';
import { FixButton, FixPipeline, WatchDetection } from './WatchDetection';
import { FIX_LABEL, problemOf, when, exact, type Problem } from './watch-view';
import { WatchProblem } from './WatchProblem';
import { openPageLink } from './page-navigation';
import { detectionsOf, openBreaking, repoHref, watchesOf } from './repo-view';

/**
 * The repos this Space watches, first on the screen: each opens its repo page (files, code, commits, the
 * API diff and the fix PRs). The watch cards below keep each API's settings.
 */
export function RepoList({
  spaceId,
  watches,
  detections,
}: {
  spaceId: string;
  watches: Watch[];
  detections: DetectionSummary[];
}) {
  const repos = [...new Set(watches.map((watch) => watch.repo))].sort();
  if (!repos.length) return null;
  return (
    <section className="watch-block">
      <h3>Repositories</h3>
      <ul className="watch-repos">
        {repos.map((repo) => {
          const own = watchesOf(watches, repo);
          const found = detectionsOf(own, detections);
          const prs = found.filter((d) => d.fix.pr?.state === 'open').length;
          const breaking = found.filter(openBreaking).length;
          const checked = own
            .map((watch) => watch.status.last_checked_at)
            .filter((at): at is string => !!at)
            .sort()
            .at(-1);
          const [owner, name] = repo.split('/');
          return (
            <li key={repo}>
              <a href={repoHref(spaceId, repo)} className="watch-repo">
                <span className="watch-repo-icon" aria-hidden="true">
                  <FolderGit2 size={20} />
                </span>
                <span className="watch-repo-text">
                  <small>{owner}</small>
                  <strong>{name}</strong>
                  <span>
                    {own.map((watch) => watch.name).join(', ')} API
                    {own.length === 1 ? '' : 's'}
                    {checked
                      ? ` · checked ${when(checked)}`
                      : ' · first check pending'}
                  </span>
                </span>
                <span className="watch-repo-badges">
                  {breaking > 0 && (
                    <span className="watch-repo-badge breaking">
                      {breaking} breaking
                    </span>
                  )}
                  {prs > 0 && (
                    <span className="watch-repo-badge">
                      <GitPullRequest size={12} aria-hidden="true" /> {prs} PR
                      {prs === 1 ? '' : 's'}
                    </span>
                  )}
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PollerLine({
  poller,
  detections,
}: {
  poller: PollerStatus;
  detections: DetectionSummary[];
}) {
  const active = poller.active
    ? detections.find((item) => item.id === poller.active?.detection_id)
    : undefined;
  return (
    <p className="watch-poller" role="status">
      <i
        className={`space-health ${poller.running ? 'ready' : 'setup'}`}
        aria-hidden="true"
      />
      <span>
        {poller.running ? 'Polling' : 'Poller stopped'}
        {poller.tick_at && (
          <>
            {' · last tick '}
            <time title={exact(poller.tick_at)}>{when(poller.tick_at)}</time>
          </>
        )}
        {poller.active &&
          ` · fixing ${active ? `${active.provider} ${active.to_version}` : poller.active.detection_id}: ${FIX_LABEL[poller.active.status]}`}
        {poller.queue.length > 0 && ` · ${poller.queue.length} queued`}
      </span>
    </p>
  );
}

const CHECK_LABEL = {
  baseline: 'Baseline',
  unchanged: 'Unchanged',
  changed: 'Changed',
  error: 'Error',
};

function WatchCard({
  watch,
  repoLink,
  busy,
  onPatch,
  onCheck,
  onDelete,
}: {
  watch: Watch;
  /** The repo's page in this Space. */
  repoLink: string;
  busy: string;
  onPatch: (patch: WatchPatch) => void;
  onCheck: () => void;
  onDelete: () => void;
}) {
  const [history, setHistory] = useState(false);
  const { status } = watch;
  const checking = status.state === 'checking' || busy === 'check';
  return (
    <li className={`watch-card ${status.state}`}>
      <div className="watch-card-head">
        <div className="watch-card-title">
          <strong>{watch.name}</strong>
          <a
            href={watch.spec_url}
            target="_blank"
            rel="noreferrer"
            className="watch-url"
          >
            {watch.spec_url}
          </a>
          <span className="muted">
            <code>
              <a href={repoLink} title={`Browse ${watch.repo}`}>
                {watch.repo}
              </a>
              @{watch.base_branch ?? 'default branch'}
            </code>{' '}
            · every {watch.interval_minutes} min
          </span>
        </div>
        <div className="watch-actions">
          <button
            disabled={checking || !!busy}
            onClick={onCheck}
            title="Check the spec now"
          >
            {checking ? (
              <LoaderCircle size={14} className="spinning" />
            ) : (
              <RefreshCw size={14} />
            )}
            Check now
          </button>
          <button
            className="icon-button"
            aria-label={`Delete ${watch.name}`}
            title="Delete this watch"
            disabled={!!busy}
            onClick={onDelete}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <div className="watch-toggles">
        <label>
          <input
            type="checkbox"
            checked={watch.enabled}
            disabled={!!busy}
            onChange={(event) => onPatch({ enabled: event.target.checked })}
          />
          Polling on
        </label>
        <label>
          <input
            type="checkbox"
            checked={watch.auto_pr}
            disabled={!!busy}
            onChange={(event) => onPatch({ auto_pr: event.target.checked })}
          />
          Open a fix PR on its own
        </label>
      </div>
      <dl className="watch-facts">
        <div>
          <dt>Last checked</dt>
          <dd title={exact(status.last_checked_at)}>
            {when(status.last_checked_at) || 'not yet'}
          </dd>
        </div>
        <div>
          <dt>Next check</dt>
          <dd title={exact(status.next_check_at)}>
            {watch.enabled ? when(status.next_check_at) || 'soon' : 'off'}
          </dd>
        </div>
        <div>
          <dt>Spec version</dt>
          <dd>
            {status.spec_version ?? '—'}
            {status.spec_sha && (
              <span className="muted"> · {status.spec_sha}</span>
            )}
          </dd>
        </div>
      </dl>
      {status.last_error && (
        <p className="watch-warn">Last error: {status.last_error}</p>
      )}
      {watch.history.length > 0 && (
        <>
          <button
            className="text-button"
            aria-expanded={history}
            onClick={() => setHistory(!history)}
          >
            {history ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Recent checks ({watch.history.length})
          </button>
          {history && (
            <ol className="watch-history">
              {watch.history.map((check, index) => (
                <li key={`${check.at}:${index}`} className={check.result}>
                  <time title={exact(check.at)}>{when(check.at)}</time>
                  <span className="check-result">
                    {CHECK_LABEL[check.result]}
                  </span>
                  <span>
                    {check.from_version && check.to_version
                      ? `${check.from_version} → ${check.to_version}`
                      : (check.to_version ?? check.from_version ?? '')}
                  </span>
                  {check.result === 'changed' && (
                    <span>
                      {check.breaking}/{check.total} breaking
                    </span>
                  )}
                  {check.error && (
                    <span className="watch-warn">{check.error}</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </li>
  );
}

/**
 * The form for new watches: only the repo's clone URL and its branch. Hearth-Core clones it, watches the
 * API of every provider its dependencies name, and works out how to validate a fix; fix PRs open on their own.
 */
export function AddWatchForm({
  busy,
  problem,
  spaceId,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  problem?: Problem;
  spaceId: string;
  onSubmit: (input: RepoWatchInput) => void;
  onCancel: () => void;
}) {
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({
      repo: repo.trim(),
      ...(branch.trim() ? { base_branch: branch.trim() } : {}),
    });
  };
  return (
    <form className="watch-form" onSubmit={submit}>
      <h3>Add a watch</h3>
      <div className="watch-form-grid">
        <label>
          <span className="field-label">Repository URL</span>
          <input
            required
            autoFocus
            type="text"
            inputMode="url"
            spellCheck={false}
            placeholder="https://github.com/…"
            title="The URL you would clone the repo from"
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
          />
        </label>
        <label>
          <span className="field-label">Branch (optional)</span>
          <input
            maxLength={255}
            placeholder="The repo’s default branch"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
          />
        </label>
      </div>
      <small className="muted watch-form-note">
        Hearth reads the repo’s dependencies, watches the API of each provider
        it uses (Stripe, OpenAI, GitHub, Twilio, Slack, …), and opens a
        validated fix PR when one breaks.
      </small>
      <WatchProblem problem={problem} spaceId={spaceId} />
      <div className="watch-actions">
        <button className="primary" disabled={busy || !repo.trim()}>
          {busy && <LoaderCircle size={14} className="spinning" />}
          {busy ? 'Reading the repo…' : 'Add watch'}
        </button>
        <button type="button" className="text-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function DetectionRow({
  detection,
  autoPr,
  busy,
  onOpen,
  onFix,
}: {
  detection: DetectionSummary;
  autoPr: boolean;
  busy: boolean;
  onOpen: () => void;
  onFix: () => void;
}) {
  const { fix } = detection;
  const stopped = fix.status === 'failed' || fix.status === 'no_impact';
  return (
    <li className="detection-row">
      <div className="detection-main">
        <button className="detection-open" onClick={onOpen}>
          <strong>{detection.provider}</strong>{' '}
          <span>
            {detection.from_version} → {detection.to_version}
          </span>
          <ArrowUpRight size={13} aria-hidden="true" />
        </button>
        <div className="pull-badges">
          <span className={`severity ${detection.severity}`}>
            {detection.severity}
          </span>
          <span className="pull-badge">
            {detection.breaking_count}/{detection.total_count} breaking
          </span>
          <time className="muted" title={exact(detection.detected_at)}>
            {when(detection.detected_at)}
          </time>
        </div>
        <p>{detection.summary}</p>
        <FixPipeline fix={fix} />
        {(stopped || fix.message) && (
          <p className={stopped ? 'watch-warn' : 'muted'}>
            {FIX_LABEL[fix.status]}
            {fix.message && `: ${fix.message}`}
          </p>
        )}
        {fix.pr && (
          <p className="muted">
            Pull request{' '}
            <a href={fix.pr.url} target="_blank" rel="noreferrer">
              #{fix.pr.number}
            </a>{' '}
            · {fix.pr.state}
            {fix.pr.review_decision &&
              ` · ${fix.pr.review_decision.replace('_', ' ')}`}{' '}
            ·{' '}
            <button className="text-button" onClick={onOpen}>
              Review it here
            </button>
          </p>
        )}
      </div>
      <FixButton
        detection={detection}
        autoPr={autoPr}
        busy={busy}
        onFix={onFix}
      />
    </li>
  );
}

/**
 * A Space's API watch: the OpenAPI specs its Hearth-Core polls, the breaking changes it found, and the
 * AI fix and pull request of each. The list is polled every 5 seconds while it is open.
 */
export function SpaceWatch({
  space,
  detectionId,
  onDetection,
}: {
  space: Space;
  detectionId?: string;
  /** Open a detection's page, or the list again without one. */
  onDetection: (id?: string) => void;
}) {
  const base = `/spaces/${encodeURIComponent(space.id)}/watch`;
  const [overview, setOverview] = useState<WatchOverview>();
  const [problem, setProblem] = useState<Problem>();
  const [busy, setBusy] = useState('');
  const [adding, setAdding] = useState(false);
  const [formProblem, setFormProblem] = useState<Problem>();
  const load = useCallback(async () => {
    try {
      setOverview(await api<WatchOverview>(base));
      setProblem(undefined);
    } catch (cause) {
      setProblem(problemOf(cause, 'Could not read API watch.'));
    }
  }, [base]);
  // The detection page polls itself; it needs the list once, for its watch's auto-PR setting.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!document.hidden) await load();
      if (!stopped && !detectionId) timer = setTimeout(() => void tick(), 5000);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [load, detectionId]);
  const act = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name);
    setProblem(undefined);
    try {
      await action();
      await load();
    } catch (cause) {
      setProblem(problemOf(cause, 'API watch did not take that.'));
    } finally {
      setBusy('');
    }
  };
  const [added, setAdded] = useState<RepoWatchResult>();
  const add = async (input: RepoWatchInput) => {
    setBusy('add');
    setFormProblem(undefined);
    try {
      const result = await api<RepoWatchResult>(`${base}/repo`, 'POST', input);
      setAdded(result);
      setAdding(false);
      // The repo's page shows what is now watched, and where it hits the code.
      const repo = result.watches[0]?.repo ?? result.existing[0]?.repo;
      if (repo) openPageLink(repoHref(space.id, repo));
      else await load();
    } catch (cause) {
      setFormProblem(problemOf(cause, 'Could not add the watch.'));
    } finally {
      setBusy('');
    }
  };
  const autoPr = (watchId: string) =>
    overview?.watches.find((watch) => watch.id === watchId)?.auto_pr ?? true;
  if (detectionId) {
    const summary = overview?.detections.find(
      (item) => item.id === detectionId,
    );
    return (
      <WatchDetection
        key={detectionId}
        spaceId={space.id}
        detectionId={detectionId}
        autoPr={summary ? autoPr(summary.watch_id) : true}
        onBack={() => onDetection()}
      />
    );
  }
  return (
    <div className="space-watch">
      {overview && (
        <PollerLine poller={overview.poller} detections={overview.detections} />
      )}
      <WatchProblem problem={problem} spaceId={space.id} />
      {overview && (
        <RepoList
          spaceId={space.id}
          watches={overview.watches}
          detections={overview.detections}
        />
      )}
      <section className="watch-block">
        <div className="watch-block-head">
          <h3>Watches</h3>
          {!adding && (
            <button
              className="primary"
              onClick={() => {
                setFormProblem(undefined);
                setAdding(true);
              }}
            >
              <Plus size={14} /> Add watch
            </button>
          )}
        </div>
        {added && !adding && (
          <p className="watch-added" role="status">
            {added.watches.length
              ? `Watching ${added.watches.map((w) => w.name).join(', ')}`
              : `Already watching ${added.existing.map((w) => w.name).join(', ')}`}{' '}
            for <code>{(added.watches[0] ?? added.existing[0])?.repo}</code>@
            {added.branch}. Validating fixes with{' '}
            {added.validate_commands.map((command, index) => (
              <span key={command}>
                {index ? ', ' : ''}
                <code>{command}</code>
              </span>
            ))}
            ; fix PRs open on their own.{' '}
            <button className="text-button" onClick={() => setAdded(undefined)}>
              Dismiss
            </button>
          </p>
        )}
        {adding && (
          <AddWatchForm
            busy={busy === 'add'}
            problem={formProblem}
            spaceId={space.id}
            onSubmit={(input) => void add(input)}
            onCancel={() => setAdding(false)}
          />
        )}
        {overview && !overview.watches.length && !adding && (
          <p className="muted">
            Nothing watched yet. Add a GitHub repo: {space.name} finds the APIs
            it uses, checks them, and opens a fix PR when one breaks.
          </p>
        )}
        {!overview && !problem && (
          <p className="muted">
            <LoaderCircle size={14} className="spinning" /> Reading API watch…
          </p>
        )}
        <ul className="watch-list">
          {overview?.watches.map((watch) => (
            <WatchCard
              key={watch.id}
              watch={watch}
              repoLink={repoHref(space.id, watch.repo)}
              busy={busy.endsWith(watch.id) ? busy.split(':')[0] : busy}
              onPatch={(patch) =>
                void act(`patch:${watch.id}`, () =>
                  api<Watch>(`${base}/${watch.id}`, 'PATCH', patch),
                )
              }
              onCheck={() =>
                void act(`check:${watch.id}`, () =>
                  api<Watch>(`${base}/${watch.id}/check`, 'POST', {}),
                )
              }
              onDelete={() => {
                if (
                  window.confirm(
                    `Stop watching ${watch.name}? Its detections go too; pull requests on GitHub stay.`,
                  )
                )
                  void act(`delete:${watch.id}`, () =>
                    api(`${base}/${watch.id}`, 'DELETE'),
                  );
              }}
            />
          ))}
        </ul>
      </section>
      {overview && overview.detections.length > 0 && (
        <section className="watch-block">
          <h3>Breaking changes</h3>
          <ul className="detection-list">
            {overview.detections.map((detection) => (
              <DetectionRow
                key={detection.id}
                detection={detection}
                autoPr={autoPr(detection.watch_id)}
                busy={busy === `fix:${detection.id}`}
                onOpen={() => onDetection(detection.id)}
                onFix={() =>
                  void act(`fix:${detection.id}`, () =>
                    api(`${base}/detections/${detection.id}/fix`, 'POST', {}),
                  )
                }
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
