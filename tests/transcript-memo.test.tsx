import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import type { Message } from '@ag-ui/core';

// Count how often each message's Markdown is rendered.
const renders = vi.hoisted(() => new Map<string, number>());
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => {
    renders.set(children, (renders.get(children) ?? 0) + 1);
    return null;
  },
}));
import { ChatTranscript } from '../src/client/ChatTranscript';

it('renders earlier messages once while a reply streams in', () => {
  const history: Message[] = [
    { id: 'u1', role: 'user', content: 'First question' },
    { id: 'a1', role: 'assistant', content: '## A long earlier answer' },
  ];
  const view = (live: string) =>
    createElement(ChatTranscript, {
      messages: [...history, { id: 'a2', role: 'assistant', content: live }],
    });
  let root!: ReturnType<typeof create>;
  act(() => {
    root = create(view('Hel'));
  });
  for (const live of ['Hello', 'Hello the', 'Hello there'])
    act(() => root.update(view(live)));
  expect(renders.get('First question')).toBe(1);
  expect(renders.get('## A long earlier answer')).toBe(1);
  expect(renders.get('Hello there')).toBe(1);
  expect(renders.get('Hel')).toBe(1);
});
