import { existsSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { TEST_FILES, USAGES } from '../src/landing/FeatureVisuals';
import {
  DEMO_ASK,
  DEMO_DONE,
  DEMO_REPLY,
  DEMO_TOOLS,
  demoTimeline,
} from '../src/landing/HeroDemo';
import {
  APP_URL,
  DOTS,
  FEATURES,
  GITHUB_URL,
  Landing,
  PROBLEMS,
  REVEAL,
  staggerDelay,
  REQUIREMENTS,
  SAFETY,
  STEPS,
} from '../src/landing/Landing';
import {
  activeSection,
  NAV_LINKS,
  readingProgress,
  SECTION_ORDER,
} from '../src/landing/LandingNav';
import { nextTheme } from '../src/landing/ThemeToggle';
import { PHRASES, typingTimeline } from '../src/landing/TypedPhrase';

const html = renderToStaticMarkup(<Landing />);

it('opens the app from every "Get started" and "Open Hearth" button', () => {
  expect(APP_URL).toBe('/');
  const starts = html.match(/<a class="landing-button[^"]*" href="\/">/g);
  // Top bar, hero and closing call to action.
  expect(starts).toHaveLength(3);
});

it('leads with the API-change problem for developers', () => {
  // Screen readers get the headline whole; the typed copy beside it is hidden from them.
  const h1 = html.slice(html.indexOf('<h1>'), html.indexOf('</h1>') + 5);
  expect(h1.replace(/<[^>]+>/g, '')).toBe(
    'Stop finding out about API changesAPI changes in production.',
  );
  expect(h1).toContain('<span class="sr-only">API changes</span>');
  expect(h1).toContain('class="typed-phrase " aria-hidden="true">API changes');
  expect(html).toContain('For developers who depend on APIs');
  for (const item of PROBLEMS) expect(html).toContain(item.title);
});

it('has every section, each reachable from the top bar', () => {
  for (const id of SECTION_ORDER) expect(html).toContain(`id="${id}"`);
  for (const link of NAV_LINKS)
    expect(html).toContain(`href="#${link.id}">${link.label}</a>`);
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g))
    expect(html).toContain(`id="${id}"`);
  for (const item of [...STEPS, ...FEATURES, ...SAFETY, ...REQUIREMENTS])
    expect(html).toContain(item.title);
  expect(html).toContain('<footer class="landing-footer">');
});

it('sets expectations: what you need, and no API key', () => {
  expect(html).toContain('No API key needed');
  expect(html).toContain('Needs Docker');
  expect(html).toContain('wsl --install');
  expect(REQUIREMENTS.map((item) => item.title)).toEqual([
    'Docker Desktop',
    'A Claude account with Claude Code',
    'The Hearth repositories',
  ]);
});

