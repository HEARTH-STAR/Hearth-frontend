import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { describeTool, outputNote, ToolRow } from '../src/client/ToolRow';
import { folderRelative, formatBytes, shortPath } from '../src/shared/paths';
const dir = 'dots/scout';
it('shortens paths inside the Dot folder and opens only those in Files', () => {
  expect(shortPath('wc -l /workspace/dots/scout/notes/a.md', dir)).toBe(
    'wc -l ~/notes/a.md',
  );
  expect(
    shortPath('C:\\Users\\me\\.hearth\\workspace\\dots\\scout\\a.md', dir),
  ).toBe('~/a.md');
  expect(shortPath('C:\\w\\dots\\scout\\notes\\a.md', dir)).toBe(
    '~/notes/a.md',
  );
  expect(shortPath('ls /w/dots/scout-2/a.md', dir)).toBe(
    'ls /w/dots/scout-2/a.md',
  );
  expect(shortPath('cd /workspace/dots/scout && ls', dir)).toBe('cd ~ && ls');
  expect(shortPath('/etc/hosts', dir)).toBe('/etc/hosts');
  expect(folderRelative('~/notes/a.md')).toBe('notes/a.md');
  expect(folderRelative('~/../x')).toBeNull();
  expect(folderRelative('/etc/hosts')).toBeNull();
  expect(formatBytes(2150)).toBe('2.1 KB');
});
it('reads like the conversation: saved file with size, command with its output', () => {
  const write = describeTool(
    'Write',
    {
      file_path: '/workspace/dots/scout/notes/acme.md',
      content: 'x'.repeat(2150),
    },
    '{"type":"create"}',
    dir,
  );
  expect(write).toMatchObject({
    verb: 'Saved file',
    target: '~/notes/acme.md',
    note: '2.1 KB',
    file: 'notes/acme.md',
  });
  const bash = describeTool(
    'Bash',
    { command: 'wc -l /workspace/dots/scout/notes/acme.md' },
    '{"stdout":"41 /workspace/dots/scout/notes/acme.md\\n","stderr":""}',
    dir,
  );
  expect(bash).toMatchObject({ verb: 'Ran', target: 'wc -l ~/notes/acme.md' });
  expect(outputNote('a\nb\n\nc')).toBe('3 lines');
  const denied = describeTool(
    'Write',
    { file_path: '/etc/x' },
    '{"denied":true,"reason":"path escapes the workspace"}',
    dir,
  );
  expect(denied).toMatchObject({
    denied: true,
    problem: 'path escapes the workspace',
  });
  expect(
    describeTool(
      'create_space_page',
      { title: 'Brief' },
      '{"title":"Brief","url":"/#/spaces/s/pages/p"}',
      dir,
    ),
  ).toMatchObject({
    verb: 'Created page',
    link: '/#/spaces/s/pages/p',
  });
});
it('renders a finished command row with its output folded away', () => {
  const html = renderToStaticMarkup(
    <ToolRow
      name="Bash"
      toolCallId="b1"
      status="complete"
      args={{ command: 'ls' }}
      result='{"stdout":"a.md\nb.md"}'
      directory={dir}
      running={false}
    />,
  );
  expect(html).toContain('Ran');
  expect(html).toContain('→ 2 lines');
  expect(html).toContain('<details>');
  const pending = renderToStaticMarkup(
    <ToolRow
      name="Bash"
      toolCallId="b2"
      status="executing"
      args={{ command: 'ls' }}
      directory={dir}
      running={false}
    />,
  );
  expect(pending).toContain('did not finish');
});
