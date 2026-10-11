import { expect, it } from 'vitest';
import {
  editorStyles,
  highlight,
  HIGHLIGHT_LIMIT,
  languageFor,
} from '../src/client/code-view';

it('picks Shiki’s language from the file name', () => {
  expect(languageFor('hearth-core/server.py')).toBe('python');
  expect(languageFor('src/client/App.tsx')).toBe('tsx');
  expect(languageFor('templates/space/Dockerfile')).toBe('dockerfile');
  expect(languageFor('hearth-core/.env.example')).toBe('dotenv');
  expect(languageFor('notes/README.MD')).toBe('markdown');
  expect(languageFor('LICENSE')).toBe('text');
  expect(languageFor('archive.tar.gz')).toBe('text');
});

it('takes the editor’s colors from Pierre Dark', () => {
  expect(editorStyles['--code-bg']).toBe('#0a0a0a');
  expect(editorStyles['--code-sidebar']).toBe('#171717');
});

it('highlights code, and leaves plain or huge files plain', async () => {
  const html = await highlight('def hello():\n    return "<b>"\n', 'a.py');
  expect(html).toContain('class="shiki');
  expect(html).toContain('class="line"');
  expect(html).toContain('&#x3C;b>'); // the text is escaped
  expect(await highlight('just words', 'LICENSE')).toBeNull();
  expect(await highlight('x'.repeat(HIGHLIGHT_LIMIT + 1), 'a.py')).toBeNull();
});
