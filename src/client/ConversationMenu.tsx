import { useEffect, useRef, useState } from 'react';
import { Check, History, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Conversation } from '../shared/types';
import { shortTime } from './Sidebar';

type RowMode = 'idle' | 'renaming' | 'confirming';

/** One conversation in the menu: open it, rename it in place, or delete it after a confirm. */
function ConversationRow({
  conversation,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  conversation: Conversation;
  active: boolean;
  onSelect: () => void;
  onRename?: (title: string) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [mode, setMode] = useState<RowMode>('idle');
  const [title, setTitle] = useState(conversation.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      setMode('idle');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };
  if (mode === 'renaming' && onRename)
    return (
      <form
        className="conversation-row editing"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim() && !busy) void run(() => onRename(title.trim()));
        }}
      >
        <input
          autoFocus
          aria-label="Conversation title"
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              // Cancel the rename, not the whole menu.
              event.preventDefault();
              event.stopPropagation();
              setTitle(conversation.title);
              setMode('idle');
            }
          }}
        />
        <button
          className="icon-button"
          aria-label="Save title"
          disabled={!title.trim() || busy}
        >
          <Check size={14} />
        </button>
        {error && <p className="conversation-row-error">{error}</p>}
      </form>
    );
  if (mode === 'confirming' && onDelete)
    return (
      <div
        className="conversation-row confirming"
        role="alertdialog"
        aria-label="Delete conversation"
      >
        <span>Delete “{conversation.title}”?</span>
        <button
          className="danger"
          disabled={busy}
          onClick={() => void run(onDelete)}
        >
          {busy ? 'Deleting…' : 'Delete'}
        </button>
        <button
          className="icon-button"
          aria-label="Keep conversation"
          disabled={busy}
          onClick={() => {
            setError('');
            setMode('idle');
          }}
        >
          <X size={14} />
        </button>
        {error && <p className="conversation-row-error">{error}</p>}
      </div>
    );
  return (
    <div className={`conversation-row ${active ? 'active' : ''}`}>
      <button role="menuitem" className="conversation-open" onClick={onSelect}>
        <span>{conversation.title}</span>
        <time>{shortTime(conversation.updatedAt)}</time>
      </button>
      {onRename && (
        <button
          className="icon-button conversation-action"
          aria-label={`Rename ${conversation.title}`}
          title="Rename"
          onClick={() => {
            setTitle(conversation.title);
            setMode('renaming');
          }}
        >
          <Pencil size={13} />
        </button>
      )}
      {onDelete && (
        <button
          className="icon-button conversation-action"
          aria-label={`Delete ${conversation.title}`}
          title="Delete"
          onClick={() => setMode('confirming')}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

/** The Dot's conversations, newest first, plus a way to start another, rename or delete one. */
export function ConversationMenu({
  conversations,
  selected,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: {
  conversations: Conversation[];
  selected?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** Renames a conversation; a thrown error shows in its row. */
  onRename?: (id: string, title: string) => Promise<void>;
  /** Deletes a conversation; a thrown error (running, or a page's own) shows in its row. */
  onDelete?: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !root.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div className="conversation-menu" ref={root}>
      <button
        className={`icon-button ${open ? 'active' : ''}`}
        aria-label="Conversations"
        aria-expanded={open}
        title="Conversations"
        onClick={() => setOpen(!open)}
      >
        <History size={17} />
      </button>
      {open && (
        <div className="menu-popover conversation-popover" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onNew();
            }}
          >
            <Plus size={14} /> New conversation
          </button>
          {conversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === selected}
              onSelect={() => {
                setOpen(false);
                onSelect(conversation.id);
              }}
              onRename={
                onRename && ((title) => onRename(conversation.id, title))
              }
              onDelete={onDelete && (() => onDelete(conversation.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
