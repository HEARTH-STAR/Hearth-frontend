import { PageReviewCard } from './PageReviewCard';
import { pageReviewSchema, pageReviewTool } from '../shared/page-review';
import { contextualMessage, type PageContext } from './page-context';
import { api } from './api';
import type { Page } from '../server/pages';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CopilotChatToolCallsView,
  useRenderTool,
  useHumanInTheLoop,
  useAgent,
  useCopilotKit,
} from '@copilotkit/react-core/v2';
import { ArrowUp, FilePlus, Monitor, Plus, Square } from 'lucide-react';
import { ToolRow, type ToolRenderProps } from './ToolRow';
import { ChatTranscript } from './ChatTranscript';
import type { Conversation, Dot, Space } from '../shared/types';
import { DotHeader } from './DotHeader';
import { shouldSubmitComposerOnKeyDown } from './chat-composer';
/** Matches the server's ``ACTIVITY_EVENT``: what the agent is doing right now. */
const ACTIVITY_EVENT = 'hearth.activity';
export function Chat({
  thread,
  dot,
  spaces,
  online,
  initialPrompt,
  onConsumed,
  paused,
  computerOpen,
  headerActions,
  onSaved,
  onComputer,
  onOpenFile,
  onTurnFinished,
}: {
  thread: Conversation;
  dot: Dot;
  spaces: Space[];
  /** Hearth-Core answers: the Dot's computer is running. */
  online: boolean;
  initialPrompt?: string;
  onConsumed: () => void;
  paused: boolean;
  computerOpen?: boolean;
  /** Extra header buttons, such as the conversation picker. */
  headerActions?: ReactNode;
  onSaved: () => void;
  onComputer?: () => void;
  onOpenFile?: (path: string) => void;
  onTurnFinished?: () => void;
}) {
  const { agent, isReady } = useAgent({
    agentId: `chat-${thread.id}`,
    runtimeAgentId: dot.id,
    threadId: thread.id,
  });
  const { copilotkit } = useCopilotKit();
  const [pageContext, setPageContext] = useState<PageContext | null>();
  const [contextError, setContextError] = useState('');
  const [contextAttempt, setContextAttempt] = useState(0);
  const contextReady = pageContext !== undefined;
  useEffect(() => {
    let active = true;
    setPageContext(undefined);
    setContextError('');
    void api<PageContext | null>(
      `/conversations/${thread.id}/page-context`,
      'GET',
      undefined,
      AbortSignal.timeout(10000),
    )
      .then((page) => {
        if (active) setPageContext(page);
      })
      .catch(() => {
        if (active)
          setContextError(
            'Conversation context could not load. Retry before sending your message.',
          );
      });
    return () => {
      active = false;
    };
  }, [thread.id, contextAttempt]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [activity, setActivity] = useState('');
  const sent = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  const finished = useRef(onTurnFinished);
  finished.current = onTurnFinished;
  // Connecting replays the conversation, including errors of earlier turns; only new ones show.
  const live = useRef(false);
  useEffect(() => {
    const subscription = copilotkit.subscribe({
      onError: ({ error }) => {
        if (live.current) setError(error.message);
      },
    });
    const events = agent.subscribe({
      onRunErrorEvent: ({ event }) => {
        if (live.current) setError(event.message);
      },
      onCustomEvent: ({ event }) => {
        if (event.name === ACTIVITY_EVENT) {
          const value = event.value as { label?: unknown } | undefined;
          setActivity(typeof value?.label === 'string' ? value.label : '');
        }
      },
      onRunFinalized: () => {
        setActivity('');
        finished.current?.();
      },
    });
    return () => {
      subscription.unsubscribe();
      events.unsubscribe();
    };
  }, [agent, copilotkit]);
  useEffect(() => {
    if (!isReady) return;
    let active = true;
    live.current = false;
    void copilotkit
      .connectAgent({ agent })
      .then(() => {
        live.current = true;
        if (active) setLoaded(true);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : 'Conversation could not connect.',
          );
      });
    return () => {
      active = false;
    };
  }, [agent, copilotkit, isReady]);
  const send = async (text: string) => {
    if (!text.trim() || running || !loaded || !contextReady || paused) return;
    setError('');
    setRunning(true);
    agent.addMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: contextualMessage(text, pageContext),
    });
    setDraft('');
    try {
      await copilotkit.runAgent({ agent });
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'The turn failed. Your conversation remains saved.',
      );
    } finally {
      setRunning(false);
    }
  };
  useEffect(() => {
    if (loaded && contextReady && !paused && initialPrompt && !sent.current) {
      sent.current = true;
      onConsumed();
      void send(initialPrompt);
    }
  }, [loaded, contextReady, paused, initialPrompt]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
  }, [agent.messages.length, running, activity]);
  useHumanInTheLoop(
    {
      name: pageReviewTool.name,
      description: pageReviewTool.description,
      parameters: pageReviewSchema,
      render: (props) => (
        <PageReviewCard
          {...props}
          threadId={thread.id}
          spaces={spaces}
          onSaved={onSaved}
        />
      ),
    },
    [thread.id, spaces, onSaved],
  );
  const working = running || agent.isRunning;
  useRenderTool(
    {
      name: '*',
      render: (props: ToolRenderProps) =>
        props.name === pageReviewTool.name ? null : (
          <ToolRow
            {...props}
            directory={dot.directory}
            running={agent.isRunning}
            onOpenFile={onOpenFile}
          />
        ),
    },
    [dot.directory, agent.isRunning, onOpenFile],
  );
  const visible = agent.messages.filter(
    (message) =>
      ['user', 'assistant'].includes(message.role) &&
      ((typeof message.content === 'string' && message.content.trim()) ||
        (message.role === 'assistant' && message.toolCalls?.length)),
  );
  return (
    <div className="chat">
      <DotHeader
        dot={dot}
        online={online}
        state={paused ? 'paused' : working ? 'working' : 'idle'}
      >
        {headerActions}
        <button
          className="icon-button"
          aria-label="Save conversation as page"
          title="Save conversation as page"
          disabled={working}
          onClick={async () => {
            const title = window.prompt('Page title', thread.title);
            if (!title) return;
            try {
              const page = await api<Page>(
                `/conversations/${thread.id}/page`,
                'POST',
                { title },
              );
              location.hash = `/spaces/${page.spaceId}/pages/${page.id}`;
            } catch (e) {
              setError(
                e instanceof Error ? e.message : 'Could not save conversation.',
              );
            }
          }}
        >
          <FilePlus size={17} />
        </button>
        {onComputer && (
          <button
            className={`icon-button ${computerOpen ? 'active' : ''}`}
            aria-label={computerOpen ? 'Hide computer' : 'Show computer'}
            aria-pressed={!!computerOpen}
            title="Computer"
            onClick={onComputer}
          >
            <Monitor size={17} />
          </button>
        )}
      </DotHeader>
      {pageContext && (
        <div className="page-chat-context">
          Working on{' '}
          <a href={`/#/spaces/${pageContext.spaceId}/pages/${pageContext.id}`}>
            {pageContext.title}
          </a>
        </div>
      )}
      <div className="chat-scroll">
        <div className="chat-column">
          {!visible.length && (
            <div className="chat-welcome">
              <h2>What should {dot.name} work on?</h2>
              <p>{dot.instructions}</p>
            </div>
          )}
          <ChatTranscript
            messages={visible}
            renderTools={(message) => (
              <CopilotChatToolCallsView
                message={message}
                messages={agent.messages}
              />
            )}
          />
          {working && agent.isRunning && (
            <div className="thinking" role="status">
              <span />
              <span />
              <span />
              <span>
                {dot.name} is {activity || 'thinking'}
              </span>
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>
      <div className="chat-dock">
        {contextError && (
          <div className="chat-error" role="alert">
            {contextError}
            <button onClick={() => setContextAttempt((value) => value + 1)}>
              Retry context
            </button>
          </div>
        )}
        {error && (
          <div className="chat-error" role="alert">
            {error}
            <button
              onClick={() => {
                setError('');
                void copilotkit
                  .connectAgent({ agent })
                  .then(() => setLoaded(true))
                  .catch((e) => setError(e.message));
              }}
            >
              Reconnect
            </button>
          </div>
        )}
        <Composer
          value={draft}
          onChange={setDraft}
          placeholder={paused ? 'All Dots are paused' : 'Ask anything'}
          disabled={!loaded || !contextReady || paused}
          running={working}
          onStop={() => copilotkit.stopAgent({ agent })}
          onSubmit={() => void send(draft)}
          onAttach={onComputer}
        />
      </div>
    </div>
  );
}
export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  running = false,
  onStop,
  onAttach,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  disabled: boolean;
  running?: boolean;
  onStop?: () => void;
  onAttach?: () => void;
}) {
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim() && !disabled && !running) onSubmit();
      }}
    >
      {onAttach && (
        <button
          type="button"
          className="composer-plus"
          aria-label="Open the computer's files"
          title="Files"
          onClick={onAttach}
        >
          <Plus size={18} />
        </button>
      )}
      <textarea
        aria-label="Message"
        placeholder={placeholder}
        rows={1}
        value={value}
        maxLength={8000}
        disabled={disabled && !running}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (shouldSubmitComposerOnKeyDown(e)) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      {running && onStop ? (
        <button
          type="button"
          className="send-button"
          aria-label="Stop response"
          onClick={onStop}
        >
          <Square size={13} />
        </button>
      ) : (
        <button
          className="send-button"
          aria-label="Send message"
          disabled={!value.trim() || disabled}
        >
          <ArrowUp size={17} />
        </button>
      )}
    </form>
  );
}
