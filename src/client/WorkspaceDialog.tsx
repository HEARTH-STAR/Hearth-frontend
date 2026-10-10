import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Dot, Memory, State, WorkspaceState } from '../shared/types';
import {
  setThemePreference,
  themePreference,
  type ThemePreference,
} from './theme';
export type Dialog =
  | { type: 'space' }
  | { type: 'dot'; dot?: Dot; spaceId: string }
  | { type: 'settings' }
  | { type: 'memory'; memory?: Memory };
export function dotPayload(dot: Dot, patch: Partial<Dot> = {}) {
  const next = { ...dot, ...patch };
  return {
    spaceId: next.spaceId,
    spaceIds: next.spaceIds,
    name: next.name,
    role: next.role,
    instructions: next.instructions,
    directory: next.directory,
    memoryAllowed: next.memoryAllowed,
  };
}
export function WorkspaceDialog({
  dialog,
  state,
  workspace,
  onClose,
  mutate,
}: {
  dialog: Dialog;
  state: State;
  workspace: WorkspaceState;
  onClose: () => void;
  mutate: (path: string, method: string, body?: unknown) => Promise<boolean>;
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
    dialog.type === 'dot'
      ? (editing?.instructions ?? '')
      : dialog.type === 'memory'
        ? (dialog.memory?.text ?? '')
        : '',
  );
  const [memory, setMemory] = useState(
    dialog.type === 'dot'
      ? (editing?.memoryAllowed ?? true)
      : state.settings.memoryAllowed,
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
        : dialog.type === 'settings'
          ? 'Your workspace, your rules.'
          : 'Something to remember.';
  const { core, backend } = workspace.setup;
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
                memoryAllowed: memory,
                ...(directory.trim() ? { directory: directory.trim() } : {}),
              };
            }
            if (dialog.type === 'settings') {
              path = '/settings';
              method = 'PATCH';
              body = { name, paused, memoryAllowed: memory };
            }
            if (dialog.type === 'memory') {
              path = dialog.memory
                ? `/memories/${dialog.memory.id}`
                : '/memories';
              method = dialog.memory ? 'PUT' : 'POST';
              body = { text };
            }
            if (await mutate(path, method, body)) onClose();
            else setError('Could not save. Review the error and retry.');
            setBusy(false);
          }}
        >
          {dialog.type !== 'memory' && (
            <>
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
            </>
          )}
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
                  : dialog.type === 'space'
                    ? 'What belongs here?'
                    : 'Preference or context'}
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
                Relative to the Hearth-Core workspace. Claude Code works here,
                and the computer’s Files tab shows it. Changing it starts new
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
                  Default destination for saved pages
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
          {(dialog.type === 'dot' || dialog.type === 'settings') && (
            <label className="permission-row">
              <input
                type="checkbox"
                checked={memory}
                onChange={(e) => setMemory(e.target.checked)}
              />
              <span>
                <strong>Use saved memories</strong>
                <small>
                  {dialog.type === 'dot'
                    ? 'Include your preferences in this Dot’s turns.'
                    : 'Turn memories off for every Dot at once.'}
                </small>
              </span>
            </label>
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
                    className={`online-dot ${core.reachable ? '' : 'off'}`}
                  />
                  Hearth-Core <code>{core.url}</code>:{' '}
                  {core.reachable
                    ? `connected${core.detail ? ` (${core.detail})` : ''}`
                    : (core.error ?? 'not reachable')}
                </p>
                <p>
                  <span
                    className={`online-dot ${backend.reachable ? '' : 'off'}`}
                  />
                  Hearth-backend <code>{backend.url}</code>:{' '}
                  {backend.reachable
                    ? `connected${backend.detail ? ` (${backend.detail})` : ''}`
                    : (backend.error ?? 'not reachable')}
                </p>
                <p>
                  Set <code>HEARTH_CORE_URL</code> and{' '}
                  <code>HEARTH_BACKEND_URL</code> on the server to point
                  elsewhere.
                </p>
              </div>
            </>
          )}
          {dialog.type === 'memory' && (
            <p className="muted">
              Memories are explicit preferences. Avoid secrets: Dots with memory
              on send them to the model with each turn.
            </p>
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
