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
it('sets each section of a reply in a card, with code cards and framed tables', () => {
  const reply = [
    'An agent harness wraps a model.',
    '',
    '## The core loop',
    '',
    '```python',
    'reply = model(context, tools)',
    '```',
    '',
    'Most of a harness supports this loop.',
    '',
    '### A detail',
    '',
    'Still inside the first card.',
    '',
    '## Main components',
    '',
    '| Component | What it does |',
    '| --- | --- |',
    '| Tools | Runs the calls |',
  ].join('\n');
  const html = renderToStaticMarkup(
    <ChatTranscript
      messages={[
        { id: 'ask', role: 'user', content: '## Not a card\n\n```\ncode\n```' },
        { id: 'reply', role: 'assistant', content: reply },
      ]}
    />,
  );
  const reply_ = html.slice(html.indexOf('chat-bubble assistant'));
  // the intro stays plain, before the first card
  expect(reply_.indexOf('An agent harness')).toBeLessThan(
    reply_.indexOf('reply-card'),
  );
  expect(reply_.match(/<section class="reply-card">/g)).toHaveLength(2);
  expect(reply_).toMatch(
    /<section class="reply-card"><h2>The core loop<\/h2>[\s\S]*Still inside the first card[\s\S]*<\/section>\s*<section class="reply-card"><h2>Main components<\/h2>/,
  );
  expect(reply_).toContain('<div class="code-card-head"><span>python</span>');
  expect(reply_).toContain('aria-label="Copy code"');
  expect(reply_).toContain('<div class="chat-table"><table>');
  // the owner's own messages stay as they are
  const ask = html.slice(0, html.indexOf('chat-bubble assistant'));
  expect(ask).not.toContain('reply-card');
  expect(ask).not.toContain('code-card');
});
it('sets a reply without sections in one untitled card', () => {
  const html = renderToStaticMarkup(
    <ChatTranscript
      messages={[{ id: 'r', role: 'assistant', content: 'Just a sentence.' }]}
    />,
  );
  expect(
    html.startsWith(
      '<div class="chat-bubble assistant"><section class="reply-card whole"><p>Just a sentence.</p></section></div>',
    ),
  ).toBe(true);
  // Then the hover row: Copy, and no time for a message the server has none for.
  expect(html).toContain('<div class="message-meta assistant">');
  expect(html).toContain('aria-label="Copy message"');
  expect(html).not.toContain('<time');
});
it('reads a code block’s language and text for the Copy button', async () => {
  const { languageOf, textOf } = await import('../src/client/CodeCard');
  const pre = {
    type: 'element' as const,
    tagName: 'pre',
    properties: {},
    children: [
      {
        type: 'element' as const,
        tagName: 'code',
        properties: { className: ['language-ts'] },
        children: [{ type: 'text' as const, value: 'const a = 1;\n' }],
      },
    ],
  };
  expect(languageOf(pre)).toBe('ts');
  expect(textOf(pre)).toBe('const a = 1;\n');
  expect(languageOf({ ...pre, children: [] })).toBeNull();
});

it('turns bold title lines into cards when a reply has no headings', () => {
  const render = (content: string) =>
    renderToStaticMarkup(
      <ChatTranscript messages={[{ id: 'r', role: 'assistant', content }]} />,
    );
  const titled = render(
    'Two parts.\n\n**First part**\n\nOne.\n\n**Second part:**\n\nTwo.',
  );
  expect(titled.match(/<section class="reply-card"><h2>/g)).toHaveLength(2);
  expect(titled).toContain('<h2>First part</h2><p>One.</p>');
  expect(titled).toContain('<h2>Second part</h2><p>Two.</p>');
  // one bold line is emphasis, not structure; bold inside a sentence is never a title:
  // those replies are one untitled card
  for (const content of [
    '**Note**\n\nJust this.',
    '**A** starts this.\n\n**B** starts that.\n\nEnd.',
  ]) {
    const html = render(content);
    expect(html.match(/class="reply-card whole"/g)).toHaveLength(1);
    expect(html).not.toContain('<h2>');
  }
});