it('opens outside links in a new tab without passing on the page', () => {
  const outside = [...html.matchAll(/<a [^>]*href="https:[^"]*"[^>]*>/g)];
  expect(outside.length).toBeGreaterThanOrEqual(3);
  for (const [link] of outside) {
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noreferrer"');
  }
  expect(html).toContain(`href="${GITHUB_URL}"`);
});

it('gives the mascots and the demo empty alt text so readers skip them', () => {
  for (const [img] of html.matchAll(/<img [^>]*>/g))
    expect(img).toContain('alt=""');
  expect(html).toContain('class="landing-preview" aria-hidden="true"');
});

it('shows the finished demo when it cannot play (no window, reduced motion)', () => {
  expect(html).toContain(DEMO_ASK);
  expect(html).toContain(DEMO_REPLY);
  for (const tool of DEMO_TOOLS) expect(html).toContain(tool);
  expect(html).toContain('Needs your review');
});

it('plays the demo in order: type the ask, work, show each tool, then wait for review', () => {
  const timeline = demoTimeline();
  const frames = timeline.map(([frame]) => frame);
  expect(frames[0]).toEqual({ typed: 0, stage: 0 });
  expect(frames.at(-1)).toEqual(DEMO_DONE);
  for (let i = 1; i < frames.length; i++) {
    expect(frames[i].typed).toBeGreaterThanOrEqual(frames[i - 1].typed);
    expect(frames[i].stage).toBeGreaterThanOrEqual(frames[i - 1].stage);
  }
  // Every tool gets its own frame before the end.
  expect(new Set(frames.map((frame) => frame.stage))).toEqual(
    new Set([0, 1, 2, 3, 4, 5]),
  );
  // One loop stays short enough to watch whole.
  const total = timeline.reduce((sum, [, wait]) => sum + wait, 0);
  expect(total).toBeGreaterThan(5000);
  expect(total).toBeLessThan(15000);
});

it('has a light/dark switch in the top bar that flips the theme', () => {
  const header = html.slice(0, html.indexOf('</header>'));
  // Rendered without a window, the page reads as light, so it offers dark.
  expect(header).toContain('class="theme-toggle"');
  expect(header).toContain('aria-label="Switch to dark mode"');
  expect(nextTheme('light')).toBe('dark');
  expect(nextTheme('dark')).toBe('light');
});

it('marks the section being read, and nothing above the first one', () => {
  const at = (tops: number[]) =>
    activeSection(SECTION_ORDER.map((id, index) => ({ id, top: tops[index] })));
  // Still in the hero: every section is below the reading line.
  expect(at([600, 1400, 2200, 3000, 3800, 4600])).toBeUndefined();
  expect(at([100, 900, 1700, 2500, 3300, 4100])).toBe('problem');
  expect(at([-2000, -1200, -400, 60, 900, 1700])).toBe('features');
  // Sections without a top-bar link (dots, features) clear the mark.
  expect(NAV_LINKS.map((link) => link.id)).not.toContain('features');
  // Nothing is marked before the page has measured itself.
  expect(html).not.toContain('aria-current');
});

it('alternates full-width bands with the plain canvas', () => {
  const bands = [
    ...html.matchAll(/<section id="([^"]+)" class="([^"]+)"/g),
  ].map(([, id, classes]) => [id, classes.includes('band')]);
  expect(bands).toEqual([
    ['problem', true],
    ['how', false],
    ['dots', true],
    ['features', false],
    ['safety', true],
    ['requirements', false],
  ]);
});

it('lays features out as a bento: two wide cards with drawings, first and last', () => {
  expect(html.match(/<article class="wide">/g)).toHaveLength(2);
  expect(FEATURES[0].visual).toBeTruthy();
  expect(FEATURES.at(-1)!.visual).toBeTruthy();
  expect(FEATURES.slice(1, -1).every((feature) => !feature.visual)).toBe(true);
});

it('keeps the drawings consistent with the hero demo', () => {
  const usages = USAGES.reduce((sum, usage) => sum + usage.count, 0);
  expect(DEMO_TOOLS[0]).toBe(
    `Found ${usages} usages in ${USAGES.length} files`,
  );
  const tests = TEST_FILES.reduce((sum, test) => sum + test.count, 0);
  expect(DEMO_TOOLS[2]).toBe(`Ran tests: ${tests} passed`);
  expect(html).toContain(`${usages} results in ${USAGES.length} files`);
  // The demo's vendor is the first Dot's.
  expect(DEMO_ASK).toContain(DOTS[0].vendor);
});

it('shows one Dot per vendor, each with a mascot that exists', () => {
  expect(new Set(DOTS.map((dot) => dot.vendor)).size).toBe(DOTS.length);
  for (const dot of DOTS) {
    expect(html).toContain(`<h3>${dot.name}</h3>`);
    expect(html).toContain(`Looks after <code>${dot.vendor}</code>`);
    expect(existsSync(`public/dots/${dot.mascot}.png`)).toBe(true);
  }
});

it('types each phrase out, holds it, erases it, then moves on', () => {
  const steps = typingTimeline();
  const first = PHRASES[0];
  // Types the first phrase a letter at a time, then holds it whole.
  expect(steps.slice(0, first.length).map(([shown]) => shown)).toEqual(
    [...first].map((_, index) => index + 1),
  );
  const held = steps[first.length - 1];
  expect(held[0]).toBe(first.length);
  expect(held[2]).toBeGreaterThan(1000);
  // Every phrase appears, in order, and each is fully erased before the next.
  expect([...new Set(steps.map(([, which]) => which))]).toEqual(
    PHRASES.map((_, index) => index),
  );
  for (let which = 0; which < PHRASES.length; which++) {
    const own = steps.filter(([, phrase]) => phrase === which);
    expect(Math.max(...own.map(([shown]) => shown))).toBe(
      PHRASES[which].length,
    );
    expect(own.at(-1)![0]).toBe(0);
  }
  // One full loop stays watchable.
  const total = steps.reduce((sum, [, , wait]) => sum + wait, 0);
  expect(total).toBeGreaterThan(8000);
  expect(total).toBeLessThan(20000);
});

it('reveals real parts of the page, in staggered order', () => {
  // Every kind of element the reveal looks for exists on the page.
  const classOf = (selector: string) =>
    selector.trim().split(' ')[0].replace('.', '');
  for (const selector of REVEAL.split(','))
    expect(html).toContain(`class="${classOf(selector)}`);
  expect(staggerDelay(0)).toBe('0ms');
  expect(staggerDelay(2)).toBe('160ms');
  // A long row starts its stagger over rather than waiting ever longer.
  expect(staggerDelay(6)).toBe('0ms');
});

it('fills the reading line from 0 to 1 as the page scrolls', () => {
  expect(readingProgress(0, 5000, 800)).toBe(0);
  expect(readingProgress(2100, 5000, 800)).toBe(0.5);
  expect(readingProgress(4200, 5000, 800)).toBe(1);
  // Overscroll and short pages stay in range.
  expect(readingProgress(9999, 5000, 800)).toBe(1);
  expect(readingProgress(-40, 5000, 800)).toBe(0);
  expect(readingProgress(0, 600, 800)).toBe(0);
});

it('gives the top bar a skip link, GitHub, and a closed phone menu', () => {
  const header = html.slice(0, html.indexOf('</header>'));
  expect(header).toContain(
    '<a class="skip-link" href="#top">Skip to content</a>',
  );
  expect(header).toContain('aria-label="Hearth on GitHub"');
  expect(header).toContain('aria-label="Open menu"');
  expect(header).toContain('aria-expanded="false"');
  expect(header).toContain('aria-controls="landing-menu"');
  // The menu holds every section link too, hidden until opened.
  const menu = header.slice(header.indexOf('id="landing-menu"'));
  expect(menu).toContain('hidden=""');
  for (const link of NAV_LINKS) expect(menu).toContain(`href="#${link.id}"`);
  expect(menu).toContain('Hearth on GitHub');
  // The reading line starts empty.
  expect(header).toContain('transform:scaleX(0)');
});
