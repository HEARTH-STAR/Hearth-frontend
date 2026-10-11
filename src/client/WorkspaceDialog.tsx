import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Dot, State, StoredSpace, WorkspaceState } from '../shared/types';
import { STAGE_LABEL } from './space-stage';
import {
  setThemePreference,
  themePreference,
  type ThemePreference,
} from './theme';
export type Dialog =
  | { type: 'space' }
  | { type: 'dot'; dot?: Dot; spaceId: string }
  | { type: 'settings' };
export function WorkspaceDialog({
  dialog,
  state,
  workspace,
  onClose,
  onSpaceCreated,
  mutate,
}: {
  dialog: Dialog;
  state: State;
  workspace: WorkspaceState;
  onClose: () => void;
  /** A new Space was saved; its container is starting. */
  onSpaceCreated?: (space: StoredSpace) => void;
  /** The saved value, or false when saving failed. */
  mutate: (path: string, method: string, body?: unknown) => Promise<unknown>;
}) {
  const editing = dialog.type === 'dot' ? dialog.dot : undefined;
  const [name, setName] = useState(
    dialog.type === 'dot'
      ? (editing?.name ?? '')
      : dialog.type === 'settings'
        ? state.settings.name
        : '',
  );
  const [role, setRole] = useState(editing?.role ?? '');
  const [directory, setDirectory] = useState(editing?.directory ?? '');
  const [text, setText] = useState(
    dialog.type === 'dot' ? (editing?.instructions ?? '') : '',
  );
  const [paused, setPaused] = useState(state.settings.paused);
  const [spaceIds, setSpaceIds] = useState(
    dialog.type === 'dot' ? (editing?.spaceIds ?? [dialog.spaceId]) : [],
  );
  const [defaultSpace, setDefaultSpace] = useState(
    dialog.type === 'dot' ? (editing?.spaceId ?? dialog.spaceId) : '',
  );
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
    dialog.type === 'space'
      ? 'A space for something.'
      : dialog.type === 'dot'
        ? editing
          ? `Make ${editing.name} yours.`
          : 'Meet your next specialist.'
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
            if (dialog.type === 'space') {
              path = '/spaces';
              body = { name, description: text };
            }
            if (dialog.type === 'dot') {
              path = editing ? `/dots/${editing.id}` : '/dots';
              method = editing ? 'PUT' : 'POST';
              body = {
                spaceId: defaultSpace,
                spaceIds,
                name,
                role,
                instructions: text,
                ...(directory.trim() ? { directory: directory.trim() } : {}),
              };
            }
            if (dialog.type === 'settings') {
              path = '/settings';
              method = 'PATCH';
              body = { name, paused };
            }
            const saved = await mutate(path, method, body);
            if (saved) {
              if (dialog.type === 'space' && typeof saved === 'object')
                onSpaceCreated?.(saved as StoredSpace);
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
            <>
              <label className="field-label" htmlFor="dot-role">
                Role
              </label>
              <input
                id="dot-role"
                value={role}
                maxLength={40}
                placeholder="Researcher"
                onChange={(e) => setRole(e.target.value)}
              />
            </>
          )}
          {dialog.type !== 'settings' && (
            <>
              <label className="field-label" htmlFor="entity-text">
                {dialog.type === 'dot'
                  ? 'Role instructions'
                  : 'What belongs here?'}
              </label>
              <textarea
                id="entity-text"
                rows={4}
                maxLength={2000}
                required={dialog.type !== 'space'}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  dialog.type === 'dot'
                    ? 'You are a thoughtful research partner. Compare evidence and be clear about uncertainty.'
                    : ''
                }
              />
              {dialog.type === 'space' && (
                <p className="muted">
                  Hearth starts a container for this Space through
                  Hearth-backend. Then sign in to Claude Code and connect GitHub
                  inside it, from the Space’s page. The first Space builds the
                  image, which can take a few minutes.
                  {backend.reachable && backend.docker !== false
                    ? ''
                    : ` ${backend.reachable ? 'Docker is not running' : 'Hearth-backend is not answering'} right now, so the container starts once you start it again from the Space.`}
                </p>
              )}
            </>
          )}
          {dialog.type === 'dot' && (
            <>
              <label className="field-label" htmlFor="dot-directory">
                Working folder
              </label>
              <input
                id="dot-directory"
                value={directory}
                maxLength={200}
                pattern="[A-Za-z0-9_][A-Za-z0-9._\-]*(/[A-Za-z0-9_][A-Za-z0-9._\-]*)*"
                placeholder="dots/scout (chosen for you when empty)"
                onChange={(e) => setDirectory(e.target.value)}
              />
              <p className="muted">
                Inside the home Space’s container. Claude Code works here, and
                the computer’s Files tab shows it. Changing it starts new
                conversations fresh.
              </p>
              <fieldset className="space-access-fields">
                <legend>Space access</legend>
                <p className="muted">
                  Choose where this Dot can read and edit pages.
                </p>
                {workspace.spaces.map((space) => (
                  <label className="permission-row" key={space.id}>
                    <input
                      type="checkbox"
                      checked={spaceIds.includes(space.id)}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...spaceIds, space.id]
                          : spaceIds.filter((id) => id !== space.id);
                        setSpaceIds(next);
                        if (!next.includes(defaultSpace))
                          setDefaultSpace(next[0] ?? '');
                      }}
                    />
                    <span>{space.name}</span>
                  </label>
                ))}
                <label className="field-label" htmlFor="default-space">
                  Home Space: the Dot runs in its container, and saves pages
                  there by default
                </label>
                <select
                  id="default-space"
                  value={defaultSpace}
                  required
                  onChange={(event) => setDefaultSpace(event.target.value)}
                >
                  <option value="" disabled>
                    Choose a Space
                  </option>
                  {workspace.spaces
                    .filter((space) => spaceIds.includes(space.id))
                    .map((space) => (
                      <option key={space.id} value={space.id}>
                        {space.name}
                      </option>
                    ))}
                </select>
              </fieldset>
            </>
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
            {busy ? 'Saving…' : 'Save'}
          </button>
        </form>
      </section>
    </div>
  );
}
