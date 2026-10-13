import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Dot, State, WorkspaceState } from '../shared/types';
import { STAGE_LABEL } from './space-stage';
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
}: {
  dialog: Dialog;
  state: State;
  workspace: WorkspaceState;
  onClose: () => void;
  /** A new Dot was saved, with its own Space whose container is starting. */
  onDotCreated?: (dot: Dot) => void;
  /** The saved value, or false when saving failed. */
  mutate: (path: string, method: string, body?: unknown) => Promise<unknown>;
}) {
  const [name, setName] = useState(
    dialog.type === 'settings' ? state.settings.name : '',
  );
  const [paused, setPaused] = useState(state.settings.paused);
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
  const title =
    dialog.type === 'dot'
      ? 'Spin up a new Dot.'
      : 'Your workspace, your rules.';
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
              // Its own Space and container; Hearth picks the folder and instructions.
              path = '/dots';
              body = { name };
            }
            if (dialog.type === 'settings') {
              path = '/settings';
              method = 'PATCH';
              body = { name, paused };
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
          <label className="field-label" htmlFor="entity-name">
            {dialog.type === 'settings' ? 'Your name' : 'Name'}
          </label>
          <input
            id="entity-name"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            required
          />
          {dialog.type === 'dot' && (
            <p className="muted">
              Each Dot runs in its own container: Hearth spins it up through
              Hearth-backend, then opens its Setup page to sign in to Claude
              Code and connect GitHub. The first one builds the image, which can
              take a few minutes.
              {backend.reachable && backend.docker !== false
                ? ''
                : ` ${backend.reachable ? 'Docker is not running' : 'Hearth-backend is not answering'} right now, so start the container from the Setup page later.`}
            </p>
          )}
          {dialog.type === 'settings' && (
            <>
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
              <div className="config-note">
                <strong>Services</strong>
                <p>
                  <span
                    className={`online-dot ${backend.reachable && backend.docker !== false ? '' : 'off'}`}
                  />
                  Hearth-backend <code>{backend.url}</code>:{' '}
                  {backend.reachable
                    ? `connected${backend.detail ? ` (${backend.detail})` : ''}`
                    : (backend.error ?? 'not reachable')}
                </p>
                {workspace.spaces.map((space) => (
                  <p key={space.id}>
                    <span
                      className={`online-dot ${space.stage === 'ready' ? '' : 'off'}`}
                    />
                    {space.name}:{' '}
                    {space.container ? <code>{space.container}</code> : null}{' '}
                    {STAGE_LABEL[space.stage].toLowerCase()}
                    {space.stage === 'ready' &&
                      (space.claude
                        ? ', Claude Code signed in'
                        : space.claude === false
                          ? ', Claude Code not signed in'
                          : '')}
                  </p>
                ))}
                <p>
                  Each Space runs its own Hearth-Core in a container. Set{' '}
                  <code>HEARTH_BACKEND_URL</code> on the server to point
                  elsewhere.
                </p>
              </div>
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
