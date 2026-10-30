import type { Fix, FixStatus } from '../shared/watch-types';
import { ApiError } from './api';
// How API watch reads in the app: a fix's pipeline, its status words, times, and failures.

export const FIX_LABEL: Record<FixStatus, string> = {
  detected: 'Detected',
  queued: 'Waiting for the fixer',
  syncing: 'Fetching the repo',
  scanning: 'Finding call sites',
  baseline: 'Validating the untouched repo',
  fixing: 'AI fixing',
  opening_pr: 'Opening the pull request',
  pr_open: 'Pull request open',
  merged: 'Merged',
  closed: 'Pull request closed',
  no_impact: 'No impact found',
  failed: 'Fix failed',
};

/** A fix is under way in Hearth-Core. */
export const fixRunning = (status: FixStatus) =>
  [
    'queued',
    'syncing',
    'scanning',
    'baseline',
    'fixing',
    'opening_pr',
  ].includes(status);
/** Starting the fix again is allowed (Hearth-Core refuses while one runs or a PR is open or merged). */
export const fixRetryable = (status: FixStatus) =>
  status === 'failed' || status === 'no_impact' || status === 'closed';

export type StepState =
  'done' | 'active' | 'waiting' | 'warn' | 'failed' | 'todo';
export interface Step {
  label: string;
  state: StepState;
}
const STEPS = [
  'Detected',
  'Impact',
  'Validate baseline',
  'AI fix',
  'PR open',
  'Reviewed',
  'Merged',
];
const RUNNING: Partial<Record<FixStatus, number>> = {
  syncing: 1,
  scanning: 1,
  baseline: 2,
  fixing: 3,
  opening_pr: 4,
};
/** The step a failed fix stopped at, read from what it left behind. */
function failedAt(fix: Fix) {
  if (fix.pr) return 4;
  if (fix.validation) return fix.validation.passed ? 4 : 3;
  if (fix.baseline) return fix.baseline.passed ? 3 : 2;
  return fix.impact.length ? 2 : 1;
}
/** Detected → Impact → Validate baseline → AI fix → PR open → Reviewed → Merged, for one fix. */
export function pipeline(fix: Fix): Step[] {
  const states: StepState[] = STEPS.map(() => 'todo');
  const labels = [...STEPS];
  const doneTo = (end: number) => {
    for (let i = 0; i < end; i++) states[i] = 'done';
  };
  const decision = fix.pr?.review_decision;
  const reviewed =
    decision === 'approved'
      ? 'done'
      : decision === 'changes_requested'
        ? 'warn'
        : decision === 'commented'
          ? 'done'
          : 'waiting';
  switch (fix.status) {
    case 'detected':
      doneTo(1);
      break;
    case 'queued':
      doneTo(1);
      states[1] = 'waiting';
      break;
    case 'pr_open':
      doneTo(5);
      states[5] = reviewed;
      break;
    case 'merged':
      doneTo(7);
      break;
    case 'closed':
      doneTo(5);
      if (reviewed !== 'waiting') states[5] = reviewed;
      states[6] = 'failed';
      labels[6] = 'Closed';
      break;
    case 'no_impact':
      doneTo(1);
      states[1] = 'warn';
      labels[1] = 'No impact';
      break;
    case 'failed': {
      const at = failedAt(fix);
      doneTo(at);
      states[at] = 'failed';
      break;
    }
    default: {
      const at = RUNNING[fix.status] ?? 1;
      doneTo(at);
      states[at] = 'active';
    }
  }
  return STEPS.map((_, i) => ({ label: labels[i], state: states[i] }));
}

/** What went wrong, and whether it is the Space starting or GitHub not being connected. */
export interface Problem {
  message: string;
  /** The Space's container stage, when it is not ready yet. */
  stage?: string;
  /** gh is not signed in inside the Space. */
  github?: boolean;
}
export function problemOf(cause: unknown, fallback: string): Problem {
  if (cause instanceof ApiError)
    return {
      message: cause.message,
      ...(typeof cause.body?.stage === 'string'
        ? { stage: cause.body.stage }
        : {}),
      ...(cause.body?.code === 'github_not_connected' ? { github: true } : {}),
    };
  return { message: cause instanceof Error ? cause.message : fallback };
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
/** ``3 minutes ago``, ``in 12 minutes``; an empty string for no time. */
export function when(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return '';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  const seconds = Math.round((at - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return seconds < 0 ? 'just now' : 'in a moment';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86400), 'day');
}
/** The full local time, for a tooltip. */
export const exact = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString() : '';
