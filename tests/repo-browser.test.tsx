import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { RepoHeader, RepoTabs } from '../src/client/RepoBrowser';
import { ChangeMap, ChangeMix, RepoPulls } from '../src/client/RepoWatch';
import { repoHash } from '../src/client/repo-view';
import type { RepoSummary } from '../src/shared/repo-types';
import type { ApiChange, DetectionSummary } from '../src/shared/watch-types';

const summary: RepoSummary = {
  repo: 'acme/shop',
  description: 'The shop’s storefront',
  html_url: 'https://github.com/acme/shop',
  clone_url: 'https://github.com/acme/shop.git',
  ssh_url: 'git@github.com:acme/shop.git',
  default_branch: 'main',
  ref: 'main',
  commit: 'a'.repeat(40),
  branch_count: 3,
  size_bytes: 1.2 * 1024 * 1024,
  head: {
    sha: 'a'.repeat(40),
    short: 'aaaaaaa',
    subject: 'Ship it',
    author: 'Ada Lovelace',
    date: new Date(Date.now() - 10 * 3600_000).toISOString(),
  },
  fetched_at: new Date().toISOString(),
};
const link = (next: object) =>
  repoHash({
    spaceId: 's1',
    owner: 'acme',
    name: 'shop',
    tab: 'files',
    ...next,
  });

it('shows the repo header: owner, name, description, clone, and its meta', () => {
  const html = renderToStaticMarkup(
    <RepoHeader owner="acme" name="shop" summary={summary} watched={2} />,
  );
  expect(html).toContain('class="repo-owner">acme<');
  expect(html).toContain('>shop</a></h1>');
  expect(html).toContain('The shop’s storefront');
  expect(html).toContain('Clone');
  expect(html).toContain('<code>main</code>');
  expect(html).toContain('1.2 MB');
  expect(html).toContain('Updated 10 hours ago by Ada Lovelace');
  expect(html).toContain('2 APIs watched');
  expect(html).not.toMatch(/people/i);
});

it('has every tab but People, the active one marked, with the counts', () => {
  const html = renderToStaticMarkup(
    <RepoTabs active="code" link={link} pulls={3} breaking={1} />,
  );
  for (const label of [
    'Files',
    'Code',
    'Commits',
    'Branches',
    'Activity',
    'Pull requests',
    'API diff',
  ])
    expect(html).toContain(`${label}<`);
  expect(html).not.toMatch(/people/i);
  expect(html).toContain(
    'href="#/spaces/s1/repos/acme/shop/code" class="active" aria-current="page"',
  );
  expect(html).toContain('href="#/spaces/s1/repos/acme/shop"');
  expect(html).toMatch(/Pull requests<span class="repo-count">3</);
  expect(html).toMatch(/API diff<span class="repo-count alert">1</);
});

it('draws the change mix and the change map by resource', () => {
  const change = (over: Partial<ApiChange>): ApiChange => ({
    type: 'param_removed',
    symbol: 'POST /v1/payment_intents/{}/confirm',
    kind: 'operation',
    before: 'confirm(intent, source)',
    after: 'confirm(intent)',
    detail: 'source',
    renamed_to: null,
    breaking: true,
    description: 'Removed parameter source',
    ...over,
  });
  const changes = [
    change({}),
    change({ type: 'added', symbol: 'GET /v1/refunds', breaking: false }),
    change({ type: 'deprecated', symbol: 'schema:Card', breaking: false }),
  ];
  const mix = renderToStaticMarkup(<ChangeMix changes={changes} />);
  expect(mix).toContain('aria-label="1 breaking, 1 additive, 1 deprecated"');
  expect(mix).toContain('3 total');
  const map = renderToStaticMarkup(<ChangeMap changes={changes} />);
  expect(map.indexOf('payment_intents')).toBeLessThan(map.indexOf('refunds'));
  expect(map).toContain('<code>Schemas</code>');
  expect(map).toContain('class="repo-change breaking"');
  expect(map).toContain('class="repo-change additive"');
  expect(map).toContain('title="confirm(intent, source)"');
});

it('explains where pull requests come from before there are any', () => {
  const html = renderToStaticMarkup(
    <RepoPulls
      spaceId="s1"
      detections={[] as DetectionSummary[]}
      link={link}
      onChanged={() => {}}
    />,
  );
  expect(html).toContain('When a watched API breaks');
});
