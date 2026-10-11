import { Folder, MoreHorizontal, Plus, Search, Settings2 } from 'lucide-react';
import { Mascot } from './Mascot';
import { STAGE_LABEL, working } from './space-stage';
import type { Conversation, Dot, Space, WorkspaceState } from '../shared/types';
/** One word for the Space's dot in the sidebar: ready, working, or needs setup. */
export function spaceHealth(space: Space) {
  if (space.stage === 'ready')
    return space.claude === false ? 'setup' : 'ready';
  return working(space.stage) ? 'working' : 'setup';
}
function spaceTitle(space: Space) {
  if (space.stage === 'ready' && space.claude === false)
    return 'Running · Claude Code is not signed in';
  return STAGE_LABEL[space.stage];
}
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
  open,
  search,
  activeDot,
  activeSpace,
  onSearch,
  onNew,
  onDot,
  onEditDot,
  onCreateDot,
  onSpace,
  onCreateSpace,
  onSettings,
}: {
  workspace: WorkspaceState;
  open: boolean;
  search: string;
  activeDot?: string;
  activeSpace?: string;
  onSearch: (value: string) => void;
  onNew: () => void;
  onDot: (dot: Dot) => void;
  onEditDot: (dot: Dot) => void;
  onCreateDot: () => void;
  onSpace: (spaceId: string) => void;
  onCreateSpace: () => void;
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
            <span
              className={`space-health ${spaceHealth(space)}`}
              title={spaceTitle(space)}
              aria-label={spaceTitle(space)}
              role="img"
            />
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
        <button className="nav-row" onClick={onSettings}>
          <Settings2 size={16} aria-hidden="true" />
          <span className="nav-row-name">Settings</span>
        </button>
      </div>
    </aside>
  );
}
