import { renderToStaticMarkup } from 'react-dom/server';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@ag-ui/core';
import {
  blockedReason,
  describeError,
  elapsed,
  messageTime,
} from '../src/client/chat-errors';
import { ChatTranscript, messageTimes } from '../src/client/ChatTranscript';
import { ConversationMenu } from '../src/client/ConversationMenu';
import { ToolRow } from '../src/client/ToolRow';
import type { Conversation } from '../src/shared/types';

const who = { dot: 'Dora', agent: 'Antigravity' };

describe('friendlier errors (#1)', () => {
  it('turns the errors seen in practice into plain sentences, keeping the original', () => {
    const model = describeError(
      'agy exited with code 1 without an answer: error: invalid model selection (--model "Gemini 3.5 Flash (Low)")',
      who,
    );
    expect(model.title).toBe(
      'Dora couldn’t reply: the AI model it asked Antigravity for isn’t available on this account.',
    );
    expect(model.detail).toContain('invalid model selection');
    expect(model.setup).toBe(false);

    const signin = describeError('Antigravity is not signed in.', who);
    expect(signin.title).toBe('Dora isn’t signed in to Antigravity.');
    expect(signin.setup).toBe(true);

    expect(describeError('Antigravity CLI not found (agy).', who).setup).toBe(
      true,
    );
    expect(
      describeError('connect ECONNREFUSED 127.0.0.1:61564', who).title,
    ).toBe('Couldn’t reach Dora’s computer.');
    expect(describeError('429 Too Many Requests', who).title).toContain(
      'usage limit',
    );
    expect(describeError('Request timed out', who).title).toBe(
      'Dora took too long to answer.',
    );
  });

  it('falls back to a general sentence for anything unknown', () => {
    const other = describeError('Something odd happened', who);
    expect(other.title).toBe('Dora couldn’t finish that reply.');
    expect(other.detail).toBe('Something odd happened');
  });
});

describe('blocked commands (#3)', () => {
  it('reads Hearth-Core’s switch reasons as the Dot’s settings', () => {
    expect(
      blockedReason(
        'shell commands are switched off for this conversation',
        'Dora',
      ),
    ).toBe('Running commands is off for Dora, so Hearth blocked this.');
    expect(
      blockedReason('tool Bash is switched off for this conversation', 'Scout'),
    ).toBe('Running commands is off for Scout, so Hearth blocked this.');
    expect(
      blockedReason(
        'file edits are switched off for this conversation',
        'Dora',
      ),
    ).toBe('Editing files is off for Dora, so Hearth blocked this.');
    // Any other policy reason stays as Hearth-Core gave it.
    expect(blockedReason('network tools are not allowed', 'Dora')).toBe(
      'network tools are not allowed',
    );
    expect(blockedReason(undefined, 'Dora')).toBe('Blocked by policy.');
  });

  it('shows the explanation on a blocked tool row', () => {
    const html = renderToStaticMarkup(
      <ToolRow
        name="Bash"
        toolCallId="t1"
        status="complete"
        args={{ command: 'npm test' }}
        result={JSON.stringify({
          denied: true,
          reason: 'shell commands are switched off for this conversation',
        })}
        directory="dots/dora"
        running={false}
        dotName="Dora"
      />,
    );
    expect(html).toContain(
      'Running commands is off for Dora, so Hearth blocked this.',
    );
  });
});

describe('copy and times (#4, #5)', () => {
  const messages: Message[] = [
    { id: 'u1', role: 'user', content: 'old question' },
    { id: 'a1', role: 'assistant', content: 'old answer' },
    { id: 'u2', role: 'user', content: 'Fix it' },
    { id: 'a2', role: 'assistant', content: 'Looking…' },
    { id: 'a3', role: 'assistant', content: 'Fixed.' },
    { id: 'u3', role: 'user', content: 'Thanks' },
  ];

  it('matches turn times from the newest backwards, reply time on the turn’s last text', () => {
    // Only the last two turns have saved times; the first predates them.
    const times = messageTimes(messages, [
      { asked: 1000, replied: 2000 },
      { asked: 3000 },
    ]);
    expect(times.get('u2')).toBe(1000);
    expect(times.get('a3')).toBe(2000);
    expect(times.has('a2')).toBe(false);
    expect(times.get('u3')).toBe(3000);
    expect(times.has('u1')).toBe(false);
    expect(times.has('a1')).toBe(false);
  });

  it('shows a time and Copy under each message', () => {
    const at = new Date(2026, 9, 29, 16, 12).getTime();
    const html = renderToStaticMarkup(
      <ChatTranscript
        messages={[{ id: 'u', role: 'user', content: 'hello' }]}
        times={new Map([['u', at]])}
      />,
    );
    expect(html).toContain('<div class="message-meta user">');
    expect(html).toContain('<time');
    expect(html).toContain('aria-label="Copy message"');
  });

  it('writes times the way the sidebar does', () => {
    const now = new Date(2026, 9, 29, 18, 0).getTime();
    expect(messageTime(new Date(2026, 9, 29, 16, 12).getTime(), now)).toMatch(
      /4:12/,
    );
    expect(messageTime(new Date(2026, 9, 27, 9, 5).getTime(), now)).toMatch(
      /9:05/,
    );
    expect(messageTime(new Date(2026, 8, 3, 9, 5).getTime(), now)).toMatch(/,/);
  });
});

