import { openPageLink } from './page-navigation';
import { Fragment, memo, type ReactNode } from 'react';
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

export function ChatTranscript({
  messages,
  renderTools,
}: {
  messages: Message[];
  renderTools?: (message: AssistantMessage) => ReactNode;
}) {
  return (
    <>
      {messages.map((message) => (
        <Fragment key={message.id}>
          {typeof message.content === 'string' && message.content.trim() && (
            <Bubble role={message.role} content={message.content} />
          )}
          {message.role === 'assistant' && renderTools?.(message)}
        </Fragment>
      ))}
    </>
  );
}
