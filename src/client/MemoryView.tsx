import { BookOpen, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import type { Memory, Settings } from '../shared/types';
import { Mascot } from './Mascot';
export function MemoryView({
  memories,
  settings,
  onAdd,
  onEdit,
  onDelete,
}: {
  memories: Memory[];
  settings: Settings;
  onAdd: () => void;
  onEdit: (memory: Memory) => void;
  onDelete: (memory: Memory) => void;
}) {
  return (
    <main className="memory-view">
      <div className="page-heading">
        <div>
          <span className="eyebrow">MEMORY</span>
          <h1>What your Dots know about you.</h1>
          <p>
            Preferences you choose to share. Dots with memory on include them in
            every turn.
          </p>
        </div>
        <button className="primary" onClick={onAdd}>
          <Plus size={15} />
          Add memory
        </button>
      </div>
      <div className="memory-grid">
        {memories.map((memory) => (
          <article className="memory-card" key={memory.id}>
            <BookOpen size={17} aria-hidden="true" />
            <p>{memory.text}</p>
            <div>
              <small>
                {settings.memoryAllowed
                  ? 'Shared with Dots that have memory on'
                  : 'Memory is off in Settings'}
              </small>
              <button
                className="icon-button"
                aria-label="Edit memory"
                onClick={() => onEdit(memory)}
              >
                <MoreHorizontal size={16} />
              </button>
              <button
                className="icon-button"
                aria-label="Delete memory"
                onClick={() => onDelete(memory)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {!memories.length && (
        <div className="large-empty">
          <Mascot />
          <h2>A little context goes a long way.</h2>
          <p>
            Add a preference like “Keep my research briefs short.” You can
            change or remove it anytime.
          </p>
        </div>
      )}
    </main>
  );
}
