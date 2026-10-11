import { useCallback, useEffect, useState } from 'react';
import { Ban, Check, FileText, X } from 'lucide-react';
import type {
  ComputerActivity,
  ComputerPermissions,
  ComputerStatus,
  WorkspaceFile,
  WorkspaceListing,
} from '../shared/computer-types';
import { formatBytes } from '../shared/paths';
import type { Dot } from '../shared/types';
import { api } from './api';
import { FileTreeView } from './FileTreeView';
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
  onClose,
}: {
  dot: Dot;
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
  useEffect(() => {
    if (!openFile) return;
    setTab('Files');
    setSelected(openFile.path);
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
  const running = status?.state === 'running';
  const terminal =
    status?.activity.filter((entry) => entry.tool === 'Bash') ?? [];
  return (
    <aside className="computer" aria-label={`${dot.name}'s computer`}>
      <header className="computer-head">
        <h2>Computer</h2>
        <button
          className="icon-button"
          aria-label="Close computer"
          onClick={onClose}
        >
          <X size={17} />
        </button>
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
                  selected={selected}
                  onSelect={setSelected}
                />
              ) : (
                <p className="computer-empty">
                  {listingError ||
                    (listing
                      ? `No files yet. Ask ${dot.name} to save something and it appears here.`
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
        {tab === 'Terminal' && (
          <section className="computer-terminal" aria-label="Terminal">
            {terminal.length ? (
              [...terminal].reverse().map((entry) => (
                <div
                  className={`terminal-entry ${entry.outcome}`}
                  key={entry.id}
                >
                  <div className="terminal-command">
                    <span>$</span> {entry.summary}
                  </div>
                  {entry.detail && <pre>{terminalOutput(entry)}</pre>}
                </div>
              ))
            ) : (
              <p className="terminal-empty">
                {status?.permissions.shell
                  ? `Commands ${dot.name} runs show up here.`
                  : `Shell is off. Turn it on below to let ${dot.name} run commands.`}
              </p>
            )}
          </section>
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
function terminalOutput(entry: ComputerActivity) {
  if (!entry.detail) return '';
  try {
    const value = JSON.parse(entry.detail) as {
      stdout?: string;
      stderr?: string;
    };
    return (
      [value.stdout, value.stderr].filter(Boolean).join('\n') || entry.detail
    );
  } catch {
    return entry.detail;
  }
}
