import { createElement } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { Sidebar } from '../src/client/Sidebar';
import type { WorkspaceState } from '../src/shared/types';

// The menu listens on document for outside clicks and Escape; tests run without a DOM.
vi.stubGlobal('document', {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});
afterEach(() => vi.clearAllMocks());

const workspace: WorkspaceState = {
  spaces: [
    {
      id: 'space-1',
      name: 'Scout',
      description: '',
      createdAt: 0,
      pageCount: 3,
      container: 'hearth-container-everyday',
      stage: 'ready',
      claude: false,
    },
  ],
  dots: [
    {
      id: 'dot-1',
      spaceId: 'space-1',
      spaceIds: ['space-1'],
      name: 'Scout',
      instructions: 'Be concise',
      directory: 'dots/scout',
      createdAt: 0,
    },
  ],
  conversations: [],
  setup: {
    backend: { url: 'http://backend.test', reachable: true },
    missing: [],
  },
};
const text = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === 'string' ? child : text(child)))
    .join('');

it('lists Dots only, and opens a Dot’s Space Setup and Pages from its menu', () => {
  const calls = {
    onSetup: vi.fn(),
    onPages: vi.fn(),
  };
  let root!: ReturnType<typeof create>;
  act(() => {
    root = create(
      createElement(Sidebar, {
        workspace,
        open: false,
        search: '',
        activeDot: 'dot-1',
        onSearch: vi.fn(),
        onDot: vi.fn(),
        onCreateDot: vi.fn(),
        onSettings: vi.fn(),
        ...calls,
      }),
    );
  });
  const labels = root.root
    .findAll((node) => node.props.className === 'nav-label')
    .map(text);
  expect(labels).toEqual(['DOTS']);
  const toggle = root.root.findByProps({ 'aria-label': 'Scout options' });
  expect(root.root.findAllByProps({ role: 'menu' })).toHaveLength(0);
  act(() => toggle.props.onClick());
  const items = () => root.root.findAllByProps({ role: 'menuitem' });
  expect(items().map(text)).toEqual(['SetupSign in to Claude', 'Pages3']);
  act(() => items()[0].props.onClick());
  expect(calls.onSetup).toHaveBeenCalledWith('space-1');
  expect(root.root.findAllByProps({ role: 'menu' })).toHaveLength(0);
  act(() => toggle.props.onClick());
  act(() => items()[1].props.onClick());
  expect(calls.onPages).toHaveBeenCalledWith('space-1');
});

it('spins up a new Dot from the + next to Hearth', () => {
  const onCreateDot = vi.fn();
  let root!: ReturnType<typeof create>;
  act(() => {
    root = create(
      createElement(Sidebar, {
        workspace,
        open: false,
        search: '',
        onSearch: vi.fn(),
        onDot: vi.fn(),
        onCreateDot,
        onSetup: vi.fn(),
        onPages: vi.fn(),
        onSettings: vi.fn(),
      }),
    );
  });
  const plus = root.root.findByProps({ 'aria-label': 'New Dot' });
  expect(plus.props.title).toMatch(/its own container/);
  act(() => plus.props.onClick());
  expect(onCreateDot).toHaveBeenCalledTimes(1);
  expect(
    root.root.findAllByProps({ 'aria-label': 'New conversation' }),
  ).toEqual([]);
});

it('takes the Hearth logo to the landing page', () => {
  let root!: ReturnType<typeof create>;
  act(() => {
    root = create(
      createElement(Sidebar, {
        workspace,
        open: false,
        search: '',
        onSearch: vi.fn(),
        onDot: vi.fn(),
        onCreateDot: vi.fn(),
        onSetup: vi.fn(),
        onPages: vi.fn(),
        onSettings: vi.fn(),
      }),
    );
  });
  const brand = root.root.findByProps({ className: 'brand' });
  expect(brand.type).toBe('a');
  expect(brand.props.href).toBe('/welcome/');
  expect(text(brand)).toBe('Hearth');
});
