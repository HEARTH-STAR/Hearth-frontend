import { expect, it } from 'vitest';
import {
  changeKind,
  changeMix,
  commitsByDay,
  detectionsOf,
  fileType,
  formatSize,
  groupChanges,
  impactByFile,
  initials,
  openBreaking,
  parseRepoHash,
  repoActivity,
  repoHash,
  repoHref,
  repoQuery,
  resourceOf,
  watchesOf,
  type RepoRoute,
} from '../src/client/repo-view';
import { asPullFile } from '../src/client/RepoHistory';
import { textLines } from '../src/client/RepoFiles';
import type { DetectionSummary, Fix, Watch } from '../src/shared/watch-types';

it('reads the repo page from the hash, and writes it back', () => {
  const routes: [string, RepoRoute][] = [
    [
      '#/spaces/s1/repos/acme/shop',
      {
        spaceId: 's1',
        owner: 'acme',
        name: 'shop',
        tab: 'files',
        view: 'tree',
        path: '',
      },
    ],
    [
      '#/spaces/s1/repos/acme/shop/code/tree/src/pay?ref=feature%2Fx',
      {
        spaceId: 's1',
        owner: 'acme',
        name: 'shop',
        tab: 'code',
        view: 'tree',
        path: 'src/pay',
        ref: 'feature/x',
      },
    ],
    [
      '#/spaces/s1/repos/acme/shop/files/blob/src/my%20file.ts?line=42',
      {
        spaceId: 's1',
        owner: 'acme',
        name: 'shop',
        tab: 'files',
        view: 'blob',
        path: 'src/my file.ts',
        line: 42,
      },
    ],
    [
      `#/spaces/s1/repos/acme/shop/commits/${'a'.repeat(40)}`,
      {
        spaceId: 's1',
        owner: 'acme',
        name: 'shop',
        tab: 'commits',
        sha: 'a'.repeat(40),
      },
    ],
    [
      '#/spaces/s1/repos/acme/shop/pulls/cr_0123456789ab',
      {
        spaceId: 's1',
        owner: 'acme',
        name: 'shop',
        tab: 'pulls',
        detection: 'cr_0123456789ab',
      },
    ],
    [
      '#/spaces/s1/repos/my.org/my_repo-2/diff',
      { spaceId: 's1', owner: 'my.org', name: 'my_repo-2', tab: 'diff' },
    ],
  ];
  for (const [hash, route] of routes) {
    expect(parseRepoHash(hash), hash).toEqual(route);
    expect(repoHash(route)).toBe(hash);
  }
  // The Files tab's root needs no tab segment.
  expect(
    parseRepoHash('#/spaces/s1/repos/acme/shop/files/tree?ref=main'),
  ).toMatchObject({ tab: 'files', path: '', ref: 'main' });
  expect(repoHref('s1', 'acme/shop')).toBe('#/spaces/s1/repos/acme/shop');
});

it('ignores other hashes and bad repo names', () => {
  for (const hash of [
    '',
    '#/spaces/s1',
    '#/spaces/s1/watch',
    '#/spaces/s1/repos/acme',
    '#/spaces/s1/repos/ac$me/shop',
    '#/spaces/s1/repos/acme/shop/people',
    '#/spaces/s1/repos/acme/%E0%A4%A',
  ])
    expect(parseRepoHash(hash), hash).toBeUndefined();
  // A bad sha or line is dropped, not followed.
  expect(
    parseRepoHash('#/spaces/s1/repos/acme/shop/commits/zzz?line=-3'),
  ).toEqual({ spaceId: 's1', owner: 'acme', name: 'shop', tab: 'commits' });
});

it('builds query strings of the values that are set', () => {
  expect(repoQuery({ ref: undefined, path: '' })).toBe('');
  expect(repoQuery({ ref: 'main', path: 'src/a b', limit: 30 })).toBe(
    '?ref=main&path=src%2Fa+b&limit=30',
  );
});

