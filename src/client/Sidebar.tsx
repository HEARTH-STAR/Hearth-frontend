import {
  BookOpen,
  Folder,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
} from 'lucide-react';
import { Mascot } from './Mascot';
import type {
  Conversation,
  Dot,
  Settings,
  WorkspaceState,
} from '../shared/types';
/** ``11:42 AM`` today, ``Mon`` this week, ``Oct 3`` before that. */
export function shortTime(at: number, now = Date.now()) {
  const date = new Date(at);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString())
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (now - at < 6 * 24 * 3600 * 1000)
    return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    parts.length > 1
      ? parts[0][0] + parts.at(-1)![0]
      : (parts[0] ?? '?').slice(0, 2)
  ).toUpperCase();
}
export function latestConversation(
  conversations: Conversation[],
  dotId: string,
) {
  return conversations
    .filter((conversation) => conversation.dotId === dotId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}
export function Sidebar({
  workspace,
  settings,
  open,
  search,
  activeDot,
  activeSpace,
  memoryActive,
  onSearch,
  onNew,
  onDot,
  onEditDot,
  onCreateDot,
  onSpace,
  onCreateSpace,
  onMemory,
  onSettings,
}: {
  workspace: WorkspaceState;
  settings: Settings;
  open: boolean;
  search: string;
  activeDot?: string;
  activeSpace?: string;
  memoryActive: boolean;
  onSearch: (value: string) => void;
  onNew: () => void;
  onDot: (dot: Dot) => void;
  onEditDot: (dot: Dot) => void;
  onCreateDot: () => void;
  onSpace: (spaceId: string) => void;
  onCreateSpace: () => void;
  onMemory: () => void;
  onSettings: () => void;
}) {
  const query = search.trim().toLowerCase();
  const spaces = workspace.spaces.filter((space) =>
    space.name.toLowerCase().includes(query),
  );
  const dots = workspace.dots
    .map((dot) => ({
      dot,
      latest: latestConversation(workspace.conversations, dot.id),
    }))
    .filter(
      ({ dot, latest }) =>
        !query ||
        dot.name.toLowerCase().includes(query) ||
        dot.role.toLowerCase().includes(query) ||
        latest?.preview.toLowerCase().includes(query),
    );
  return (
    <aside id="workspace-sidebar" className={`sidebar ${open ? 'open' : ''}`}>
      <div className="brand-row">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          Hearth
        </span>
        <button
          className="icon-button"
          aria-label="New conversation"
          title="New conversation"
          onClick={onNew}
        >
          <Plus size={17} />
        </button>
      </div>
      <label className="sidebar-search">
        <Search size={15} aria-hidden="true" />
        <input
          aria-label="Search Spaces and Dots"
          placeholder="Search..."
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </label>
      <nav className="sidebar-scroll" aria-label="Workspace">
        <div className="nav-label">
          SPACES
          <button
            className="icon-button"
            aria-label="Create Space"
            onClick={onCreateSpace}
          >
            <Plus size={13} />
          </button>
        </div>
        {spaces.map((space) => (
          <button
            key={space.id}
            className={`nav-row space-row ${activeSpace === space.id ? 'active' : ''}`}
            aria-current={activeSpace === space.id ? 'page' : undefined}
            onClick={() => onSpace(space.id)}
          >
            <Folder size={16} aria-hidden="true" />
            <span className="nav-row-name">{space.name}</span>
            {space.pageCount > 0 && <small>{space.pageCount}</small>}
          </button>
        ))}
        {!spaces.length && <p className="sidebar-empty">No Spaces match.</p>}
        <div className="nav-label">
          DOTS
          <button
            className="icon-button"
            aria-label="Create Dot"
            onClick={onCreateDot}
          >
            <Plus size={13} />
          </button>
        </div>
        {dots.map(({ dot, latest }) => (
          <div
            key={dot.id}
            className={`dot-row ${activeDot === dot.id ? 'active' : ''}`}
          >
            <button
              className="dot-row-main"
              aria-current={activeDot === dot.id ? 'page' : undefined}
              onClick={() => onDot(dot)}
            >
              <Mascot identity={dot.id} name={dot.name} small decorative />
              <span className="dot-row-text">
                <span className="dot-row-top">
                  <strong>{dot.name}</strong>
                  {latest && <time>{shortTime(latest.updatedAt)}</time>}
                </span>
                <span className="dot-row-preview">
                  {latest?.preview || latest?.title || dot.role || 'Say hello'}
                </span>
              </span>
            </button>
            <button
              className="icon-button dot-row-edit"
              aria-label={`Edit ${dot.name}`}
              onClick={() => onEditDot(dot)}
            >
              <MoreHorizontal size={15} />
            </button>
          </div>
        ))}
        {!dots.length && <p className="sidebar-empty">No Dots match.</p>}
      </nav>
      <div className="sidebar-foot">
        <button
          className={`nav-row ${memoryActive ? 'active' : ''}`}
          onClick={onMemory}
        >
          <BookOpen size={16} aria-hidden="true" />
          <span className="nav-row-name">Memory</span>
        </button>
        <button className="nav-row" onClick={onSettings}>
          <Settings2 size={16} aria-hidden="true" />
          <span className="nav-row-name">Settings</span>
        </button>
        <button className="nav-row owner-row" onClick={onSettings}>
          <span className="owner-avatar" aria-hidden="true">
            {initials(settings.name)}
          </span>
          <span className="nav-row-name">{settings.name}</span>
        </button>
      </div>
    </aside>
  );
}
