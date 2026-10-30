import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { MergeBox, ReviewActions } from '../src/client/PullRequestPanel';
import {
  ChangeTable,
  FixButton,
  FixPipeline,
} from '../src/client/WatchDetection';
import { ApiError } from '../src/client/api';
import { RepoList } from '../src/client/SpaceWatch';
import { pipeline, problemOf } from '../src/client/watch-view';
import type {
  ApiChange,
  DetectionSummary,
  Fix,
} from '../src/shared/watch-types';

const change = (over: Partial<ApiChange>): ApiChange => ({
  type: 'param_removed',
  symbol: 'POST /v1/charges',
  kind: 'operation',
  before: 'POST /v1/charges(amount, source)',
  after: 'POST /v1/charges(amount)',
  detail: 'source',
  renamed_to: null,
  breaking: true,
  description: 'Removed parameter source',
  ...over,
});
const fix = (over: Partial<Fix> = {}): Fix => ({
  status: 'detected',
  message: null,
  updated_at: '2026-10-30T10:00:00Z',
  attempts: 0,
  branch: null,
  pr: null,
  agent: null,
  agent_summary: null,
  needs_human_attention: [],
  baseline: null,
  validation: null,
  impact: [],
  ...over,
});
const detection = (over: Partial<Fix>): DetectionSummary => ({
  id: 'cr_0123456789ab',
  watch_id: 'w_0123456789ab',
  provider: 'stripe',
  detected_at: '2026-10-30T10:00:00Z',
  from_version: '1.0.0',
  to_version: '2.0.0',
  summary: '1 breaking change',
  severity: 'high',
  breaking_count: 1,
  total_count: 2,
  fix: fix(over),
});

it('marks breaking rows and folds the others away', () => {
  const html = renderToStaticMarkup(
    <ChangeTable
      changes={[
        change({}),
        change({
          breaking: false,
          type: 'param_added_optional',
          description: 'Added optional parameter memo',
          before: null,
        }),
      ]}
    />,
  );
  expect(html).toContain('<th scope="col">Previous</th>');
  expect(html).toContain('<th scope="col">Current</th>');
  expect(html).toMatch(
    /<tr class="breaking"><td><span class="breaking-tag">Breaking<\/span><strong>Removed parameter source<\/strong>/,
  );
  expect(html).toContain('POST /v1/charges(amount, source)');
  expect(html).not.toContain('Added optional parameter memo');
  expect(html).toContain('Show 1 non-breaking change');
});

it('keeps Approve and Request changes from the pull request’s own author', () => {
  const own = renderToStaticMarkup(
    <ReviewActions
      pull={{ state: 'open', viewer_is_author: true, author: 'hearth-bot' }}
      busy=""
      onComment={async () => true}
      onReview={async () => true}
    />,
  );
  expect(own).toMatch(/<button class="approve-button" disabled="">/);
  expect(own).toMatch(/<button class="request-button" disabled=""/);
  expect(own).toContain('does not let an author approve');
  const other = renderToStaticMarkup(
    <ReviewActions
      pull={{ state: 'open', viewer_is_author: false, author: 'hearth-bot' }}
      busy=""
      onComment={async () => true}
      onReview={async () => true}
    />,
  );
  expect(other).toMatch(/<button class="approve-button">/);
  expect(other).not.toContain('does not let an author approve');
});

it('merges only an open pull request GitHub can merge', () => {
  const merge = (over: object) =>
    renderToStaticMarkup(
      <MergeBox
        pull={{
          state: 'open',
          mergeable: true,
          mergeable_state: 'clean',
          draft: false,
          ...over,
        }}
        busy=""
        onMerge={() => {}}
      />,
    );
  expect(merge({})).toMatch(/<button class="primary">/);
  expect(merge({})).toMatch(/<option value="squash" selected="">/);
  expect(merge({ mergeable: false, mergeable_state: 'dirty' })).toMatch(
    /<button class="primary" disabled="">/,
  );
  expect(merge({ state: 'merged' })).toContain('This pull request is merged.');
});

