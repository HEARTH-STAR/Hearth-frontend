import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { WorkspaceDialog } from '../src/client/WorkspaceDialog';
import type { WorkspaceState } from '../src/shared/types';

const workspace: WorkspaceState = {
  spaces: [],
  dots: [],
  conversations: [],
  setup: {
    backend: { url: 'http://127.0.0.1:5020', reachable: true, docker: true },
    missing: [],
  },
};

it('lets a new Dot pick its agent, Claude Code by default', () => {
  const html = renderToStaticMarkup(
    <WorkspaceDialog
      dialog={{ type: 'dot' }}
      state={{ settings: { name: 'Sagar', paused: false } }}
      workspace={workspace}
      onClose={() => {}}
      mutate={async () => false}
    />,
  );
  expect(html).toContain('<legend>Agent</legend>');
  for (const name of ['Claude Code', 'Cursor', 'Antigravity'])
    expect(html).toContain(`<span>${name}</span>`);
  expect(html).toMatch(/<input[^>]*checked=""[^>]*value="claude_code"/);
  expect(html).not.toMatch(/<input[^>]*checked=""[^>]*value="cursor"/);
  expect(html).toContain('sign in to Claude Code and connect GitHub');
});

it('keeps the settings dialog free of the agent picker', () => {
  const html = renderToStaticMarkup(
    <WorkspaceDialog
      dialog={{ type: 'settings' }}
      state={{ settings: { name: 'Sagar', paused: false } }}
      workspace={workspace}
      onClose={() => {}}
      mutate={async () => false}
    />,
  );
  expect(html).not.toContain('<legend>Agent</legend>');
});

it('shows the Account section in Settings only', () => {
  const render = (type: 'dot' | 'settings') =>
    renderToStaticMarkup(
      <WorkspaceDialog
        dialog={{ type }}
        state={{ settings: { name: 'Sagar', paused: false } }}
        workspace={workspace}
        onClose={() => {}}
        mutate={async () => false}
        account={<p>account section</p>}
      />,
    );
  expect(render('settings')).toContain('account section');
  expect(render('dot')).not.toContain('account section');
});
