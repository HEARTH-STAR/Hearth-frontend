import { PageReviewCard } from './PageReviewCard';
import { pageReviewSchema, pageReviewTool } from '../shared/page-review';
import { contextualMessage, type PageContext } from './page-context';
import { api } from './api';
import type { Page } from '../server/pages';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { agentOf } from '../shared/agents';
import { describeError, elapsed } from './chat-errors';
import { SavePageDialog } from './SavePageDialog';
import type { WorkspaceListing } from '../shared/computer-types';
import { dotFiles, insertReference } from './file-reference';
import { FilePicker } from './FilePicker';
import {
  CopilotChatToolCallsView,
  useRenderTool,
  useHumanInTheLoop,
  useAgent,
  useCopilotKit,
} from '@copilotkit/react-core/v2';
import {
  ArrowDown,
  ArrowUp,
  FilePlus,
  Monitor,
  Plus,
  Square,
  X,
} from 'lucide-react';
import { ToolRow, type ToolRenderProps } from './ToolRow';
import { ChatTranscript, messageTimes } from './ChatTranscript';
import type { Conversation, Dot, Space } from '../shared/types';
import { DotHeader } from './DotHeader';
import { shouldSubmitComposerOnKeyDown } from './chat-composer';
import { useStickToBottom } from './chat-scroll';
import {
  ChatStart,
  composerHint,
  composerPlaceholder,
  focusBlank,
  SetupCard,
} from './ChatStart';
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
  besideComputer,
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
  /** Buttons shown right before the computer button (API watch). */
  besideComputer?: ReactNode;
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
  const [showDetails, setShowDetails] = useState(false);
  const [savingPage, setSavingPage] = useState(false);
  /** The owner's last message as typed, so Retry sends it again exactly. */
  const lastSent = useRef('');
  const [turns, setTurns] = useState<{ asked: number; replied?: number }[]>([]);
  const loadTimes = useCallback(() => {
    void api<{ asked: number; replied?: number }[]>(
      `/conversations/${thread.id}/times`,
    )
      .then(setTurns)
      .catch(() => {});
  }, [thread.id]);
  const sent = useRef(false);
  const { scroller, content, away, jump } = useStickToBottom();
  const input = useRef<HTMLTextAreaElement>(null);
  const loadFiles = useDotFiles(dot);
  const space = spaces.find((item) => item.id === dot.spaceId);
  /** A starter fills the composer, with its first [blank] selected for typing over. */
  const pickStarter = (text: string) => {
    setDraft(text);
    requestAnimationFrame(() => focusBlank(input.current, text));
  };
  const finished = useRef(onTurnFinished);
  finished.current = onTurnFinished;
  const timesChanged = useRef(loadTimes);
  timesChanged.current = loadTimes;
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
        timesChanged.current?.();
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
        if (active) {
          setLoaded(true);
          loadTimes();
        }
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
  }, [agent, copilotkit, isReady, loadTimes]);
  const send = async (text: string) => {
    if (!text.trim() || running || !loaded || !contextReady || paused) return;
    setError('');
    setShowDetails(false);
    lastSent.current = text;
    setRunning(true);
    agent.addMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: contextualMessage(text, pageContext),
    });
    setDraft('');
    // Your own message brings you back to the end, following the reply.
    jump();
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
  const stop = useCallback(
    () => copilotkit.stopAgent({ agent }),
    [copilotkit, agent],
  );
  const seconds = useWorkingSeconds(working && agent.isRunning);
  // Escape stops a running reply, unless it is closing a menu, the file picker or a dialog.
  useEffect(() => {
    if (!working) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[role="menu"], [role="dialog"]')) return;
      stop();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [working, stop]);
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
            dotName={dot.name}
          />
        ),
    },
    [dot.directory, dot.name, agent.isRunning, onOpenFile],
  );
  const visible = agent.messages.filter(
    (message) =>
      ['user', 'assistant'].includes(message.role) &&
      ((typeof message.content === 'string' && message.content.trim()) ||
        (message.role === 'assistant' && message.toolCalls?.length)),
  );
  const times = useMemo(() => messageTimes(visible, turns), [visible, turns]);
  /** What Retry sends: the last message as typed here, else the last one in the conversation. */
  const retryText =
    lastSent.current ||
    String(
      visible.findLast((message) => message.role === 'user')?.content ?? '',
    );
  const problem = error
    ? describeError(error, { dot: dot.name, agent: agentOf(space).name })
    : undefined;
  return (
    <div className="chat">
      <DotHeader
        dot={dot}
        online={online}
        title={thread.title}
        state={paused ? 'paused' : working ? 'working' : 'idle'}
      >
        {headerActions}
        <button
          className="icon-button"
          aria-label="Save conversation as page"
          title="Save conversation as page"
          disabled={working}
          onClick={() => setSavingPage(true)}
        >
          <FilePlus size={17} />
        </button>
        {besideComputer}
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
      <div className="chat-scroll" ref={scroller}>
        <div className="chat-column" ref={content}>
          {!visible.length && (
            <ChatStart
              dot={dot}
              space={space}
              online={online}
              paused={paused}
              onPick={pickStarter}
            />
          )}
          <ChatTranscript
            messages={visible}
            times={times}
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
                <span className="thinking-time"> · {elapsed(seconds)}</span>
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="chat-dock">
        {away && visible.length > 0 && (
          <button type="button" className="jump-latest" onClick={jump}>
            <ArrowDown size={14} aria-hidden="true" /> Jump to latest
          </button>
        )}
        {!online && !paused && visible.length > 0 && (
          <SetupCard dot={dot} space={space} compact />
        )}
        {contextError && (
          <div className="chat-error" role="alert">
            {contextError}
            <button onClick={() => setContextAttempt((value) => value + 1)}>
              Retry context
            </button>
          </div>
        )}
        {problem && (
          <div className="chat-error friendly" role="alert">
            <div className="chat-error-text">
              <strong>{problem.title}</strong>
              {problem.hint && <span>{problem.hint}</span>}
              {showDetails && <pre>{problem.detail}</pre>}
            </div>
            <div className="chat-error-actions">
              {loaded && retryText.trim() && !working && (
                <button
                  className="primary"
                  onClick={() => void send(retryText)}
                >
                  Retry
                </button>
              )}
              {!loaded && (
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
              )}
              {problem.setup && (
                <a className="button" href={`#/spaces/${dot.spaceId}/setup`}>
                  Open Setup
                </a>
              )}
              <button
                className="text-button"
                aria-expanded={showDetails}
                onClick={() => setShowDetails(!showDetails)}
              >
                {showDetails ? 'Hide details' : 'Show details'}
              </button>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError('')}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}
        <Composer
          inputRef={input}
          value={draft}
          onChange={setDraft}
          placeholder={composerPlaceholder({
            name: dot.name,
            paused,
            online,
            started: visible.length > 0,
          })}
          disabled={!loaded || !contextReady || paused || !online}
          running={working}
          onStop={stop}
          onSubmit={() => void send(draft)}
          name={dot.name}
          loadFiles={loadFiles}
          onOpenFiles={onComputer}
        />
      </div>
      {savingPage && (
        <SavePageDialog
          initialTitle={thread.title}
          onClose={() => setSavingPage(false)}
          onSave={async (title) => {
            const page = await api<Page>(
              `/conversations/${thread.id}/page`,
              'POST',
              { title },
            );
            setSavingPage(false);
            location.hash = `/spaces/${page.spaceId}/pages/${page.id}`;
          }}
        />
      )}
    </div>
  );
}

