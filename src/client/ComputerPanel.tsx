import { useCallback, useEffect, useState } from 'react';
import { Ban, Check, FileText, Maximize2, Minimize2, X } from 'lucide-react';
import type {
  ComputerPermissions,
  ComputerStatus,
  WorkspaceFile,
  WorkspaceListing,
} from '../shared/computer-types';
import { formatBytes } from '../shared/paths';
import type { Dot } from '../shared/types';
import { api } from './api';
import { FileTreeView } from './FileTreeView';
import { TerminalView } from './TerminalView';
import { DEFAULT_COMPUTER_WIDTH, MIN_COMPUTER_WIDTH } from './computer-size';
type Tab = 'Files' | 'Terminal' | 'Activity';
const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
/** Polls while the panel is open and the tab is visible. */
function usePoll(load: () => Promise<void>, ms: number, active = true) {
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      if (!document.hidden) await load();
      if (!stopped) timer = setTimeout(() => void tick(), ms);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [load, ms, active]);
}
export function ComputerPanel({
  dot,
  openFile,
  turnsFinished,
  width,
  expanded,
  onResize,
  onExpand,
  onClose,
}: {
  dot: Dot;
  /** Its width in pixels beside the conversation. */
  width: number;
  /** Covering the whole window. */
  expanded: boolean;
  /** A new width; ``done`` once the drag or key press is over, to remember it. */
  onResize: (width: number, done: boolean) => void;
  onExpand: (expanded: boolean) => void;
  /** A file to show, e.g. one a tool row linked to. */
  openFile?: { path: string; at: number };
  /** Changes whenever a turn ends, so the file list refreshes right away. */
  turnsFinished: number;
  onClose: () => void;
}) {
  const base = `/dots/${encodeURIComponent(dot.id)}/computer`;
  const [tab, setTab] = useState<Tab>('Files');
  const [status, setStatus] = useState<ComputerStatus>();
  const [error, setError] = useState('');
  const [listing, setListing] = useState<WorkspaceListing>();
  const [listingError, setListingError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<WorkspaceFile>();
  const [fileError, setFileError] = useState('');
  const [busy, setBusy] = useState('');
  // The terminal connects the first time its tab opens, then stays connected while the panel is.
  const [terminalOpened, setTerminalOpened] = useState(false);
  useEffect(() => {
    if (tab === 'Terminal') setTerminalOpened(true);
  }, [tab]);
  // The Files tab shows the container's whole workspace; the Dot's own folder starts open.
  const folder = status?.directory ?? dot.directory;
  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api<ComputerStatus>(base));
      setError('');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Computer unavailable.',
      );
    }
  }, [base]);
  const loadFiles = useCallback(async () => {
    try {
      setListing(await api<WorkspaceListing>(`${base}/files`));
      setListingError('');
    } catch (cause) {
      setListingError(
        cause instanceof Error ? cause.message : 'Could not list files.',
      );
    }
  }, [base]);
  usePoll(loadStatus, 4000);
  usePoll(loadFiles, 5000, tab === 'Files');
  useEffect(() => {
    if (turnsFinished) {
      void loadFiles();
      void loadStatus();
    }
  }, [turnsFinished, loadFiles, loadStatus]);
  // Tool rows link files by their path in the Dot's folder.
  useEffect(() => {
    if (!openFile) return;
    setTab('Files');
    setSelected(`${folder}/${openFile.path}`);
    // folder is read when a link is followed, not watched.
  }, [openFile]);
  useEffect(() => {
    setFile(undefined);
    setFileError('');
    if (!selected) return;
    let active = true;
    void api<WorkspaceFile>(`${base}/file?path=${encodeURIComponent(selected)}`)
      .then((next) => active && setFile(next))
      .catch(
        (cause) =>
          active &&
          setFileError(
            cause instanceof Error ? cause.message : 'Could not open the file.',
          ),
      );
    return () => {
      active = false;
    };
  }, [base, selected, turnsFinished]);
  const permission = async (key: keyof ComputerPermissions, value: boolean) => {
    setBusy(key);
    try {
      await api(`${base}/permissions`, 'PATCH', { [key]: value });
      await loadStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
    } finally {
      setBusy('');
    }
  };
  // Esc leaves full screen.
  useEffect(() => {
    if (!expanded) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExpand(false);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [expanded, onExpand]);
  /** Drag the left edge: the panel is anchored right, so its width is the distance to the edge. */
  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing-computer');
    const move = (next: PointerEvent) =>
      onResize(window.innerWidth - next.clientX, false);
    const end = (last: PointerEvent) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      document.body.classList.remove('resizing-computer');
      onResize(window.innerWidth - last.clientX, true);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };
  const running = status?.state === 'running';
  return (
    <aside
      className={`computer ${expanded ? 'expanded' : ''}`}
      aria-label={`${dot.name}'s computer`}
    >
      {!expanded && (
        <div
          className="computer-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize computer"
          aria-valuenow={width}
          aria-valuemin={MIN_COMPUTER_WIDTH}
          title="Drag to resize · double-click to reset"
          tabIndex={0}
          onPointerDown={drag}
          onDoubleClick={() => onResize(DEFAULT_COMPUTER_WIDTH, true)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 96 : 24;
            if (event.key === 'ArrowLeft') onResize(width + step, true);
            else if (event.key === 'ArrowRight') onResize(width - step, true);
            else return;
            event.preventDefault();
          }}
        />
      )}
      <header className="computer-head">
        <h2>Computer</h2>
        <div className="computer-head-actions">
          <button
            className="icon-button"
            aria-label={expanded ? 'Exit full screen' : 'Full screen'}
            title={expanded ? 'Exit full screen (Esc)' : 'Full screen'}
            aria-pressed={expanded}
            onClick={() => onExpand(!expanded)}
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            className="icon-button"
            aria-label="Close computer"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="computer-bar">
        <div
          className="computer-tabs"
          role="tablist"
          aria-label="Computer tools"
        >
          {(['Files', 'Terminal', 'Activity'] as const).map((name) => (
            <button
              key={name}
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <span className={`run-state ${running ? 'on' : ''}`}>
          {status ? (running ? 'Running' : 'Offline') : 'Checking'}
        </span>
      </div>
      {(error || status?.error) && (
        <p className="computer-error" role="alert">
          {error || status?.error}
        </p>
      )}
      <div className="computer-body">
        {tab === 'Files' && (
          <section className="computer-files" aria-label="Files">
            <div className="files-tree">
              {listing?.files.length ? (
                <FileTreeView
                  files={listing.files}
                  open={folder}
                  selected={selected}
                  onSelect={setSelected}
                />
              ) : (
                <p className="computer-empty">
                  {listingError ||
                    (listing
                      ? `${dot.name}’s container has no files yet.`
                      : 'Loading files…')}
                </p>
              )}
              {listing?.truncated && (
                <p className="computer-hint">Showing the first 5,000 files.</p>
              )}
            </div>
            {selected && (
              <div className="file-view">
                <div className="file-view-head">
                  <FileText size={14} aria-hidden="true" />
                  <span title={selected}>{selected}</span>
                  {file && <small>{formatBytes(file.size)}</small>}
                  <button
                    className="icon-button"
                    aria-label="Close file"
                    onClick={() => setSelected(null)}
                  >
                    <X size={14} />
                  </button>
                </div>
                {fileError ? (
                  <p className="computer-error">{fileError}</p>
                ) : !file ? (
                  <p className="computer-empty">Opening…</p>
                ) : file.binary ? (
                  <p className="computer-empty">
                    This is a binary file ({formatBytes(file.size)}).
                  </p>
                ) : (
                  <pre tabIndex={0}>
                    {file.text}
                    {file.truncated && '\n…'}
                  </pre>
                )}
              </div>
            )}
          </section>
        )}
        {terminalOpened && (
          <TerminalView dot={dot} visible={tab === 'Terminal'} />
        )}
        {tab === 'Activity' && (
          <section aria-label="Activity">
            {status?.activity.length ? (
              <ol className="activity-list">
                {status.activity.map((entry) => (
                  <li key={entry.id} className={entry.outcome}>
                    <span className="activity-mark">
                      {entry.outcome === 'denied' ? (
                        <Ban size={12} />
                      ) : entry.outcome === 'succeeded' ? (
                        <Check size={12} />
                      ) : (
                        <span className="activity-dot" />
                      )}
                    </span>
                    <span className="activity-text">
                      <strong>{entry.tool}</strong>
                      <span title={entry.summary}>{entry.summary}</span>
                    </span>
                    <time>{time(entry.createdAt)}</time>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="computer-empty">No activity yet.</p>
            )}
          </section>
        )}
      </div>
      <div className="computer-perms">
        <span>Permissions</span>
        <div>
          {(['files', 'shell'] as const).map((key) => (
            <button
              key={key}
              className="chip"
              aria-pressed={!!status?.permissions[key]}
              disabled={!status || !!busy}
              title={
                key === 'files'
                  ? 'Create and edit files in its folder'
                  : 'Run commands (the Hearth-Core policy still blocks network tools, sudo and git remotes)'
              }
              onClick={() => void permission(key, !status?.permissions[key])}
            >
              {key === 'files' ? 'Files' : 'Shell'}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
