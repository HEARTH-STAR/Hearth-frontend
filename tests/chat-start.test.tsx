import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import {
  ChatStart,
  composerPlaceholder,
  focusBlank,
  SetupCard,
  setupSteps,
  starterSelection,
  STARTERS,
} from '../src/client/ChatStart';
import { isNearBottom } from '../src/client/chat-scroll';
import { DotHeader, dotStatus } from '../src/client/DotHeader';
import type { Dot, Space } from '../src/shared/types';

const dot: Dot = {
  id: 'dot-1',
  spaceId: 'space-1',
  spaceIds: ['space-1'],
  name: 'Scout',
  instructions: 'Be concise',
  directory: 'dots/scout',
  createdAt: 0,
};
const space = (stage: Space['stage'], claude: boolean | null): Space => ({
  id: 'space-1',
  name: 'Scout',
  description: '',
  createdAt: 0,
  pageCount: 0,
  container: 'hearth-container-scout',
  stage,
  claude,
});

// 1. Following the conversation
it('counts as "at the bottom" only within a short distance of the end', () => {
  const box = { scrollHeight: 2000, clientHeight: 600 };
  expect(isNearBottom({ ...box, scrollTop: 1400 })).toBe(true);
  expect(isNearBottom({ ...box, scrollTop: 1330 })).toBe(true);
  expect(isNearBottom({ ...box, scrollTop: 1200 })).toBe(false);
  expect(
    isNearBottom({ scrollHeight: 300, clientHeight: 600, scrollTop: 0 }),
  ).toBe(true);
});

// 2. A Dot that is not ready
it('lists what setup is left, step by step', () => {
  expect(setupSteps(space('missing', null))).toEqual([
    { label: 'Container', detail: 'Container missing', state: 'todo' },
    { label: 'Claude Code', detail: 'Waits for the container', state: 'todo' },
  ]);
  expect(setupSteps(space('creating', null))[0].state).toBe('working');
  expect(setupSteps(space('ready', false))).toEqual([
    { label: 'Container', detail: 'Running', state: 'done' },
    { label: 'Claude Code', detail: 'Sign in needed', state: 'todo' },
  ]);
  expect(setupSteps(undefined)[0].detail).toBe('Not started');
});

it('links the setup card and strip to the Dot’s Setup page', () => {
  const card = renderToStaticMarkup(
    <SetupCard dot={dot} space={space('ready', false)} />,
  );
  expect(card).toContain('Finish setting up Scout');
  expect(card).toContain('href="#/spaces/space-1/setup"');
  const strip = renderToStaticMarkup(
    <SetupCard dot={dot} space={space('ready', false)} compact />,
  );
  expect(strip).toContain('claude code sign in needed');
  expect(strip).toContain('href="#/spaces/space-1/setup"');
  expect(strip).not.toContain('container running');
});

// 3. Starting points
it('shows starters when the Dot is ready, and the setup card when it is not', () => {
  const ready = renderToStaticMarkup(
    <ChatStart
      dot={dot}
      space={space('ready', true)}
      online
      paused={false}
      onPick={() => {}}
    />,
  );
  expect(ready).toContain('What should Scout work on?');
  for (const starter of STARTERS) expect(ready).toContain(starter.label);
  expect(ready).not.toContain('Finish setting up');
  const notReady = renderToStaticMarkup(
    <ChatStart
      dot={dot}
      space={space('missing', null)}
      online={false}
      paused={false}
      onPick={() => {}}
    />,
  );
  expect(notReady).toContain('Finish setting up Scout');
  expect(notReady).not.toContain('Upgrade an SDK');
});

it('selects each starter’s first [blank] so typing replaces it', () => {
  for (const starter of STARTERS) {
    const [start, end] = starterSelection(starter.text);
    expect(starter.text[start]).toBe('[');
    expect(starter.text[end - 1]).toBe(']');
  }
  expect(starterSelection('No blanks here')).toEqual([14, 14]);
  const input = { focus: vi.fn(), setSelectionRange: vi.fn() };
  focusBlank(input as unknown as HTMLTextAreaElement, 'Upgrade [SDK] now');
  expect(input.focus).toHaveBeenCalled();
  expect(input.setSelectionRange).toHaveBeenCalledWith(8, 13);
  expect(() => focusBlank(null, 'x')).not.toThrow();
});

it('invites a first ask, a reply, or explains why the composer is off', () => {
  const base = { name: 'Scout', paused: false, online: true, started: false };
  expect(composerPlaceholder(base)).toBe('Which API or SDK changed?');
  expect(composerPlaceholder({ ...base, started: true })).toBe('Message Scout');
  expect(composerPlaceholder({ ...base, online: false })).toBe(
    'Finish Scout’s setup to start',
  );
  expect(composerPlaceholder({ ...base, paused: true, online: false })).toBe(
    'All Dots are paused',
  );
});

// 4. The header
it('says where the Dot stands, paused and working first', () => {
  expect(dotStatus('idle', true).label).toBe('Ready');
  expect(dotStatus('idle', false).label).toBe('Needs setup');
  expect(dotStatus('working', true).label).toBe('Working…');
  expect(dotStatus('paused', false).label).toBe('Paused');
});

it('shows the status and the conversation title under the name', () => {
  const html = renderToStaticMarkup(
    <DotHeader dot={dot} online title="Upgrade acme-pay to v4" />,
  );
  expect(html).toContain('<strong>Scout</strong>');
  expect(html).toContain('class="dot-status ready" role="status">Ready');
  expect(html).toContain('Upgrade acme-pay to v4');
  const untitled = renderToStaticMarkup(<DotHeader dot={dot} online={false} />);
  expect(untitled).toContain('Needs setup');
  expect(untitled).not.toContain('dot-header-title');
});
