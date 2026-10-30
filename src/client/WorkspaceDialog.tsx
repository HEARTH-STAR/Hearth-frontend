import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Dot, State, WorkspaceState } from '../shared/types';
import {
  AGENT_IDS,
  AGENTS,
  DEFAULT_AGENT,
  type AgentId,
} from '../shared/agents';
import {
  setThemePreference,
  themePreference,
  type ThemePreference,
} from './theme';
export type Dialog = { type: 'dot' } | { type: 'settings' };
export function WorkspaceDialog({
  dialog,
  state,
  workspace,
  onClose,
  onDotCreated,
  mutate,
  account,
}: {
  dialog: Dialog;
  state: State;
  workspace: WorkspaceState;
  onClose: () => void;
  /** A new Dot was saved, with its own Space whose container is starting. */
  onDotCreated?: (dot: Dot) => void;
  /** The saved value, or false when saving failed. */
  mutate: (path: string, method: string, body?: unknown) => Promise<unknown>;
  /** Settings' Account section (Clerk's user, AccountSettings.tsx). */
  account?: ReactNode;
}) {
  const [name, setName] = useState('');
  const [paused, setPaused] = useState(state.settings.paused);
  const [agent, setAgent] = useState<AgentId>(DEFAULT_AGENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState(themePreference);
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    container.current
      ?.querySelector<HTMLElement>('input,textarea,select')
      ?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const items = [
          ...(container.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input,textarea,select,a[href]',
          ) ?? []),
        ];
        if (event.shiftKey && document.activeElement === items[0]) {
          event.preventDefault();
          items.at(-1)?.focus();
        } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
          event.preventDefault();
          items[0]?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  const title = dialog.type === 'dot' ? 'Spin up a new Dot.' : 'Settings';
  const { backend } = workspace.setup;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        ref={container}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="modal-close icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <span className="eyebrow">HEARTH</span>
        <h2 id="dialog-title">{title}</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            let path = '',
              method = 'POST',
              body: unknown;
            if (dialog.type === 'dot') {
              // Its own Space and container, running the chosen agent; Hearth picks the folder and instructions.
              path = '/dots';
              body = { name, agent };
            }
            if (dialog.type === 'settings') {
              path = '/settings';
              method = 'PATCH';
              body = { paused };
            }
            const saved = await mutate(path, method, body);
            if (saved) {
              if (dialog.type === 'dot' && typeof saved === 'object')
                onDotCreated?.(saved as Dot);
              onClose();
            } else setError('Could not save. Review the error and retry.');
            setBusy(false);
          }}
        >
          {dialog.type === 'dot' && (
            <>
              <label className="field-label" htmlFor="entity-name">
                Name
              </label>
              <input
                id="entity-name"
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </>
          )}
          {dialog.type === 'dot' && (
            <fieldset className="appearance-fields">
              <legend>Agent</legend>
              <div className="segmented" role="radiogroup">
                {AGENT_IDS.map((option) => (
                  <label key={option}>
                    <input
                      type="radio"
                      name="agent"
                      value={option}
                      checked={agent === option}
                      onChange={() => setAgent(option)}
                    />
                    <span>{AGENTS[option].name}</span>
                  </label>
                ))}
              </div>
              <small className="muted">{AGENTS[agent].blurb}</small>
            </fieldset>
          )}
          {dialog.type === 'dot' && (
            <p className="muted">
              Each Dot runs in its own container: Hearth spins it up through
              Hearth-backend, then opens its Setup page to sign in to{' '}
              {AGENTS[agent].name} and connect GitHub. The first one builds the
              image, which can take a few minutes.
              {backend.reachable && backend.docker !== false
                ? ''
                : ` ${backend.reachable ? 'Docker is not running' : 'Hearth-backend is not answering'} right now, so start the container from the Setup page later.`}
            </p>
          )}
          {dialog.type === 'settings' && (
            <>
              {account}
              <label className="permission-row">
                <input
                  type="checkbox"
                  checked={paused}
                  onChange={(e) => setPaused(e.target.checked)}
                />
                <span>
                  <strong>Pause all Dots</strong>
                  <small>Running turns stop, and new ones wait.</small>
                </span>
              </label>
              <fieldset className="appearance-fields">
                <legend>Appearance</legend>
                <div className="segmented" role="radiogroup">
                  {(['system', 'light', 'dark'] as ThemePreference[]).map(
                    (option) => (
                      <label key={option}>
                        <input
                          type="radio"
                          name="theme"
                          value={option}
                          checked={theme === option}
                          onChange={() => {
                            setTheme(option);
                            setThemePreference(option);
                          }}
                        />
                        <span>{option[0].toUpperCase() + option.slice(1)}</span>
                      </label>
                    ),
                  )}
                </div>
              </fieldset>
            </>
          )}
          {error && (
            <p className="chat-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary full" disabled={busy}>
            {dialog.type === 'dot'
              ? busy
                ? 'Spinning up…'
                : 'Spin up container'
              : busy
                ? 'Saving…'
                : 'Save'}
          </button>
        </form>
      </section>
    </div>
  );
}
