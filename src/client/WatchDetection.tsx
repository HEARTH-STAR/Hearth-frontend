import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  RotateCcw,
  Wand2,
  X,
} from 'lucide-react';
import type {
  ApiChange,
  Detection,
  DetectionSummary,
  Fix,
  ImpactMatch,
  ValidationResult,
} from '../shared/watch-types';
import { AGENTS, type AgentId } from '../shared/agents';
import { api } from './api';
import { PullRequestPanel } from './PullRequestPanel';
import {
  FIX_LABEL,
  fixRetryable,
  fixRunning,
  pipeline,
  problemOf,
  when,
  exact,
  type Problem,
} from './watch-view';
import { WatchProblem } from './WatchProblem';

/** Detected → Impact → Validate baseline → AI fix → PR open → Reviewed → Merged. */
export function FixPipeline({ fix }: { fix: Fix }) {
  return (
    <ol className="fix-pipeline" aria-label={`Fix: ${FIX_LABEL[fix.status]}`}>
      {pipeline(fix).map((step) => (
        <li key={step.label} className={step.state} title={step.state}>
          <span className="fix-dot" aria-hidden="true">
            {step.state === 'done' ? (
              <Check size={10} />
            ) : step.state === 'active' ? (
              <LoaderCircle size={10} className="spinning" />
            ) : step.state === 'failed' ? (
              <X size={10} />
            ) : null}
          </span>
          <span>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

/** Start the fix of a detection nobody fixed yet, or try a failed one again. */
export function FixButton({
  detection,
  autoPr,
  busy,
  onFix,
}: {
  detection: DetectionSummary;
  autoPr: boolean;
  busy: boolean;
  onFix: () => void;
}) {
  const status = detection.fix.status;
  if (!(fixRetryable(status) || (status === 'detected' && !autoPr)))
    return null;
  return (
    <button className="primary" disabled={busy} onClick={onFix}>
      {busy ? (
        <LoaderCircle size={14} className="spinning" />
      ) : status === 'detected' ? (
        <Wand2 size={14} />
      ) : (
        <RotateCcw size={14} />
      )}
      {status === 'detected' ? 'Generate fix PR' : 'Retry fix'}
    </button>
  );
}

/** Previous and current signature of each change; breaking ones marked, the rest folded away. */
export function ChangeTable({ changes }: { changes: ApiChange[] }) {
  const [showAll, setShowAll] = useState(false);
  const breaking = changes.filter((change) => change.breaking);
  const other = changes.filter((change) => !change.breaking);
  const rows = showAll ? [...breaking, ...other] : breaking;
  return (
    <div className="change-table-wrap">
      <table className="change-table">
        <thead>
          <tr>
            <th scope="col">Change</th>
            <th scope="col">Previous</th>
            <th scope="col">Current</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((change, index) => (
            <tr
              key={`${change.symbol}:${change.type}:${index}`}
              className={change.breaking ? 'breaking' : ''}
            >
              <td>
                {change.breaking && (
                  <span className="breaking-tag">Breaking</span>
                )}
                <strong>{change.description}</strong>
                <small>
                  <code>{change.symbol}</code> · {change.type}
                  {change.renamed_to && (
                    <>
                      {' '}
                      → <code>{change.renamed_to}</code>
                    </>
                  )}
                </small>
              </td>
              <td>
                {change.before ? (
                  <code className="signature">{change.before}</code>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                {change.after ? (
                  <code className="signature">{change.after}</code>
                ) : (
                  <span className="muted">removed</span>
                )}
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={3} className="muted">
                No breaking changes.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {other.length > 0 && (
        <button
          className="text-button"
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {showAll
            ? 'Hide non-breaking changes'
            : `Show ${other.length} non-breaking change${other.length === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  );
}

function ImpactList({ impact }: { impact: ImpactMatch[] }) {
  if (!impact.length)
    return <p className="muted">No call sites recorded yet.</p>;
  return (
    <ul className="impact-list">
      {impact.map((match, index) => (
        <li key={`${match.path}:${match.line}:${index}`}>
          <div>
            <code>
              {match.path}:{match.line}
            </code>{' '}
            <span className="muted">
              {match.symbol} · {Math.round(match.confidence * 100)}% sure
            </span>
          </div>
          {match.snippet && <pre>{match.snippet}</pre>}
        </li>
      ))}
    </ul>
  );
}

function ValidationTable({
  baseline,
  candidate,
}: {
  baseline: ValidationResult | null;
  candidate: ValidationResult | null;
}) {
  const commands = [
    ...new Set(
      [...(baseline?.commands ?? []), ...(candidate?.commands ?? [])].map(
        (result) => result.command,
      ),
    ),
  ];
  if (!commands.length)
    return <p className="muted">Validation has not run yet.</p>;
  const cell = (result: ValidationResult | null, command: string) => {
    const run = result?.commands.find((item) => item.command === command);
    if (!run) return <span className="muted">—</span>;
    return (
      <>
        <span className={run.exit_code === 0 ? 'exit ok' : 'exit failed'}>
          exit {run.exit_code}
        </span>{' '}
        <span className="muted">{run.duration_seconds.toFixed(1)} s</span>
        {run.failed_tests.length > 0 && (
          <small>Failed: {run.failed_tests.join(', ')}</small>
        )}
        {run.log_tail && (
          <details>
            <summary>Log tail</summary>
            <pre>{run.log_tail}</pre>
          </details>
        )}
      </>
    );
  };
  const verdict = (result: ValidationResult | null) =>
    result ? (result.passed ? 'passed' : 'failed') : 'not run';
  return (
    <div className="change-table-wrap">
      <table className="change-table validation-table">
        <thead>
          <tr>
            <th scope="col">Command</th>
            <th scope="col">Baseline ({verdict(baseline)})</th>
            <th scope="col">With the fix ({verdict(candidate)})</th>
          </tr>
        </thead>
        <tbody>
          {commands.map((command) => (
            <tr key={command}>
              <td>
                <code>{command}</code>
              </td>
              <td>{cell(baseline, command)}</td>
              <td>{cell(candidate, command)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!!candidate?.regressions.length && (
        <p className="watch-warn">
          Regressions: {candidate.regressions.join(', ')}
        </p>
      )}
      {!!candidate?.flaky.length && (
        <p className="muted">Flaky: {candidate.flaky.join(', ')}</p>
      )}
    </div>
  );
}

/**
 * One detection: what changed in the spec, what it reaches in the repo, how the fix validated, and
 * its pull request. Polled every 5 seconds while the fix runs, every 15 otherwise.
 */
export function WatchDetection({
  spaceId,
  detectionId,
  autoPr,
  onBack,
}: {
  spaceId: string;
  detectionId: string;
  /** The detection's watch opens PRs on its own. */
  autoPr: boolean;
  onBack: () => void;
}) {
  const base = `/spaces/${encodeURIComponent(spaceId)}/watch/detections/${encodeURIComponent(detectionId)}`;
  const [detection, setDetection] = useState<Detection>();
  const [problem, setProblem] = useState<Problem>();
  const [busy, setBusy] = useState(false);
  const status = useRef(detection?.fix.status);
  status.current = detection?.fix.status;
  const load = useCallback(async () => {
    try {
      setDetection(await api<Detection>(base));
      setProblem(undefined);
    } catch (cause) {
      setProblem(problemOf(cause, 'Could not read this detection.'));
    }
  }, [base]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!document.hidden) await load();
      if (!stopped)
        timer = setTimeout(
          () => void tick(),
          status.current && fixRunning(status.current) ? 5000 : 15000,
        );
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [load]);
  const fix = async () => {
    setBusy(true);
    try {
      await api<DetectionSummary>(`${base}/fix`, 'POST', {});
      await load();
    } catch (cause) {
      setProblem(problemOf(cause, 'Could not start the fix.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="watch-detail">
      <button className="text-button watch-back" onClick={onBack}>
        <ArrowLeft size={13} /> All of API watch
      </button>
      <WatchProblem problem={problem} spaceId={spaceId} />
      {!detection ? (
        !problem && <p className="muted">Loading the detection…</p>
      ) : (
        <>
          <header className="watch-detail-head">
            <div>
              <span className="eyebrow">
                {detection.provider.toUpperCase()} · DETECTED{' '}
                <time title={exact(detection.detected_at)}>
                  {when(detection.detected_at).toUpperCase()}
                </time>
              </span>
              <h2>
                {detection.from_version} → {detection.to_version}
              </h2>
              <p>{detection.summary}</p>
              <div className="pull-badges">
                <span className={`severity ${detection.severity}`}>
                  {detection.severity}
                </span>
                <span className="pull-badge">
                  {detection.breaking_count} breaking of {detection.total_count}
                </span>
              </div>
            </div>
            <FixButton
              detection={detection}
              autoPr={autoPr}
              busy={busy}
              onFix={() => void fix()}
            />
          </header>
          <section className="watch-block">
            <h3>Fix</h3>
            <FixPipeline fix={detection.fix} />
            <p
              className={
                detection.fix.status === 'failed' ? 'watch-warn' : 'muted'
              }
            >
              {FIX_LABEL[detection.fix.status]}
              {detection.fix.message && `: ${detection.fix.message}`}
              {detection.fix.attempts > 1 &&
                ` (attempt ${detection.fix.attempts})`}
            </p>
          </section>
          <section className="watch-block">
            <h3>What changed</h3>
            <ChangeTable changes={detection.changes} />
          </section>
          <section className="watch-block">
            <h3>Impact in the repo</h3>
            <ImpactList impact={detection.fix.impact} />
          </section>
          <section className="watch-block">
            <h3>Validation</h3>
            <ValidationTable
              baseline={detection.fix.baseline}
              candidate={detection.fix.validation}
            />
          </section>
          {(detection.fix.agent_summary ||
            detection.fix.needs_human_attention.length > 0) && (
            <section className="watch-block">
              <h3>
                What{' '}
                {AGENTS[detection.fix.agent as AgentId]?.name ??
                  detection.fix.agent ??
                  'the agent'}{' '}
                did
              </h3>
              {detection.fix.agent_summary && (
                <p className="agent-summary">{detection.fix.agent_summary}</p>
              )}
              {detection.fix.needs_human_attention.length > 0 && (
                <>
                  <strong className="watch-warn">Needs your attention</strong>
                  <ul>
                    {detection.fix.needs_human_attention.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
          {detection.fix.pr && (
            <PullRequestPanel
              spaceId={spaceId}
              detectionId={detection.id}
              summary={detection.fix.pr}
              onChanged={() => void load()}
            />
          )}
        </>
      )}
    </div>
  );
}