it('formats sizes, file types and initials', () => {
  expect(formatSize(78)).toBe('78 B');
  expect(formatSize(1024)).toBe('1 KB');
  expect(formatSize(1434)).toBe('1.4 KB');
  expect(formatSize(15_000)).toBe('15 KB');
  expect(formatSize(1.2 * 1024 * 1024)).toBe('1.2 MB');
  expect(formatSize(3 * 1024 ** 3)).toBe('3 GB');
  expect(fileType('README.md')).toBe('MD');
  expect(fileType('package.json')).toBe('JSON');
  expect(fileType('.gitignore')).toBe('GITIGNORE');
  expect(fileType('LICENSE')).toBe('FILE');
  expect(initials('Sagar Rambade')).toBe('SR');
  expect(initials('ada')).toBe('A');
  expect(initials('dependabot[bot]')).toBe('D');
  expect(initials('')).toBe('?');
});

it('groups commits by the day they were made', () => {
  const commit = (sha: string, date: string) => ({
    sha,
    short: sha.slice(0, 7),
    subject: sha,
    author: 'Ada',
    date,
  });
  const days = commitsByDay([
    commit('c3', '2026-10-30T12:00:00'),
    commit('c2', '2026-10-30T09:00:00'),
    commit('c1', '2026-10-28T12:00:00'),
  ]);
  expect(days.map((day) => day.day)).toEqual(['Oct 30, 2026', 'Oct 28, 2026']);
  expect(days[0].commits.map((c) => c.sha)).toEqual(['c3', 'c2']);
});

it('reads a commit’s file as a pull request file and splits text into lines', () => {
  expect(
    asPullFile({
      path: 'b.ts',
      previous_path: 'a.ts',
      status: 'deleted',
      additions: 0,
      deletions: 3,
      patch: null,
    }),
  ).toEqual({
    filename: 'b.ts',
    previous_filename: 'a.ts',
    status: 'removed',
    additions: 0,
    deletions: 3,
    patch: null,
  });
  expect(textLines('a\r\nb\n')).toEqual(['a', 'b']);
  expect(textLines('')).toEqual(['']);
});

it('sorts API changes into breaking, additive, deprecated and other', () => {
  const kinds = [
    { type: 'removed', breaking: true },
    { type: 'param_added_required', breaking: true },
    { type: 'added', breaking: false },
    { type: 'param_added_optional', breaking: false },
    { type: 'enum_values_added', breaking: false },
    { type: 'deprecated', breaking: false },
    { type: 'description_changed', breaking: false },
  ].map(changeKind);
  expect(kinds).toEqual([
    'breaking',
    'breaking',
    'additive',
    'additive',
    'additive',
    'deprecated',
    'other',
  ]);
  expect(
    changeMix([
      { type: 'removed', breaking: true },
      { type: 'added', breaking: false },
      { type: 'added', breaking: false },
    ]),
  ).toEqual({ breaking: 1, additive: 2, deprecated: 0, other: 0 });
});

it('groups changes by the API resource they touch', () => {
  expect(resourceOf('POST /v1/payment_intents/{}/confirm')).toBe(
    'payment_intents',
  );
  expect(resourceOf('GET /v1/customers/{customer}')).toBe('customers');
  expect(resourceOf('GET /api/v2/users')).toBe('users');
  expect(resourceOf('GET /2024-01-01/orders')).toBe('orders');
  expect(resourceOf('GET /')).toBe('/');
  expect(resourceOf('schema:Customer')).toBe('Schemas');
  expect(resourceOf('stripe.Charges.create')).toBe('stripe.Charges');
  const change = (symbol: string, breaking: boolean) => ({ symbol, breaking });
  const groups = groupChanges([
    change('schema:Charge', true),
    change('POST /v1/charges', false),
    change('POST /v1/payment_intents', true),
    change('POST /v1/payment_intents/{}/confirm', true),
    change('GET /v1/charges/{}', false),
  ]);
  expect(groups.map((group) => [group.resource, group.breaking])).toEqual([
    ['payment_intents', 2],
    ['Schemas', 1],
    ['charges', 0],
  ]);
  expect(groups[2].changes).toHaveLength(2);
});

