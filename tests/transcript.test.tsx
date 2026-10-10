import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatTranscript } from '../src/client/ChatTranscript';
it('renders tool-only assistant messages inline between chat turns without printing tool JSON', () => {
  const html = renderToStaticMarkup(
    <ChatTranscript
      messages={[
        { id: 'request', role: 'user', content: 'Save my notes' },
        {
          id: 'tool-call',
          role: 'assistant',
          toolCalls: [
            {
              id: 'write',
              type: 'function',
              function: {
                name: 'Write',
                arguments: '{"file_path":"/workspace/dots/scout/notes.md"}',
              },
            },
          ],
        },
        { id: 'reply', role: 'assistant', content: 'Here is the summary' },
      ]}
      renderTools={(message) =>
        message.toolCalls?.length ? <section>Inline tool row</section> : null
      }
    />,
  );
  expect(html.indexOf('Save my notes')).toBeLessThan(
    html.indexOf('Inline tool row'),
  );
  expect(html.indexOf('Inline tool row')).toBeLessThan(
    html.indexOf('Here is the summary'),
  );
  expect(html).not.toContain('undefined');
  expect(html).not.toContain('file_path');
});
it('renders user and assistant Markdown with their bubble roles', () => {
  const html = renderToStaticMarkup(
    <ChatTranscript
      messages={[
        { id: 'manual', role: 'user', content: 'Manual request' },
        {
          id: 'answer',
          role: 'assistant',
          content: '**Done** — [Brief](/#/spaces/s/pages/p)',
        },
      ]}
    />,
  );
  expect(html).toContain(
    '<div class="chat-bubble user"><p>Manual request</p></div>',
  );
  expect(html).toContain('chat-bubble assistant');
  expect(html).toContain('<strong>Done</strong>');
  expect(html).toContain('href="/#/spaces/s/pages/p"');
});
