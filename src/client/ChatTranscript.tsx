import { openPageLink } from './page-navigation';
import { Fragment, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AssistantMessage, Message } from '@ag-ui/core';
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
            <div className={`chat-bubble ${message.role}`}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  img: ({ alt }) => <span>{alt}</span>,
                  a: ({ href, children }) => (
                    <a
                      onClick={(event) => {
                        if (href?.startsWith('/#/spaces/')) {
                          event.preventDefault();
                          openPageLink(href);
                        }
                      }}
                      href={href}
                      target={
                        href?.startsWith('/#/spaces/') ? undefined : '_blank'
                      }
                      rel="noreferrer"
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {String(message.content)}
              </ReactMarkdown>
            </div>
          )}
          {message.role === 'assistant' && renderTools?.(message)}
        </Fragment>
      ))}
    </>
  );
}