it('lists call sites by file, each line once', () => {
  const at = (path: string, line: number, symbol = 'charges.create') => ({
    path,
    line,
    symbol,
    snippet: null,
    confidence: 1,
  });
  expect(
    impactByFile([
      at('src/b.ts', 9),
      at('src/a.ts', 30),
      at('src/a.ts', 4),
      at('src/a.ts', 4),
    ]),
  ).toEqual([
    { path: 'src/a.ts', matches: [at('src/a.ts', 4), at('src/a.ts', 30)] },
    { path: 'src/b.ts', matches: [at('src/b.ts', 9)] },
  ]);
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
const watch = (over: Partial<Watch>): Watch => ({
  id: 'w_000000000001',
  name: 'stripe',
  spec_url: 'https://example.com/openapi.json',
  repo: 'acme/shop',
  base_branch: null,
  validate_commands: ['npm test'],
  interval_minutes: 60,
  auto_pr: true,
  enabled: true,
  created_at: '2026-10-29T08:00:00Z',
  status: {
    state: 'idle',
    last_checked_at: null,
    last_changed_at: null,
    next_check_at: null,
    last_error: null,
    spec_version: null,
    spec_sha: null,
  },
  history: [],
  ...over,
});
const detection = (over: Partial<DetectionSummary>): DetectionSummary => ({
  id: 'cr_000000000001',
  watch_id: 'w_000000000001',
  provider: 'stripe',
  detected_at: '2026-10-30T10:00:00Z',
  from_version: '1.0.0',
  to_version: '2.0.0',
  summary: '1 breaking change',
  severity: 'high',
  breaking_count: 1,
  total_count: 2,
  fix: fix(),
  ...over,
});

it('picks the repo’s own watches and detections, and which breaks are open', () => {
  const ours = watch({ repo: 'Acme/Shop' });
  const theirs = watch({ id: 'w_000000000002', repo: 'acme/other' });
  expect(watchesOf([ours, theirs], 'acme/shop')).toEqual([ours]);
  const mine = detection({});
  const other = detection({ id: 'cr_000000000002', watch_id: theirs.id });
  expect(detectionsOf([ours], [mine, other])).toEqual([mine]);
  expect(openBreaking(mine)).toBe(true);
  expect(openBreaking(detection({ fix: fix({ status: 'merged' }) }))).toBe(
    false,
  );
  expect(openBreaking(detection({ breaking_count: 0 }))).toBe(false);
});

it('builds the repo’s activity, newest first', () => {
  const items = repoActivity(
    [
      watch({
        history: [
          {
            at: '2026-10-30T10:00:00Z',
            result: 'changed',
            from_version: '1.0.0',
            to_version: '2.0.0',
            breaking: 1,
            total: 2,
            detection_id: 'cr_000000000001',
            error: null,
          },
          {
            at: '2026-10-29T09:00:00Z',
            result: 'error',
            from_version: null,
            to_version: null,
            breaking: 0,
            total: 0,
            detection_id: null,
            error: 'HTTP 500',
          },
          {
            at: '2026-10-29T08:30:00Z',
            result: 'baseline',
            from_version: null,
            to_version: '1.0.0',
            breaking: 0,
            total: 0,
            detection_id: null,
            error: null,
          },
        ],
      }),
    ],
    [
      detection({
        detected_at: '2026-10-30T10:00:01Z',
        fix: fix({
          status: 'pr_open',
          updated_at: '2026-10-30T11:00:00Z',
          pr: {
            number: 7,
            url: 'https://github.com/acme/shop/pull/7',
            title: 'Fix Stripe 2.0.0',
            state: 'open',
            review_decision: null,
            head_sha: null,
            checked_at: null,
          },
        }),
      }),
      detection({ id: 'cr_00000000000f', watch_id: 'w_00000000000f' }),
    ],
  );
  expect(items.map((item) => [item.kind, item.title])).toEqual([
    ['fix', 'stripe fix: Pull request open'],
    ['detection', 'stripe 1.0.0 → 2.0.0: 1 breaking change'],
    ['changed', 'stripe 1.0.0 → 2.0.0: 1/2 breaking'],
    ['error', 'stripe: check failed'],
    ['baseline', 'stripe: baseline 1.0.0'],
    ['watch', 'Started watching stripe'],
  ]);
  expect(items[0].detail).toBe('#7 Fix Stripe 2.0.0');
  expect(items[3].detail).toBe('HTTP 500');
});
