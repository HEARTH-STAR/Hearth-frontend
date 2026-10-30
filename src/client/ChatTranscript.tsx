import { openPageLink } from './page-navigation';
import { Check, Copy } from 'lucide-react';
import { Fragment, memo, useEffect, useState, type ReactNode } from 'react';
import { messageTime } from './chat-errors';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AssistantMessage, Message } from '@ag-ui/core';
import { CodeCard } from './CodeCard';
import { remarkReplySections } from './reply-sections';

const components: Components = {
  img: ({ alt }) => <span>{alt}</span>,
  // Wide tables scroll sideways instead of squeezing words apart.
  table: ({ children }) => (
    <div className="chat-table">
      <table>{children}</table>
    </div>
  ),
  a: ({ href, children }) => (
    <a
      onClick={(event) => {
        if (href?.startsWith('/#/spaces/')) {
          event.preventDefault();
          openPageLink(href);
        }
      }}
      href={href}
      target={href?.startsWith('/#/spaces/') ? undefined : '_blank'}
      rel="noreferrer"
    >
      {children}
    </a>
  ),
};
// A Dot's replies: each heading's section is a card, and code blocks are cards with a Copy button.
const replyComponents: Components = {
  ...components,
  pre: ({ node, children }) => <CodeCard node={node}>{children}</CodeCard>,
};
const userPlugins = [remarkGfm];
const replyPlugins = [remarkGfm, remarkReplySections];

/**
 * One message's Markdown. Memoized on its text: while a reply streams, the messages above it keep
 * their rendering instead of being parsed again on every token.
 */
const Bubble = memo(function Bubble({
  role,
  content,
}: {
  role: Message['role'];
  content: string;
}) {
  const reply = role === 'assistant';
  return (
    <div className={`chat-bubble ${role}`}>
      <ReactMarkdown
        remarkPlugins={reply ? replyPlugins : userPlugins}
        components={reply ? replyComponents : components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

/** Under a message, on hover: when it was sent, and Copy. */
function MessageMeta({
  role,
  text,
  at,
}: {
  role: Message['role'];
  text: string;
  at?: number;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className={`message-meta ${role}`}>
      {at !== undefined && (
        <time
          dateTime={new Date(at).toISOString()}
          title={new Date(at).toLocaleString()}
        >
          {messageTime(at)}
        </time>
      )}
      <button
        type="button"
        className="message-copy"
        aria-label={copied ? 'Copied' : 'Copy message'}
        title={copied ? 'Copied' : 'Copy'}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(text)
            .then(() => setCopied(true))
            .catch(() => {});
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}

export function ChatTranscript({
  messages,
  renderTools,
  times,
}: {
  messages: Message[];
  renderTools?: (message: AssistantMessage) => ReactNode;
  /** When a message was sent, by message id (see ``messageTimes``). */
  times?: ReadonlyMap<string, number>;
}) {
  return (
    <>
      {messages.map((message) => (
        <Fragment key={message.id}>
          {typeof message.content === 'string' && message.content.trim() && (
            <>
              <Bubble role={message.role} content={message.content} />
              <MessageMeta
                role={message.role}
                text={message.content}
                at={times?.get(message.id)}
              />
            </>
          )}
          {message.role === 'assistant' && renderTools?.(message)}
        </Fragment>
      ))}
    </>
  );
}

/**
 * Matches the server's turn times to the conversation's messages: each of the owner's messages gets
 * its turn's ``asked`` time and the turn's last written reply its ``replied`` time. The turns line up
 * from the newest backwards, so older messages from before times were kept simply show none.
 */
export function messageTimes(
  messages: Message[],
  turns: { asked: number; replied?: number }[],
): Map<string, number> {
  const times = new Map<string, number>();
  const starts = messages.flatMap((message, index) =>
    message.role === 'user' ? [index] : [],
  );
  const offset = starts.length - turns.length;
  starts.forEach((start, n) => {
    const turn = turns[n - offset];
    if (!turn) return;
    times.set(messages[start].id, turn.asked);
    if (turn.replied === undefined) return;
    const end = starts[n + 1] ?? messages.length;
    for (let index = end - 1; index > start; index--) {
      const reply = messages[index];
      if (
        reply.role === 'assistant' &&
        typeof reply.content === 'string' &&
        reply.content.trim()
      ) {
        times.set(reply.id, turn.replied);
        break;
      }
    }
  });
  return times;
}