it('lays a fix out as Detected → … → Merged', () => {
  const states = (over: Partial<Fix>) =>
    pipeline(fix(over)).map((step) => step.state);
  expect(pipeline(fix()).map((step) => step.label)).toEqual([
    'Detected',
    'Impact',
    'Validate baseline',
    'AI fix',
    'PR open',
    'Reviewed',
    'Merged',
  ]);
  expect(states({ status: 'fixing' })).toEqual([
    'done',
    'done',
    'done',
    'active',
    'todo',
    'todo',
    'todo',
  ]);
  expect(states({ status: 'merged' }).every((s) => s === 'done')).toBe(true);
  // a failed fix stops where its validation did
  expect(
    states({
      status: 'failed',
      impact: [
        { path: 'a.ts', line: 1, symbol: 'x', snippet: null, confidence: 1 },
      ],
      baseline: {
        phase: 'baseline',
        passed: false,
        commands: [],
        regressions: [],
        flaky: [],
      },
    }),
  ).toEqual(['done', 'done', 'failed', 'todo', 'todo', 'todo', 'todo']);
  const noImpact = pipeline(fix({ status: 'no_impact' }));
  expect(noImpact[1]).toEqual({ label: 'No impact', state: 'warn' });
  expect(
    renderToStaticMarkup(<FixPipeline fix={fix({ status: 'baseline' })} />),
  ).toContain('aria-label="Fix: Validating the untouched repo"');
});

it('offers a fix PR when auto-PR is off, and a retry when one failed', () => {
  const button = (over: Partial<Fix>, autoPr: boolean) =>
    renderToStaticMarkup(
      <FixButton
        detection={detection(over)}
        autoPr={autoPr}
        busy={false}
        onFix={() => {}}
      />,
    );
  expect(button({}, false)).toContain('Generate fix PR');
  expect(button({}, true)).toBe('');
  expect(button({ status: 'failed' }, true)).toContain('Retry fix');
  expect(button({ status: 'pr_open' }, false)).toBe('');
});

it('tells a starting Space and a missing GitHub connection apart', () => {
  expect(
    problemOf(
      new ApiError('Starting', 409, { error: 'Starting', stage: 'booting' }),
      '',
    ),
  ).toEqual({ message: 'Starting', stage: 'booting' });
  expect(
    problemOf(
      new ApiError('gh is not signed in', 409, {
        code: 'github_not_connected',
      }),
      '',
    ),
  ).toEqual({ message: 'gh is not signed in', github: true });
});

it('lists the watched repos first, each opening its repo page', () => {
  const watch = (id: string, name: string, repo: string) =>
    ({
      id,
      name,
      repo,
      status: { last_checked_at: '2026-10-30T09:00:00Z' },
    }) as never;
  const html = renderToStaticMarkup(
    <RepoList
      spaceId="space_1"
      watches={[
        watch('w_0123456789ab', 'Stripe', 'SAGARRAMBADE21/accept-a-payment'),
        watch('w_0123456789ac', 'OpenAI', 'SAGARRAMBADE21/accept-a-payment'),
      ]}
      detections={[
        detection({
          status: 'pr_open',
          pr: {
            number: 7,
            url: 'u',
            title: 't',
            state: 'open',
            review_decision: null,
            head_sha: null,
            checked_at: null,
          },
        }),
      ]}
    />,
  );
  expect(html).toContain('Repositories');
  expect(html).toContain(
    'href="#/spaces/space_1/repos/SAGARRAMBADE21/accept-a-payment"',
  );
  expect(html).toContain('accept-a-payment');
  expect(html).toContain('Stripe, OpenAI API');
  expect(html).toContain('1 breaking');
  expect(html.replace(/<!-- -->/g, '')).toContain('</svg> 1 PR</span>');
  expect(
    renderToStaticMarkup(
      <RepoList spaceId="space_1" watches={[]} detections={[]} />,
    ),
  ).toBe('');
});