describe('working timer (#6)', () => {
  it('counts minutes and seconds', () => {
    expect(elapsed(0)).toBe('0:00');
    expect(elapsed(42.9)).toBe('0:42');
    expect(elapsed(725)).toBe('12:05');
    expect(elapsed(-3)).toBe('0:00');
  });
});

describe('composer hint (#7)', () => {
  it('says how to send, or how to stop', async () => {
    const { composerHint } = await import('../src/client/ChatStart');
    expect(composerHint({ running: false, files: true })).toBe(
      'Enter to send · Shift+Enter for a new line · + to reference a file',
    );
    expect(composerHint({ running: false, files: false })).toBe(
      'Enter to send · Shift+Enter for a new line',
    );
    expect(composerHint({ running: true, files: true })).toBe('Esc to stop');
  });
});

describe('conversations menu (#8)', () => {
  it('renames in place and deletes only after a confirm', async () => {
    // The menu listens on document for outside clicks and Escape; tests run without a DOM.
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const conversation: Conversation = {
      id: 'c1',
      dotId: 'd1',
      ownerId: 'o',
      title: 'Upgrade acme-pay',
      createdAt: 0,
      updatedAt: 0,
      preview: '',
    };
    const onRename = vi.fn(async () => {});
    const onDelete = vi.fn(async () => {});
    let root!: ReturnType<typeof create>;
    act(() => {
      root = create(
        <ConversationMenu
          conversations={[conversation]}
          onSelect={() => {}}
          onNew={() => {}}
          onRename={onRename}
          onDelete={onDelete}
        />,
      );
    });
    const by = (label: string) =>
      root.root.findByProps({ 'aria-label': label });
    act(() => by('Conversations').props.onClick());

    // Rename: the title becomes an input; saving sends the new title.
    act(() => by('Rename Upgrade acme-pay').props.onClick());
    act(() =>
      by('Conversation title').props.onChange({
        target: { value: 'Upgrade to v4' },
      }),
    );
    const form = root.root.findByProps({
      className: 'conversation-row editing',
    });
    await act(async () => form.props.onSubmit({ preventDefault() {} }));
    expect(onRename).toHaveBeenCalledWith('c1', 'Upgrade to v4');

    // Delete: the trash asks first; nothing is deleted until "Delete" is pressed.
    act(() => by('Delete Upgrade acme-pay').props.onClick());
    expect(onDelete).not.toHaveBeenCalled();
    const confirm = root.root.findByProps({ className: 'danger' });
    await act(async () => confirm.props.onClick());
    expect(onDelete).toHaveBeenCalledWith('c1');
    vi.unstubAllGlobals();
  });

  it('shows why a delete was refused, in the row', async () => {
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const conversation: Conversation = {
      id: 'p1',
      dotId: 'd1',
      ownerId: 'o',
      title: 'Page chat',
      createdAt: 0,
      updatedAt: 0,
      preview: '',
    };
    let root!: ReturnType<typeof create>;
    act(() => {
      root = create(
        <ConversationMenu
          conversations={[conversation]}
          onSelect={() => {}}
          onNew={() => {}}
          onDelete={async () => {
            throw new Error(
              'A page’s conversation stays with its page. Rename it instead.',
            );
          }}
        />,
      );
    });
    const by = (label: string) =>
      root.root.findByProps({ 'aria-label': label });
    act(() => by('Conversations').props.onClick());
    act(() => by('Delete Page chat').props.onClick());
    await act(async () =>
      root.root.findByProps({ className: 'danger' }).props.onClick(),
    );
    const error = root.root.findByProps({
      className: 'conversation-row-error',
    });
    expect(error.children.join('')).toContain('stays with its page');
    vi.unstubAllGlobals();
  });
});
