import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
// "Save conversation as page": the app's own dialog instead of the browser's prompt box.

export function SavePageDialog({
  initialTitle,
  onSave,
  onClose,
}: {
  initialTitle: string;
  /** Saves the page; a thrown error is shown in the dialog. */
  onSave: (title: string) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.select();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [busy, onClose]);
  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <section
        className="modal save-page-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-page-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="modal-close icon-button"
          aria-label="Close dialog"
          onClick={onClose}
          disabled={busy}
        >
          <X size={18} />
        </button>
        <h2 id="save-page-title">Save as a page</h2>
        <p className="muted">
          The conversation becomes a page you can edit and share in this Space.
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!title.trim() || busy) return;
            setBusy(true);
            setError('');
            try {
              await onSave(title.trim());
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : 'Could not save the page.',
              );
              setBusy(false);
            }
          }}
        >
          <label className="field-label" htmlFor="save-page-name">
            Page title
          </label>
          <input
            id="save-page-name"
            ref={input}
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
          {error && (
            <p className="chat-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="primary" disabled={!title.trim() || busy}>
              {busy ? 'Saving…' : 'Save page'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
