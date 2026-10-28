import { FileText, Monitor } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { matchFiles } from './file-reference';
// The composer's "+": a searchable list of the Dot's files. Choosing one puts @path into
// the message. Arrow keys move, Enter picks, Escape closes.

export function FilePicker({
  name,
  load,
  onPick,
  onClose,
  onOpenFiles,
}: {
  /** The Dot's name, for the empty and loading text. */
  name: string;
  /** The Dot's files, relative to its folder. Keep it stable: each new one reloads. */
  load: () => Promise<string[]>;
  onPick: (path: string) => void;
  onClose: () => void;
  onOpenFiles?: () => void;
}) {
  const [files, setFiles] = useState<string[]>();
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useId();
  useEffect(() => {
    let active = true;
    load()
      .then((found) => {
        if (active) setFiles(found);
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : 'Could not list files.',
          );
      });
    return () => {
      active = false;
    };
  }, [load]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onClose]);
  const matches = files ? matchFiles(files, query) : [];
  const current = Math.min(index, Math.max(matches.length - 1, 0));
  let note = '';
  if (error) note = error;
  else if (!files) note = `Loading ${name}’s files…`;
  else if (!files.length) note = `${name}’s folder has no files yet.`;
  else if (!matches.length) note = 'No files match.';
  return (
    <div
      className="file-picker"
      ref={root}
      role="dialog"
      aria-label={`Reference one of ${name}’s files`}
    >
      <input
        autoFocus
        type="search"
        aria-label="Search files"
        placeholder="Search files"
        role="combobox"
        aria-expanded="true"
        aria-controls={list}
        aria-activedescendant={
          matches.length ? `${list}-${current}` : undefined
        }
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!matches.length) return;
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setIndex((current + step + matches.length) % matches.length);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            if (matches[current]) onPick(matches[current]);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <div className="file-picker-list" id={list} role="listbox">
        {note && (
          <p className="file-picker-note" role="status">
            {note}
          </p>
        )}
        {matches.map((path, position) => {
          const slash = path.lastIndexOf('/');
          return (
            <button
              key={path}
              id={`${list}-${position}`}
              type="button"
              role="option"
              aria-selected={position === current}
              className={position === current ? 'active' : undefined}
              tabIndex={-1}
              onMouseEnter={() => setIndex(position)}
              onClick={() => onPick(path)}
            >
              <FileText size={14} aria-hidden="true" />
              <span className="file-name">{path.slice(slash + 1)}</span>
              {slash > 0 && (
                <span className="file-dir">{path.slice(0, slash)}</span>
              )}
            </button>
          );
        })}
      </div>
      {onOpenFiles && (
        <button
          type="button"
          className="file-picker-foot"
          onClick={() => {
            onClose();
            onOpenFiles();
          }}
        >
          <Monitor size={14} aria-hidden="true" /> Open the Files panel
        </button>
      )}
    </div>
  );
}
