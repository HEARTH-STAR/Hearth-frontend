import { useEffect, useRef, useState } from 'react';
import { History, Plus } from 'lucide-react';
import type { Conversation } from '../shared/types';
import { shortTime } from './Sidebar';
/** The Dot's conversations, newest first, plus a way to start another. */
export function ConversationMenu({
  conversations,
  selected,
  onSelect,
  onNew,
}: {
  conversations: Conversation[];
  selected?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
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
        <div className="menu-popover" role="menu">
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
            <button
              key={conversation.id}
              role="menuitem"
              className={conversation.id === selected ? 'active' : ''}
              onClick={() => {
                setOpen(false);
                onSelect(conversation.id);
              }}
            >
              <span>{conversation.title}</span>
              <time>{shortTime(conversation.updatedAt)}</time>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
