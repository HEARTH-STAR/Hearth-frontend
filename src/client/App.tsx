import { openPageLink } from './page-navigation';
import { SpaceWorkspace } from './SpaceWorkspace';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CopilotKitProvider } from '@copilotkit/react-core/v2';
import { ArrowUpRight, Menu, Monitor, MoreHorizontal, X } from 'lucide-react';
import type { Conversation, Dot, State, WorkspaceState } from '../shared/types';
import { api, ApiError, authHeaders, setToken } from './api';
import {
  applyRefreshResult,
  dismissNotice,
  visibleNotice,
  type Notices,
} from './poll-notice';
import { Mascot } from './Mascot';
import { Chat, Composer } from './Chat';
import { ComputerPanel } from './ComputerPanel';
import { ConversationMenu } from './ConversationMenu';
import { DotHeader } from './DotHeader';
import { MemoryView } from './MemoryView';
import { latestConversation, Sidebar } from './Sidebar';
import { dotPayload, WorkspaceDialog, type Dialog } from './WorkspaceDialog';

function describeFailure(error: unknown, fallback: string) {
  return {
    ok: false as const,
    status: error instanceof ApiError ? error.status : undefined,
    message: error instanceof Error ? error.message : fallback,
  };
}
const STARTERS = [
  'Summarize what is in your folder',
  'Draft notes I can review before saving',
  'Make a plan I can follow',
];
export function App() {
  const [state, setState] = useState<State>();
  const [workspace, setWorkspace] = useState<WorkspaceState>();
  const [selectedDot, setSelectedDot] = useState('');
  const [selectedThread, setSelectedThread] = useState<string>();
  const [view, rawSetView] = useState<'chat' | 'memory' | 'space'>('chat');
  const dirtyPage = useRef(false);
  const [spaceId, setSpaceId] = useState('');
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
        /^#\/spaces\/([^/]+)(?:\/pages\/([^/]+))?$/,
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
  const [turnsFinished, setTurnsFinished] = useState(0);
  const [prompt, setPrompt] = useState('');
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
  const mutate = async (path: string, method: string, body?: unknown) => {
    setError('');
    try {
      await api(path, method, body);
      await refresh();
      return true;
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
  const online = !!workspace?.setup.core.reachable;
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
  const showComputer = view === 'chat' && computerOpen;
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" headers={authHeaders()}>
      <div className={`hearth-app ${showComputer ? 'with-computer' : ''}`}>
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
          settings={state.settings}
          open={mobile}
          search={search}
          activeDot={view === 'chat' ? dot.id : undefined}
          activeSpace={view === 'space' ? spaceId : undefined}
          memoryActive={view === 'memory'}
          onSearch={setSearch}
          onNew={() => void newConversation()}
          onDot={chooseDot}
          onEditDot={(item) =>
            setDialog({ type: 'dot', dot: item, spaceId: item.spaceId })
          }
          onCreateDot={() =>
            setDialog({ type: 'dot', spaceId: workspace.spaces[0].id })
          }
          onSpace={(id) => openPage(id)}
          onCreateSpace={() => setDialog({ type: 'space' })}
          onMemory={() => {
            if (setView('memory')) setMobile(false);
          }}
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
          {!online && view === 'chat' && (
            <div className="notice">
              Hearth-Core is not answering at{' '}
              <code>{workspace.setup.core.url}</code>, so Dots cannot run. Start
              it with <code>./hearth-core.sh dev</code>, or set{' '}
              <code>HEARTH_CORE_URL</code>.
            </div>
          )}
          {view === 'space' ? (
            <SpaceWorkspace
              key={spaceId}
              space={
                workspace.spaces.find((s) => s.id === spaceId) ??
                workspace.spaces[0]
              }
              pageId={pageId}
              workspace={workspace}
              paused={paused}
              onPage={(id) => openPage(spaceId, id)}
              onSettings={() => setDialog({ type: 'settings' })}
              onCreateDot={() => setDialog({ type: 'dot', spaceId })}
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
          ) : view === 'memory' ? (
            <MemoryView
              memories={state.memories}
              settings={state.settings}
              onAdd={() => setDialog({ type: 'memory' })}
              onEdit={(memory) => setDialog({ type: 'memory', memory })}
              onDelete={(memory) =>
                void mutate(`/memories/${memory.id}`, 'DELETE', {})
              }
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
              headerActions={conversationMenu}
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
                state={paused ? 'paused' : 'idle'}
                status={
                  paused
                    ? 'paused'
                    : online
                      ? 'computer running'
                      : 'computer offline'
                }
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
                <div className="chat-column new-conversation">
                  <Mascot
                    identity={dot.id}
                    name={dot.name}
                    state={paused ? 'paused' : 'idle'}
                  />
                  <h2>{dot.name}</h2>
                  {dot.role && <span className="new-role">{dot.role}</span>}
                  <p>{dot.instructions}</p>
                  <button
                    className="text-button"
                    onClick={() =>
                      setDialog({ type: 'dot', dot, spaceId: dot.spaceId })
                    }
                  >
                    Edit specialist <MoreHorizontal size={14} />
                  </button>
                  <div className="starter-suggestions">
                    {STARTERS.map((text) => (
                      <button
                        key={text}
                        disabled={paused || !online}
                        onClick={() => setPrompt(text)}
                      >
                        {text}
                        <ArrowUpRight size={12} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="chat-dock">
                <Composer
                  value={prompt}
                  onChange={setPrompt}
                  placeholder={
                    paused
                      ? 'All Dots are paused'
                      : online
                        ? `Ask ${dot.name} anything`
                        : 'Waiting for Hearth-Core…'
                  }
                  disabled={paused || !online || busy}
                  onSubmit={() => void newConversation(prompt)}
                  onAttach={() => setComputerOpen(true)}
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
            onToggleMemory={async (allowed) => {
              await mutate(
                `/dots/${dot.id}`,
                'PUT',
                dotPayload(dot, { memoryAllowed: allowed }),
              );
            }}
            onClose={() => setComputerOpen(false)}
          />
        )}
        {dialog && (
          <WorkspaceDialog
            dialog={dialog}
            state={state}
            workspace={workspace}
            onClose={() => setDialog(undefined)}
            mutate={mutate}
          />
        )}
      </div>
    </CopilotKitProvider>
  );
}
