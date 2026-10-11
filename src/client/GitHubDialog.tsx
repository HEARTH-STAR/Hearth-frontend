import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Copy,
  KeyRound,
  LoaderCircle,
  X,
} from 'lucide-react';
import type {
  GitHubDeviceLogin,
  GitHubDevicePoll,
  GitHubStatus,
} from '../shared/types';
import { api, ApiError } from './api';
/** GitHub's mark (Octicons, MIT). */
export function GitHubMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
const METHOD: Record<NonNullable<GitHubStatus['method']>, string> = {
  device: 'Signed in with a GitHub code',
  token: 'Connected with a personal access token',
  terminal: 'Signed in with gh in the container’s terminal',
};
const POLL_MS = 3000;
/** What a failed request says, naming missing token scopes the way Hearth-Core reports them. */
function reason(cause: unknown, fallback: string) {
  if (cause instanceof ApiError && cause.body?.code === 'missing_scopes') {
    const scopes = Array.isArray(cause.body.missingScopes)
      ? cause.body.missingScopes.join(', ')
      : '';
    return `This token is missing ${scopes || 'required scopes'}. Add them, or use a fine-grained token.`;
  }
  return cause instanceof Error ? cause.message : fallback;
}
/** A Space's GitHub account, held by the gh CLI inside its container. */
export function GitHubDialog({
  spaceId,
  spaceName,
  onClose,
  onChange,
}: {
  spaceId: string;
  spaceName: string;
  onClose: () => void;
  onChange?: (status: GitHubStatus | null) => void;
}) {
  const base = `/spaces/${encodeURIComponent(spaceId)}/github`;
  const [status, setStatus] = useState<GitHubStatus>();
  const [loadError, setLoadError] = useState('');
  const [device, setDevice] = useState<GitHubDeviceLogin>();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const container = useRef<HTMLElement>(null);
  const changed = useRef(onChange);
  changed.current = onChange;
  const show = useCallback((next: GitHubStatus) => {
    setStatus(next);
    changed.current?.(next);
  }, []);
  useEffect(() => {
    void api<GitHubStatus>(base)
      .then(show)
      .catch((cause) =>
        setLoadError(reason(cause, 'Could not read the GitHub connection.')),
      );
  }, [base, show]);
  // Waiting for the owner to enter the code on github.com.
  useEffect(() => {
    if (!device) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<GitHubDevicePoll>(
          `${base}/device/poll`,
          'POST',
          { sessionId: device.sessionId },
        );
        if (stopped) return;
        if (!result.pending) {
          setDevice(undefined);
          show(result.status);
          return;
        }
        timer = setTimeout(() => void poll(), POLL_MS);
      } catch (cause) {
        if (stopped) return;
        setDevice(undefined);
        setError(reason(cause, 'GitHub sign-in did not finish.'));
      }
    };
    timer = setTimeout(() => void poll(), POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [base, device, show]);
  // Closing the dialog mid sign-in stops the gh login waiting on the code.
  const pending = useRef<string>(undefined);
  pending.current = device?.sessionId;
  useEffect(
    () => () => {
      if (pending.current)
        void api(`${base}/device/cancel`, 'POST', {
          sessionId: pending.current,
        }).catch(() => {});
    },
    [base],
  );
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    setError('');
    try {
      await action();
    } finally {
      setBusy('');
    }
  };
  const startDevice = () =>
    run('device', async () => {
      try {
        setDevice(await api<GitHubDeviceLogin>(`${base}/device`, 'POST', {}));
        setCopied(false);
      } catch (cause) {
        setError(reason(cause, 'Could not start GitHub sign-in.'));
      }
    });
  const cancelDevice = () =>
    run('cancel', async () => {
      const sessionId = device?.sessionId;
      setDevice(undefined);
      if (sessionId)
        await api(`${base}/device/cancel`, 'POST', { sessionId }).catch(
          () => {},
        );
    });
  const connectToken = () =>
    run('token', async () => {
      try {
        show(
          await api<GitHubStatus>(`${base}/token`, 'POST', {
            token: token.trim(),
          }),
        );
        setToken('');
      } catch (cause) {
        setError(reason(cause, 'GitHub did not accept this token.'));
      }
    });
  const recheck = () =>
    run('recheck', async () => {
      try {
        show(await api<GitHubStatus>(`${base}/recheck`, 'POST', {}));
      } catch (cause) {
        setError(reason(cause, 'Could not check the connection.'));
      }
    });
  const disconnect = () =>
    run('disconnect', async () => {
      if (
        !window.confirm(
          `Disconnect GitHub from ${spaceName}? The gh CLI in its container is signed out of github.com.`,
        )
      )
        return;
      try {
        show(await api<GitHubStatus>(`${base}/disconnect`, 'POST', {}));
      } catch (cause) {
        setError(reason(cause, 'Could not disconnect.'));
      }
    });
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal github-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="github-title"
        ref={container}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="modal-close icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <span className="eyebrow">GITHUB · {spaceName.toUpperCase()}</span>
        <h2 id="github-title">
          {status?.connected ? 'GitHub is connected.' : 'Connect GitHub.'}
        </h2>
        {!status && !loadError && (
          <p className="muted" role="status">
            Checking the connection…
          </p>
        )}
        {loadError && (
          <p className="chat-error" role="alert">
            {loadError}
          </p>
        )}
        {status?.connected && (
          <>
            <div className="github-account">
              <span className="github-avatar">
                <GitHubMark size={22} />
              </span>
              <div>
                <strong>@{status.username}</strong>
                {status.name && <span>{status.name}</span>}
                <small>
                  {status.method ? METHOD[status.method] : 'Connected'}
                  {status.expiresAt &&
                    ` · expires ${new Date(status.expiresAt).toLocaleDateString()}`}
                </small>
              </div>
            </div>
            {status.warnings.map((warning) => (
              <p className="github-warning" key={warning}>
                {warning}
              </p>
            ))}
            {status.detail && (
              <details className="github-detail">
                <summary>gh auth status</summary>
                <pre>{status.detail}</pre>
              </details>
            )}
            <div className="github-actions">
              <button disabled={!!busy} onClick={() => void recheck()}>
                {busy === 'recheck' ? (
                  <LoaderCircle size={14} className="spinning" />
                ) : (
                  <Check size={14} />
                )}
                Check again
              </button>
              <button
                className="danger"
                disabled={!!busy}
                onClick={() => void disconnect()}
              >
                Disconnect
              </button>
            </div>
          </>
        )}
        {status && !status.connected && device && (
          <div className="github-device">
            <p>
              Open GitHub, sign in, and enter this code. This page updates by
              itself once you approve.
            </p>
            <div className="github-code">
              <code>{device.userCode}</code>
              <button
                className="icon-button"
                aria-label="Copy code"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(device.userCode)
                    .then(() => setCopied(true))
                    .catch(() => {});
                }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <a
              className="primary github-open"
              href={device.verificationUri}
              target="_blank"
              rel="noreferrer"
            >
              Open {device.verificationUri.replace(/^https:\/\//, '')}
              <ArrowUpRight size={14} />
            </a>
            <p className="github-waiting" role="status">
              <LoaderCircle size={14} className="spinning" /> Waiting for you to
              approve on GitHub…
            </p>
            <button
              className="text-button"
              disabled={busy === 'cancel'}
              onClick={() => void cancelDevice()}
            >
              Cancel
            </button>
          </div>
        )}
        {status && !status.connected && !device && (
          <>
            <p className="muted">
              {spaceName} connects one GitHub account. The gh CLI inside its
              container holds it, and is signed out of any other github.com
              account first.
            </p>
            <div className="github-option">
              <div>
                <strong>
                  <GitHubMark size={15} /> Sign in with GitHub
                </strong>
                <small>Get a one-time code and enter it on github.com.</small>
              </div>
              <button
                className="primary"
                disabled={!!busy}
                onClick={() => void startDevice()}
              >
                {busy === 'device' ? (
                  <LoaderCircle size={14} className="spinning" />
                ) : null}
                Get a code
              </button>
            </div>
            <form
              className="github-option github-token"
              onSubmit={(event) => {
                event.preventDefault();
                if (token.trim() && !busy) void connectToken();
              }}
            >
              <div>
                <strong>
                  <KeyRound size={15} /> Use a personal access token
                </strong>
                <small>
                  A{' '}
                  <a
                    href="https://github.com/settings/personal-access-tokens/new"
                    target="_blank"
                    rel="noreferrer"
                  >
                    fine-grained token
                  </a>
                  , or a classic one with <code>repo</code> and{' '}
                  <code>read:org</code>. It goes to gh and is not stored by
                  Hearth.
                </small>
              </div>
              <div className="github-token-row">
                <input
                  type="password"
                  aria-label="GitHub token"
                  autoComplete="off"
                  placeholder="github_pat_… or ghp_…"
                  value={token}
                  maxLength={512}
                  onChange={(event) => setToken(event.target.value)}
                />
                <button disabled={!token.trim() || !!busy}>
                  {busy === 'token' ? (
                    <LoaderCircle size={14} className="spinning" />
                  ) : null}
                  Connect
                </button>
              </div>
            </form>
          </>
        )}
        {error && (
          <p className="chat-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
