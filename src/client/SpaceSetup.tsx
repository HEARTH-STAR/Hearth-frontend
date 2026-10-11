import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Boxes,
  Check,
  LoaderCircle,
  Play,
  Sparkles,
} from 'lucide-react';
import type {
  ClaudeLogin,
  ClaudeLoginState,
  Space,
  SpaceSetup as Setup,
} from '../shared/types';
import { api } from './api';
import { GitHubDialog, GitHubMark } from './GitHubDialog';
import { STAGE_LABEL, startable, working } from './space-stage';

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;
/**
 * A Space's setup, in order: its container (Hearth-backend spins it up), then Claude Code and
 * GitHub, both signed in inside that container through the Hearth-Core running there.
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
  const [setup, setSetup] = useState<Setup>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [login, setLogin] = useState<ClaudeLogin>();
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
        void api(`${base}/claude/login/cancel`, 'POST', {
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
  const finished = async (state: ClaudeLoginState) => {
    if (state.status === 'pending') return false;
    if (state.status === 'connected') {
      setLogin(undefined);
      setCode('');
      setLoginError('');
      await load();
      changed.current();
    } else if (state.status === 'invalid_code') {
      setLoginError(
        'That code did not work. Copy the whole code from Claude’s page and paste it again.',
      );
    } else {
      setLogin(undefined);
      setCode('');
      // Claude Code ends the sign-in when it rejects a code, so a retry starts over.
      setLoginError(
        state.status === 'cancelled'
          ? 'Sign-in was cancelled.'
          : `${state.error || 'Sign-in did not finish.'} Start again, and paste the whole code Claude shows.`,
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
        const state = await api<ClaudeLoginState>(
          `${base}/claude/login/poll`,
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
    run('claude', async () => {
      setLoginError('');
      try {
        setLogin(await api<ClaudeLogin>(`${base}/claude/login`, 'POST', {}));
        setCode('');
      } catch (cause) {
        setLoginError(message(cause, 'Could not start Claude Code sign-in.'));
      }
    });
  const submit = () =>
    run('code', async () => {
      if (!login) return;
      setLoginError('');
      try {
        const state = await api<ClaudeLoginState>(
          `${base}/claude/login/code`,
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
        await api(`${base}/claude/login/cancel`, 'POST', { sessionId }).catch(
          () => {},
        );
    });
  const signOut = () =>
    run('logout', async () => {
      if (
        !window.confirm(
          `Sign Claude Code out of ${space.name}? It cannot run until you sign in again.`,
        )
      )
        return;
      try {
        await api(`${base}/claude/logout`, 'POST', {});
        await load();
        changed.current();
      } catch (cause) {
        setLoginError(message(cause, 'Could not sign out.'));
      }
    });

  const current = setup?.stage ?? space.stage;
  const ready = current === 'ready';
  const claude = setup?.claude;
  const github = setup?.github;
  const complete = ready && !!claude?.connected && !!github?.connected;
  return (
    <section
      className={`space-setup ${complete ? 'complete' : ''}`}
      aria-label={`${space.name} setup`}
    >
      <header>
        <h2>{complete ? 'This Space is ready.' : 'Set up this Space'}</h2>
        <p>
          {space.name} runs in its own container. Claude Code and GitHub are
          signed in inside it.
        </p>
      </header>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      <ol className="setup-steps">
        <li className={ready ? 'done' : working(current) ? 'working' : ''}>
          <span className="setup-mark" aria-hidden="true">
            {ready ? (
              <Check size={14} />
            ) : working(current) ? (
              <LoaderCircle size={14} className="spinning" />
            ) : (
              <Boxes size={14} />
            )}
          </span>
          <div className="setup-text">
            <strong>Container</strong>
            <span>
              {STAGE_LABEL[current]}
              {setup?.container && (
                <>
                  {' · '}
                  <code>{setup.container}</code>
                </>
              )}
            </span>
            {current === 'creating' && (
              <small>
                The first Space builds the image, which can take a few minutes.
              </small>
            )}
            {current === 'booting' && (
              <small>
                The first start installs Hearth-Core’s packages, which can take
                a few minutes.
              </small>
            )}
            {setup?.error && !ready && (
              <small className="failed">{setup.error}</small>
            )}
          </div>
          {startable(current) && (
            <button
              className="primary"
              disabled={!!busy}
              onClick={() => void start()}
            >
              {busy === 'container' ? (
                <LoaderCircle size={14} className="spinning" />
              ) : (
                <Play size={14} />
              )}
              {current === 'none' ? 'Start container' : 'Start again'}
            </button>
          )}
        </li>
        <li className={claude?.connected ? 'done' : ready ? '' : 'blocked'}>
          <span className="setup-mark" aria-hidden="true">
            {claude?.connected ? <Check size={14} /> : <Sparkles size={14} />}
          </span>
          <div className="setup-text">
            <strong>Claude Code</strong>
            <span>
              {!ready
                ? 'Signs in once the container runs.'
                : claude?.connected
                  ? [
                      claude.email ?? 'Signed in',
                      claude.subscription && `Claude ${claude.subscription}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : claude?.error
                    ? claude.error
                    : claude && !claude.loginSupported
                      ? 'Sign-in needs a Linux container; this Hearth-Core cannot run it.'
                      : `Sign in with your Claude account. ${space.name} runs on it.`}
            </span>
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
                  1. Approve on claude.com <ArrowUpRight size={14} />
                </a>
                <label className="field-label" htmlFor="claude-code">
                  2. Paste the code Claude shows you
                </label>
                <div className="claude-code-row">
                  <input
                    id="claude-code"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="code#state"
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
              <small className="failed" role="alert">
                {loginError}
              </small>
            )}
          </div>
          {ready &&
            !login &&
            claude &&
            (claude.connected ? (
              <button disabled={!!busy} onClick={() => void signOut()}>
                Sign out
              </button>
            ) : (
              claude.loginSupported && (
                <button
                  className="primary"
                  disabled={!!busy}
                  onClick={() => void signIn()}
                >
                  {busy === 'claude' ? (
                    <LoaderCircle size={14} className="spinning" />
                  ) : null}
                  Sign in to Claude
                </button>
              )
            ))}
        </li>
        <li className={github?.connected ? 'done' : ready ? '' : 'blocked'}>
          <span className="setup-mark" aria-hidden="true">
            {github?.connected ? <Check size={14} /> : <GitHubMark size={14} />}
          </span>
          <div className="setup-text">
            <strong>GitHub</strong>
            <span>
              {!ready
                ? 'Connects once the container runs.'
                : github?.connected
                  ? `@${github.username}`
                  : `Connect the account ${space.name} works with. Optional.`}
            </span>
          </div>
          {ready && (
            <button
              className={github?.connected ? '' : 'primary'}
              disabled={!!busy}
              onClick={() => setGithubOpen(true)}
            >
              {github?.connected ? 'Manage' : 'Connect GitHub'}
            </button>
          )}
        </li>
      </ol>
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
