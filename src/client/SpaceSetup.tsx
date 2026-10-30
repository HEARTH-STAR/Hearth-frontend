import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Boxes,
  CircleArrowUp,
  GitCommitHorizontal,
  Globe,
  LoaderCircle,
  Play,
  Settings,
  Sparkles,
  Square,
  SquareTerminal,
} from 'lucide-react';
import type {
  AgentLogin,
  AgentLoginState,
  ContainerLogs,
  CoreUpdate,
  CoreVersion,
  Space,
  SpaceSetup as Setup,
} from '../shared/types';
import { agentOf } from '../shared/agents';
import { api } from './api';
import { GitHubDialog, GitHubMark } from './GitHubDialog';
import { STAGE_LABEL, startable, working } from './space-stage';

const sameLines = (a: string[], b: string[]) =>
  a.length === b.length && a.every((line, index) => line === b[index]);
const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;
/**
 * A Space's setup, in order: its container (Hearth-backend spins it up), then its agent (Claude Code,
 * Cursor or Antigravity, chosen when its Dot was made) and GitHub, both signed in inside that container
 * through the Hearth-Core running there. Claude and Antigravity show a code to paste back; Cursor's
 * sign-in finishes on its own once the owner approves, so it is polled.
 */
export function SpaceSetup({
  space,
  onChanged,
}: {
  space: Space;
  /** The workspace should reload: the Space's stage or sign-in changed. */
  onChanged: () => void;
}) {
  const base = `/spaces/${encodeURIComponent(space.id)}`;
  const agent = agentOf(space);
  const [setup, setSetup] = useState<Setup>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [login, setLogin] = useState<AgentLogin>();
  const [code, setCode] = useState('');
  const [loginError, setLoginError] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const stage = useRef(setup?.stage);
  stage.current = setup?.stage;
  const load = useCallback(async () => {
    try {
      const next = await api<Setup>(`${base}/setup`);
      if (stage.current && stage.current !== next.stage) changed.current();
      setSetup(next);
      setError('');
    } catch (cause) {
      setError(message(cause, 'Could not read this Space’s setup.'));
    }
  }, [base]);
  // Often while the container comes up, now and then once it runs.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!document.hidden) await load();
      if (!stopped)
        timer = setTimeout(
          () => void tick(),
          stage.current === 'ready' ? 15000 : 3000,
        );
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [load]);
  // Leaving the Space mid sign-in stops the CLI waiting for a code.
  const pending = useRef<string>(undefined);
  pending.current = login?.sessionId;
  useEffect(
    () => () => {
      if (pending.current)
        void api(`${base}/agent/login/cancel`, 'POST', {
          sessionId: pending.current,
        }).catch(() => {});
    },
    [base],
  );
  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    try {
      await action();
    } finally {
      setBusy('');
    }
  };
  const start = () =>
    run('container', async () => {
      try {
        setSetup(await api<Setup>(`${base}/container`, 'POST', {}));
        setError('');
        changed.current();
      } catch (cause) {
        setError(message(cause, 'The container did not start.'));
      }
    });
  const finished = async (state: AgentLoginState) => {
    if (state.status === 'pending') return false;
    if (state.status === 'connected') {
      setLogin(undefined);
      setCode('');
      setLoginError('');
      await load();
      changed.current();
    } else if (state.status === 'invalid_code') {
      setLoginError(
        `That code did not work. Copy the whole code from ${agent.account}’s page and paste it again.`,
      );
    } else {
      setLogin(undefined);
      setCode('');
      // The CLI ends the sign-in when it rejects a code, so a retry starts over.
      setLoginError(
        state.status === 'cancelled'
          ? 'Sign-in was cancelled.'
          : `${state.error || 'Sign-in did not finish.'} Start again${
              agent.pastesCode
                ? `, and paste the whole code ${agent.account} shows.`
                : '.'
            }`,
      );
    }
    return true;
  };
  // The CLI can take a moment past the code; poll until it settles.
  useEffect(() => {
    if (!waiting || !login) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const state = await api<AgentLoginState>(
          `${base}/agent/login/poll`,
          'POST',
          { sessionId: login.sessionId },
        );
        if (stopped) return;
        if (await finished(state)) setWaiting(false);
        else timer = setTimeout(() => void poll(), 2000);
      } catch (cause) {
        if (stopped) return;
        setWaiting(false);
        setLogin(undefined);
        setLoginError(message(cause, 'Sign-in did not finish.'));
      }
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // finished only uses state setters and load, which stay the same for this Space.
  }, [waiting, login, base]);
  const signIn = () =>
    run('agent', async () => {
      setLoginError('');
      try {
        const started = await api<AgentLogin>(
          `${base}/agent/login`,
          'POST',
          {},
        );
        if (started.connected) {
          await load();
          changed.current();
          return;
        }
        setLogin(started);
        setCode('');
        // No code to paste: the CLI finishes once the owner approves, so watch for it.
        if (!agent.pastesCode) setWaiting(true);
      } catch (cause) {
        setLoginError(message(cause, `Could not start ${agent.name} sign-in.`));
      }
    });
  const submit = () =>
    run('code', async () => {
      if (!login) return;
      setLoginError('');
      try {
        const state = await api<AgentLoginState>(
          `${base}/agent/login/code`,
          'POST',
          { sessionId: login.sessionId, code: code.trim() },
        );
        if (!(await finished(state))) setWaiting(true);
      } catch (cause) {
        setLogin(undefined);
        setLoginError(message(cause, 'Sign-in did not finish.'));
      }
    });
  const cancel = () =>
    run('cancel', async () => {
      const sessionId = login?.sessionId;
      setLogin(undefined);
      setWaiting(false);
      setCode('');
      if (sessionId)
        await api(`${base}/agent/login/cancel`, 'POST', { sessionId }).catch(
          () => {},
        );
    });
  const signOut = () =>
    run('logout', async () => {
      if (
        !window.confirm(
          `Sign ${agent.name} out of ${space.name}? It cannot run until you sign in again.`,
        )
      )
        return;
      try {
        await api(`${base}/agent/logout`, 'POST', {});
        await load();
        changed.current();
      } catch (cause) {
        setLoginError(message(cause, 'Could not sign out.'));
      }
    });

  const current = setup?.stage ?? space.stage;
  const ready = current === 'ready';
  const signin = setup?.agent;
  const github = setup?.github;
  const complete = ready && !!signin?.connected && !!github?.connected;

  // The Hearth-Core the container runs. When `main` has a newer commit, Update moves the container's
  // checkout to it and Hearth-Core restarts (the container comes back through booting).
  const [version, setVersion] = useState<CoreVersion>();
  const [updating, setUpdating] = useState<string>();
  const [updateError, setUpdateError] = useState('');
  const target = useRef(updating);
  target.current = updating;
  const loadVersion = useCallback(
    async (refresh = false) => {
      try {
        const next = await api<CoreVersion>(
          `${base}/core${refresh ? '?refresh=true' : ''}`,
        );
        setVersion(next);
        if (target.current && next.current?.sha === target.current)
          setUpdating(undefined);
      } catch {
        // Restarting or not up yet: keep the last answer; the next tick asks again.
      }
    },
    [base],
  );
  useEffect(() => {
    if (!ready) return;
    void loadVersion();
    // Every few seconds while an update restarts Hearth-Core, else every 10 minutes.
    const timer = setInterval(
      () => {
        if (!document.hidden) void loadVersion();
      },
      updating ? 3000 : 600000,
    );
    return () => clearInterval(timer);
  }, [ready, loadVersion, updating]);
  const update = () =>
    run('update', async () => {
      setUpdateError('');
      try {
        const result = await api<CoreUpdate>(`${base}/core/update`, 'POST', {});
        if (result.updated) {
          setUpdating(result.to.sha);
          await load();
        } else await loadVersion(true);
      } catch (cause) {
        setUpdateError(message(cause, 'Could not update Hearth-Core.'));
      }
    });
  const checkUpdates = () => run('check', () => loadVersion(true));
  const short = (sha: string) => sha.slice(0, 7);
  // The container's recent output, polled while the page is open and the container exists.
  const [logs, setLogs] = useState<ContainerLogs>();
  const [logTab, setLogTab] = useState<'agent' | 'build'>('agent');
  const logView = useRef<HTMLDivElement>(null);
  const hasContainer = current !== 'none' && current !== 'missing';
  const loadLogs = useCallback(async () => {
    try {
      const next = await api<ContainerLogs>(`${base}/container/logs`);
      // Nothing new: keep the same object, so the view does not re-render or move.
      setLogs((previous) =>
        previous &&
        previous.supported === next.supported &&
        sameLines(previous.agent, next.agent) &&
        sameLines(previous.build, next.build)
          ? previous
          : next,
      );
    } catch {
      // Hearth-backend busy or the container restarting: keep the last lines.
    }
  }, [base]);
  useEffect(() => {
    if (!hasContainer) return;
    void loadLogs();
    const timer = setInterval(() => {
      if (!document.hidden) void loadLogs();
    }, 5000);
    return () => clearInterval(timer);
  }, [hasContainer, loadLogs]);
  const shown = logs ? logs[logTab] : [];
  // Follow new lines like a terminal, but only while the reader is at the bottom: scrolled up to read,
  // the view stays where it is.
  const following = useRef(true);
  useEffect(() => {
    const view = logView.current;
    if (view && following.current) view.scrollTop = view.scrollHeight;
  }, [shown]);
  const stop = () =>
    run('stop', async () => {
      if (
        !window.confirm(
          `Stop ${space.name}’s container? ${agent.name} cannot run until you start it again.`,
        )
      )
        return;
      try {
        setSetup(await api<Setup>(`${base}/container/stop`, 'POST', {}));
        setError('');
        changed.current();
      } catch (cause) {
        setError(message(cause, 'The container did not stop.'));
      }
    });

  const agentLine = !ready
    ? 'Signs in once the container runs.'
    : signin?.connected
      ? [
          signin.email ?? 'Signed in',
          signin.subscription && `${agent.account} ${signin.subscription}`,
        ]
          .filter(Boolean)
          .join(' · ')
      : signin?.error
        ? signin.error
        : signin && !signin.loginSupported
          ? 'Sign-in needs a Linux container; this Hearth-Core cannot run it.'
          : `Not signed in. ${space.name} runs on your ${agent.account} account.`;
  const updateLabel = updating
    ? 'Updating…'
    : version?.updateAvailable
      ? 'Update & restart'
      : version?.enabled
        ? 'Up to date'
        : 'Update & restart';
  return (
    <section
      className={`space-console ${complete ? 'complete' : ''}`}
      aria-label={`${space.name} setup`}
    >
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      <div className="console-top">
        <div className="console-card console-identity">
          <div className="console-logo" aria-hidden="true">
            {agent.name
              .toUpperCase()
              .split(' ')
              .map((word) => (
                <span key={word}>{word}</span>
              ))}
          </div>
          <div className="console-name">
            <strong>{space.name}</strong>
            <span>
              <span>{agent.id.replace('_', '-')}</span>
              {version?.current && (
                <span className="console-commit" title="Hearth-Core commit">
                  <GitCommitHorizontal size={13} aria-hidden="true" />
                  {short(version.current.sha)}
                </span>
              )}
            </span>
          </div>
          <button
            className="console-update"
            disabled={
              !ready || !!busy || !!updating || !version?.updateAvailable
            }
            title={
              version?.updateAvailable && version.latest
                ? `Update Hearth-Core to ${short(version.latest.sha)}: ${version.latest.subject}`
                : version?.enabled
                  ? `Hearth-Core is on the newest commit of ${version.branch ?? 'main'}`
                  : undefined
            }
            onClick={() => void update()}
          >
            {busy === 'update' || updating ? (
              <LoaderCircle size={15} className="spinning" />
            ) : (
              <CircleArrowUp size={15} />
            )}
            {updateLabel}
          </button>
          <div className="console-state">
            <span
              className={`console-pill ${ready ? 'ready' : working(current) ? 'working' : 'down'}`}
              role="status"
            >
              <span className="console-dot" aria-hidden="true" />
              {ready ? 'Ready' : STAGE_LABEL[current]}
            </span>
            {startable(current) ? (
              <button
                className="console-start"
                disabled={!!busy}
                onClick={() => void start()}
              >
                {busy === 'container' ? (
                  <LoaderCircle size={14} className="spinning" />
                ) : (
                  <Play size={14} />
                )}
                {current === 'none' ? 'Start' : 'Start again'}
              </button>
            ) : (
              <button
                className="console-stop"
                disabled={!!busy || !hasContainer || current === 'unknown'}
                onClick={() => void stop()}
              >
                {busy === 'stop' ? (
                  <LoaderCircle size={14} className="spinning" />
                ) : (
                  <Square size={14} />
                )}
                Stop
              </button>
            )}
          </div>
          {updating && (
            <small className="console-note">
              Updating Hearth-Core to <code>{short(updating)}</code>; the Space
              restarts and is back in a minute.
            </small>
          )}
          {setup?.error && !ready && (
            <small className="console-note failed">{setup.error}</small>
          )}
          {updateError && (
            <small className="console-note failed" role="alert">
              {updateError}
            </small>
          )}
        </div>

        <div className="console-card console-meta">
          <header>
            <h3>
              <Globe size={18} aria-hidden="true" /> Status &amp; Metadata
            </h3>
            <button
              className="console-icon"
              aria-label="Check for updates"
              title="Check for updates"
              disabled={!ready || !!busy}
              onClick={() => void checkUpdates()}
            >
              {busy === 'check' ? (
                <LoaderCircle size={15} className="spinning" />
              ) : (
                <Settings size={15} />
              )}
            </button>
          </header>
          <div className="console-tiles">
            <div className="console-tile">
              <small>
                <Boxes size={12} aria-hidden="true" /> Container
              </small>
              <strong className={ready ? 'ok' : ''}>
                {STAGE_LABEL[current]}
              </strong>
              {setup?.container && <code>{setup.container}</code>}
            </div>
            <div className="console-tile">
              <small>
                <Globe size={12} aria-hidden="true" /> Hearth-Core API
              </small>
              <strong className={ready ? 'ok' : ''}>
                {ready ? 'Up' : working(current) ? 'Starting' : 'Down'}
              </strong>
              {version?.current && (
                <span>
                  <code>{short(version.current.sha)}</code>
                  {version.updateAvailable && version.latest ? (
                    <>
                      {' · '}
                      <span className="console-new">
                        New on {version.branch}:{' '}
                        <code>{short(version.latest.sha)}</code>
                      </span>
                    </>
                  ) : version.enabled && version.latest ? (
                    ' · up to date'
                  ) : null}
                </span>
              )}
              {ready && version && !version.supported && (
                <span>Predates updates</span>
              )}
              {version?.error && (
                <span className="failed">{version.error}</span>
              )}
            </div>
            <div className="console-tile">
              <small>
                <Sparkles size={12} aria-hidden="true" /> {agent.name}
              </small>
              <strong className={signin?.connected ? 'ok' : ''}>
                {signin?.connected ? 'Signed in' : 'Not signed in'}
              </strong>
              <span>{agentLine}</span>
              {ready &&
                !login &&
                signin &&
                (signin.connected ? (
                  <button
                    className="console-tile-action"
                    disabled={!!busy}
                    onClick={() => void signOut()}
                  >
                    Sign out
                  </button>
                ) : (
                  signin.loginSupported && (
                    <button
                      className="console-tile-action primary"
                      disabled={!!busy}
                      onClick={() => void signIn()}
                    >
                      {busy === 'agent' ? (
                        <LoaderCircle size={14} className="spinning" />
                      ) : null}
                      Sign in to {agent.account}
                    </button>
                  )
                ))}
            </div>
            <div className="console-tile">
              <small>
                <GitHubMark size={12} /> GitHub
              </small>
              <strong className={github?.connected ? 'ok' : ''}>
                {github?.connected ? `@${github.username}` : 'Not connected'}
              </strong>
              <span>
                {ready
                  ? github?.connected
                    ? 'Pull requests open as this account.'
                    : 'Optional: the account it works with.'
                  : 'Connects once the container runs.'}
              </span>
              {ready && (
                <button
                  className={`console-tile-action ${github?.connected ? '' : 'primary'}`}
                  disabled={!!busy}
                  onClick={() => setGithubOpen(true)}
                >
                  {github?.connected ? 'Manage' : 'Connect GitHub'}
                </button>
              )}
            </div>
          </div>
          {login && (
            <form
              className="claude-login"
              onSubmit={(event) => {
                event.preventDefault();
                if (code.trim() && !busy && !waiting) void submit();
              }}
            >
              <a
                className="primary claude-open"
                href={login.authUrl}
                target="_blank"
                rel="noreferrer"
              >
                1. {agent.approveLabel} <ArrowUpRight size={14} />
              </a>
              {agent.pastesCode ? (
                <>
                  <label className="field-label" htmlFor="agent-code">
                    2. Paste the code {agent.account} shows you
                  </label>
                  <div className="claude-code-row">
                    <input
                      id="agent-code"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={agent.codeHint}
                      value={code}
                      maxLength={4096}
                      onChange={(event) => setCode(event.target.value)}
                    />
                    <button disabled={!code.trim() || !!busy || waiting}>
                      {busy === 'code' || waiting ? (
                        <LoaderCircle size={14} className="spinning" />
                      ) : null}
                      Sign in
                    </button>
                  </div>
                </>
              ) : (
                <small role="status">
                  <LoaderCircle size={14} className="spinning" /> 2.{' '}
                  {agent.name} signs in here once you approve.
                </small>
              )}
              <button
                type="button"
                className="text-button"
                disabled={busy === 'cancel'}
                onClick={() => void cancel()}
              >
                Cancel
              </button>
            </form>
          )}
          {loginError && (
            <small className="console-note failed" role="alert">
              {loginError}
            </small>
          )}
        </div>
      </div>

      <div className="console-card console-logs">
        <header>
          <h3>
            <SquareTerminal size={18} aria-hidden="true" /> Machine Logs
          </h3>
        </header>
        <div className="console-tabs" role="tablist" aria-label="Logs">
          {(['agent', 'build'] as const).map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={logTab === tab}
              className={logTab === tab ? 'active' : ''}
              onClick={() => {
                following.current = true;
                setLogTab(tab);
              }}
            >
              {tab === 'agent' ? 'Agent Logs' : 'Build Logs'}
            </button>
          ))}
        </div>
        <div
          className="console-log-view"
          ref={logView}
          role="log"
          onScroll={(event) => {
            const view = event.currentTarget;
            following.current =
              view.scrollHeight - view.scrollTop - view.clientHeight < 32;
          }}
        >
          {!hasContainer ? (
            <p className="console-log-empty">No container yet.</p>
          ) : logs && !logs.supported ? (
            <p className="console-log-empty">
              Logs are not available for this container.
            </p>
          ) : shown.length ? (
            <ol>
              {shown.map((line, index) => (
                <li key={index}>
                  <span aria-hidden="true">{index + 1}</span>
                  <code>{line || ' '}</code>
                </li>
              ))}
            </ol>
          ) : (
            <p className="console-log-empty">
              {logs
                ? logTab === 'build'
                  ? 'No build output in the recent logs.'
                  : 'Nothing new from Hearth-Core yet.'
                : 'Loading logs…'}
            </p>
          )}
        </div>
      </div>
      {githubOpen && (
        <GitHubDialog
          spaceId={space.id}
          spaceName={space.name}
          onClose={() => {
            setGithubOpen(false);
            void load();
          }}
        />
      )}
    </section>
  );
}
