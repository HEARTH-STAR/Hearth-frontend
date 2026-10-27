import { openPageLink } from './page-navigation';
import { SpaceWorkspace, type SpaceSection } from './SpaceWorkspace';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { CopilotKitProvider } from '@copilotkit/react-core/v2';
import { Menu, Monitor, SquarePen, X } from 'lucide-react';
import type { Conversation, Dot, State, WorkspaceState } from '../shared/types';
import { api, ApiError, authHeaders, setToken } from './api';
import {
  applyRefreshResult,
  dismissNotice,
  visibleNotice,
  type Notices,
} from './poll-notice';
import { Mascot } from './Mascot';
import { Chat, Composer, useDotFiles } from './Chat';
import { ChatStart, composerPlaceholder, focusBlank } from './ChatStart';
import { ComputerPanel } from './ComputerPanel';
import {
  clampComputerWidth,
  saveComputerWidth,
  savedComputerWidth,
} from './computer-size';
import { ConversationMenu } from './ConversationMenu';
import { DotHeader } from './DotHeader';
import { latestConversation, Sidebar } from './Sidebar';
import { WorkspaceDialog, type Dialog } from './WorkspaceDialog';

function describeFailure(error: unknown, fallback: string) {
  return {
    ok: false as const,
    status: error instanceof ApiError ? error.status : undefined,
    message: error instanceof Error ? error.message : fallback,
  };
}
export function App() {
  const [state, setState] = useState<State>();
  const [workspace, setWorkspace] = useState<WorkspaceState>();
  const [selectedDot, setSelectedDot] = useState('');
  const [selectedThread, setSelectedThread] = useState<string>();
  const [view, rawSetView] = useState<'chat' | 'space'>('chat');
  const dirtyPage = useRef(false);
  const [spaceId, setSpaceId] = useState('');
  const [section, setSection] = useState<SpaceSection>('pages');
  const [pageId, setPageId] = useState<string>();
  const setDirtyPage = useCallback((value: boolean) => {
    dirtyPage.current = value;
  }, []);
  const setView = (next: typeof view) => {
    if (dirtyPage.current && !window.confirm('Leave your unsaved page draft?'))
      return false;
    dirtyPage.current = false;
    if (next !== 'space')
      history.replaceState(null, '', location.pathname + location.search);
    rawSetView(next);
    return true;
  };
  useEffect(() => {
    let acceptedHash = location.hash;
    const navigate = () => {
      const match = location.hash.match(
        /^#\/spaces\/([^/]+)(?:\/pages\/([^/]+)|\/(setup))?$/,
      );
      if (!match) return;
      if (dirtyPage.current && location.hash === acceptedHash) return;
      if (
        dirtyPage.current &&
        !window.confirm('Leave your unsaved page draft?')
      ) {
        history.replaceState(null, '', acceptedHash || location.pathname);
        return;
      }
      acceptedHash = location.hash;
      dirtyPage.current = false;
      setSpaceId(match[1]);
      setPageId(match[2]);
      setSection(match[3] ? 'setup' : 'pages');
      rawSetView('space');
      setMobile(false);
    };
    navigate();
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  const openPage = (space: string, page?: string) => {
    openPageLink(`#/spaces/${space}${page ? `/pages/${page}` : ''}`);
  };
  /** Each Dot is a Space; its Setup page holds the container, Claude Code and GitHub. */
  const openSetup = (space: string) => openPageLink(`#/spaces/${space}/setup`);
  const [notices, setNotices] = useState<Notices>({
    refresh: '',
    capture: '',
    action: '',
  });
  const error = visibleNotice(notices);
  const setError = (action: string) =>
    setNotices((current) =>
      current.action === action ? current : { ...current, action },
    );
  const [auth, setAuth] = useState('');
  const [needsAuth, setNeedsAuth] = useState(false);
  const [dialog, setDialog] = useState<Dialog>();
  const [mobile, setMobile] = useState(false);
  // Beside the conversation on wide screens; on narrow ones it covers it, so it starts closed.
  const [computerOpen, setComputerOpen] = useState(
    () => window.matchMedia('(min-width: 1101px)').matches,
  );
  const [openFile, setOpenFile] = useState<{ path: string; at: number }>();
  const [computerWidth, setComputerWidth] = useState(() =>
    clampComputerWidth(savedComputerWidth(), window.innerWidth),
  );
  const [computerExpanded, setComputerExpanded] = useState(false);
  const resizeComputer = useCallback((width: number, done: boolean) => {
    const next = clampComputerWidth(width, window.innerWidth);
    setComputerWidth(next);
    if (done) saveComputerWidth(next);
  }, []);
  // A narrower window narrows the panel too, so the conversation keeps its room.
  useEffect(() => {
    const fit = () =>
      setComputerWidth((width) => clampComputerWidth(width, window.innerWidth));
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  const [turnsFinished, setTurnsFinished] = useState(0);
  const [prompt, setPrompt] = useState('');
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const loaded = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const [s, w] = await Promise.all([
        api<State>('/state'),
        api<WorkspaceState>('/workspace'),
      ]);
      setState(s);
      setWorkspace(w);
      setNeedsAuth(false);
      if (!loaded.current && w.dots[0]) {
        // Open where the owner left off: the first Dot's latest conversation.
        loaded.current = true;
        setSelectedDot(w.dots[0].id);
        setSelectedThread(
          latestConversation(w.conversations, w.dots[0].id)?.id,
        );
      }
      setNotices((current) => applyRefreshResult(current, { ok: true }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setNeedsAuth(true);
      setNotices((current) =>
        applyRefreshResult(
          current,
          describeFailure(e, 'Could not connect to the server.'),
        ),
      );
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  /** The saved value, or false when the request failed (its error shows in the banner). */
  const mutate = async (path: string, method: string, body?: unknown) => {
    setError('');
    try {
      const saved = await api<unknown>(path, method, body);
      await refresh();
      return saved ?? true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      return false;
    }
  };
  const turnFinished = useCallback(() => setTurnsFinished((n) => n + 1), []);
  const showFile = useCallback((path: string) => {
    setComputerOpen(true);
    setOpenFile({ path, at: Date.now() });
  }, []);
  const dot =
    workspace?.dots.find((item) => item.id === selectedDot) ??
    workspace?.dots[0];
  const thread = workspace?.conversations.find(
    (item) => item.id === selectedThread && item.dotId === dot?.id,
  );
  // A Dot runs in its home Space's container, with the Claude Code signed in there.
  const home = workspace?.spaces.find((space) => space.id === dot?.spaceId);
  const online = home?.stage === 'ready' && home.claude !== false;
  const loadFiles = useDotFiles(dot);
  const chooseDot = (next: Dot) => {
    if (!setView('chat')) return;
    setSelectedDot(next.id);
    setSelectedThread(
      workspace
        ? latestConversation(workspace.conversations, next.id)?.id
        : undefined,
    );
    setMobile(false);
    setPendingPrompt(undefined);
  };
  const newConversation = async (text?: string) => {
    if (!dot || busy) return;
    if (!text) {
      if (!setView('chat')) return;
      setSelectedThread(undefined);
      setMobile(false);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next = await api<Conversation>('/conversations', 'POST', {
        dotId: dot.id,
        title: text.slice(0, 80),
      });
      await refresh();
      setSelectedThread(next.id);
      setPendingPrompt(text);
      setPrompt('');
      setView('chat');
      setMobile(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not create the conversation.',
      );
    } finally {
      setBusy(false);
    }
  };
  if (needsAuth)
    return (
      <main className="unlock">
        <Mascot />
        <h1>Your own little corner.</h1>
        <p>Enter the owner access token configured on this Hearth server.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setToken(auth);
            try {
              await api('/state');
              setError('');
              await refresh();
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : 'Access token was not accepted.',
              );
            }
          }}
        >
          <input
            type="password"
            aria-label="Owner access token"
            autoComplete="current-password"
            value={auth}
            onChange={(e) => setAuth(e.target.value)}
            required
          />
          <button className="primary">Unlock Hearth</button>
        </form>
        {error && (
          <p className="chat-error" role="alert">
            {error}
          </p>
        )}
        <p className="muted">The token stays in this tab’s session storage.</p>
      </main>
    );
  if (!state || !workspace || !dot)
    return (
      <main className="unlock">
        <Mascot state="working" />
        <h1>Finding your dots…</h1>
        {error && (
          <>
            <p className="chat-error">{error}</p>
            <button onClick={() => void refresh()}>Retry</button>
          </>
        )}
      </main>
    );
  const paused = state.settings.paused;
  const dotConversations = workspace.conversations.filter(
    (item) => item.dotId === dot.id,
  );
  const conversationMenu = (
    <ConversationMenu
      conversations={dotConversations}
      selected={thread?.id}
      onSelect={(id) => setSelectedThread(id)}
      onNew={() => void newConversation()}
    />
  );
  // Starting over is one click from any conversation, not hidden in the history menu.
  const newConversationButton = (
    <button
      className="icon-button"
      aria-label="New conversation"
      title="New conversation"
      onClick={() => void newConversation()}
    >
      <SquarePen size={17} />
    </button>
  );
  const pickStarter = (text: string) => {
    setPrompt(text);
    requestAnimationFrame(() => focusBlank(promptInput.current, text));
  };
  const showComputer = view === 'chat' && computerOpen;
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      headers={authHeaders()}
      // CopilotKit's dev Inspector advertises cloud features Hearth does not use; opt in to debug.
      enableInspector={import.meta.env.VITE_COPILOTKIT_INSPECTOR === 'true'}
    >
      <div
        className={`hearth-app ${showComputer ? 'with-computer' : ''}`}
        style={{ '--computer-width': `${computerWidth}px` } as CSSProperties}
      >
        <button
          className="mobile-menu icon-button"
          aria-label="Open navigation"
          aria-expanded={mobile}
          aria-controls="workspace-sidebar"
          onClick={() => setMobile(true)}
        >
          <Menu size={20} />
        </button>
        {mobile && (
          <button
            className="nav-scrim"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          />
        )}
        <Sidebar
          workspace={workspace}
          open={mobile}
          search={search}
          activeDot={
            view === 'chat'
              ? dot.id
              : workspace.dots.find((item) => item.spaceId === spaceId)?.id
          }
          onSearch={setSearch}
          onDot={chooseDot}
          onCreateDot={() => setDialog({ type: 'dot' })}
          onSetup={openSetup}
          onPages={(id) => openPage(id)}
          onSettings={() => setDialog({ type: 'settings' })}
        />
        <div className="main">
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setNotices((current) => dismissNotice(current))}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {paused && (
            <div className="notice">
              All Dots are paused. Resume them in Settings.
            </div>
          )}
          {view === 'space' ? (
            <SpaceWorkspace
              key={`${spaceId}:${section}`}
              section={section}
              space={
                workspace.spaces.find((s) => s.id === spaceId) ??
                workspace.spaces[0]
              }
              pageId={pageId}
              workspace={workspace}
              paused={paused}
              onPage={(id) => openPage(spaceId, id)}
              onCreateDot={() => setDialog({ type: 'dot' })}
              onDirty={setDirtyPage}
              onRefresh={refresh}
              onThread={(id) => {
                const target = workspace.conversations.find((t) => t.id === id);
                if (target && setView('chat')) {
                  setSelectedDot(target.dotId);
                  setSelectedThread(id);
                }
              }}
            />
          ) : thread ? (
            <Chat
              key={thread.id}
              thread={thread}
              dot={dot}
              spaces={workspace.spaces}
              online={online}
              initialPrompt={pendingPrompt}
              onConsumed={() => setPendingPrompt(undefined)}
              paused={paused}
              computerOpen={computerOpen}
              headerActions={
                <>
                  {newConversationButton}
                  {conversationMenu}
                </>
              }
              onSaved={refresh}
              onComputer={() => setComputerOpen(!computerOpen)}
              onOpenFile={showFile}
              onTurnFinished={turnFinished}
            />
          ) : (
            <div className="chat">
              <DotHeader
                dot={dot}
                online={online}
                title="New conversation"
                state={paused ? 'paused' : 'idle'}
              >
                {conversationMenu}
                <button
                  className={`icon-button ${computerOpen ? 'active' : ''}`}
                  aria-label={computerOpen ? 'Hide computer' : 'Show computer'}
                  aria-pressed={computerOpen}
                  onClick={() => setComputerOpen(!computerOpen)}
                >
                  <Monitor size={17} />
                </button>
              </DotHeader>
              <div className="chat-scroll">
                <div className="chat-column">
                  <ChatStart
                    dot={dot}
                    space={home}
                    online={online}
                    paused={paused}
                    onPick={pickStarter}
                  />
                </div>
              </div>
              <div className="chat-dock">
                <Composer
                  inputRef={promptInput}
                  value={prompt}
                  onChange={setPrompt}
                  placeholder={composerPlaceholder({
                    name: dot.name,
                    paused,
                    online,
                    started: false,
                  })}
                  disabled={paused || !online || busy}
                  onSubmit={() => void newConversation(prompt)}
                  name={dot.name}
                  loadFiles={loadFiles}
                  onOpenFiles={() => setComputerOpen(true)}
                />
              </div>
            </div>
          )}
        </div>
        {showComputer && (
          <ComputerPanel
            key={dot.id}
            dot={dot}
            openFile={openFile}
            turnsFinished={turnsFinished}
            width={computerWidth}
            expanded={computerExpanded}
            onResize={resizeComputer}
            onExpand={setComputerExpanded}
            onClose={() => {
              setComputerExpanded(false);
              setComputerOpen(false);
            }}
          />
        )}
        {dialog && (
          <WorkspaceDialog
            dialog={dialog}
            state={state}
            workspace={workspace}
            onClose={() => setDialog(undefined)}
            onDotCreated={(created) => openSetup(created.spaceId)}
            mutate={mutate}
          />
        )}
      </div>
    </CopilotKitProvider>
  );
}