/** Whole seconds since ``active`` turned true, ticking once a second; 0 when not active. */
function useWorkingSeconds(active: boolean) {
  const [startedAt, setStartedAt] = useState<number>();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      setStartedAt(undefined);
      return;
    }
    const start = Date.now();
    setStartedAt(start);
    setNow(start);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return startedAt === undefined ? 0 : (now - startedAt) / 1000;
}
/** The Dot's files for the composer's "+", relative to its folder. Stable per Dot. */
export function useDotFiles(dot: Dot | undefined) {
  const id = dot?.id;
  const directory = dot?.directory;
  return useCallback(async () => {
    if (!id || !directory) return [];
    return dotFiles(
      await api<WorkspaceListing>(
        `/dots/${encodeURIComponent(id)}/computer/files`,
      ),
      directory,
    );
  }, [id, directory]);
}

export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  running = false,
  onStop,
  name = 'Dot',
  loadFiles,
  onOpenFiles,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  disabled: boolean;
  running?: boolean;
  onStop?: () => void;
  /** The Dot's name, for the file picker. */
  name?: string;
  /** With it, "+" picks a file to reference as @path. */
  loadFiles?: () => Promise<string[]>;
  /** Opens the Computer panel's Files tab (from the picker, or "+" without loadFiles). */
  onOpenFiles?: () => void;
  inputRef?: Ref<HTMLTextAreaElement>;
}) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  const setInput = (element: HTMLTextAreaElement | null) => {
    own.current = element;
    if (typeof inputRef === 'function') inputRef(element);
    else if (inputRef)
      (inputRef as { current: HTMLTextAreaElement | null }).current = element;
  };
  const [picking, setPicking] = useState(false);
  const closePicker = useCallback(() => {
    setPicking(false);
    own.current?.focus();
  }, []);
  /** Put @path where the cursor was (or over the selection), then type on after it. */
  const pick = (path: string) => {
    const input = own.current;
    const next = insertReference(
      value,
      input?.selectionStart ?? value.length,
      input?.selectionEnd ?? value.length,
      path,
    );
    onChange(next.value);
    setPicking(false);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(next.cursor, next.cursor);
    });
  };
  const off = disabled && !running;
  const limit = 8000;
  return (
    <>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim() && !disabled && !running) onSubmit();
        }}
      >
        {picking && loadFiles && (
          <FilePicker
            name={name}
            load={loadFiles}
            onPick={pick}
            onClose={closePicker}
            onOpenFiles={onOpenFiles}
          />
        )}
        {(loadFiles || onOpenFiles) && (
          <button
            type="button"
            className={`composer-plus ${picking ? 'active' : ''}`}
            aria-label={loadFiles ? 'Reference a file' : 'Open the Files panel'}
            aria-expanded={loadFiles ? picking : undefined}
            title={loadFiles ? 'Reference a file' : 'Files'}
            disabled={off}
            onClick={() => (loadFiles ? setPicking(!picking) : onOpenFiles?.())}
          >
            <Plus size={18} />
          </button>
        )}
        <textarea
          ref={setInput}
          aria-label="Message"
          aria-describedby="composer-hint"
          placeholder={placeholder}
          rows={1}
          value={value}
          maxLength={limit}
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
      <p className="composer-hint" id="composer-hint">
        <span>{composerHint({ running, files: !!loadFiles })}</span>
        {value.length > limit - 1000 && (
          <span className="composer-count">
            {value.length.toLocaleString()} / {limit.toLocaleString()}
          </span>
        )}
      </p>
    </>
  );
}
