import type React from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Boxes,
  FileText,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
} from 'lucide-react';
import { Mascot } from './Mascot';
import { WELCOME_URL } from './landing-link';
import { STAGE_LABEL, working } from './space-stage';
import type { Conversation, Dot, Space, WorkspaceState } from '../shared/types';
import { agentOf } from '../shared/agents';
/**
 * Where the active Dot's row sits in the list (``top`` and ``height``, in pixels), so one
 * highlight can glide between rows. Undefined until measured, or when no row is active or
 * visible: the row then keeps its own background. ``layout`` changes whenever the rows do.
 */
function useRowHighlight(
  list: React.RefObject<HTMLElement | null>,
  activeDot: string | undefined,
  layout: string,
) {
  const [place, setPlace] = useState<{ top: number; height: number }>();
  useLayoutEffect(() => {
    const measure = () => {
      const row = activeDot
        ? list.current?.querySelector<HTMLElement>(
            `[data-dot-id="${CSS.escape(activeDot)}"]`,
          )
        : null;
      setPlace(
        row ? { top: row.offsetTop, height: row.offsetHeight } : undefined,
      );
    };
    if (typeof window === 'undefined' || !list.current) return;
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [list, activeDot, layout]);
  return place;
}
/** One word for a Space's state: ready, on its way, or waiting for setup. */
export function spaceHealth(space: Space) {
  if (space.stage === 'ready')
    return space.signedIn === false ? 'setup' : 'ready';
  return working(space.stage) ? 'working' : 'setup';
}
function spaceLabel(space: Space) {
  if (space.stage === 'ready' && space.signedIn === false)
    return `Sign in to ${agentOf(space).account}`;
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
/** A Dot's "…" menu: its Space's Setup and Pages. Each Dot is a Space. */
function DotMenu({
  dot,
  space,
  onSetup,
  onPages,
}: {
  dot: Dot;
  space?: Space;
  onSetup: () => void;
  onPages: () => void;
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
  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <div className={`dot-menu ${open ? 'open' : ''}`} ref={root}>
      <button
        className="icon-button dot-row-edit"
        aria-label={`${dot.name} options`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div className="menu-popover" role="menu">
          <button role="menuitem" onClick={choose(onSetup)}>
            <Boxes size={14} aria-hidden="true" />
            <span>Setup</span>
            {space && (
              <small>
                <i
                  className={`space-health ${spaceHealth(space)}`}
                  aria-hidden="true"
                />
                {spaceLabel(space)}
              </small>
            )}
          </button>
          <button role="menuitem" onClick={choose(onPages)}>
            <FileText size={14} aria-hidden="true" />
            <span>Pages</span>
            {space && <small>{space.pageCount}</small>}
          </button>
        </div>
      )}
    </div>
  );
}
export function Sidebar({
  workspace,
  open,
  search,
  activeDot,
  onSearch,
  onDot,
  onCreateDot,
  onSetup,
  onPages,
  onSettings,
}: {
  workspace: WorkspaceState;
  open: boolean;
  search: string;
  activeDot?: string;
  onSearch: (value: string) => void;
  onDot: (dot: Dot) => void;
  onCreateDot: () => void;
  /** Open a Space's Setup page: its container, its agent and GitHub. */
  onSetup: (spaceId: string) => void;
  /** Open a Space's Pages. */
  onPages: (spaceId: string) => void;
  onSettings: () => void;
}) {
  const query = search.trim().toLowerCase();
  const dots = workspace.dots
    .map((dot) => ({
      dot,
      latest: latestConversation(workspace.conversations, dot.id),
    }))
    .filter(
      ({ dot, latest }) =>
        !query ||
        dot.name.toLowerCase().includes(query) ||
        latest?.preview.toLowerCase().includes(query),
    );
  const nav = useRef<HTMLElement>(null);
  const highlight = useRowHighlight(
    nav,
    activeDot,
    dots
      .map(({ dot, latest }) => `${dot.id}:${latest?.preview ?? ''}`)
      .join('|'),
  );
  return (
    <aside id="workspace-sidebar" className={`sidebar ${open ? 'open' : ''}`}>
      <div className="brand-row">
        {/* The logo goes to the landing page; its "Open Hearth" comes back here. */}
        <a className="brand" href={WELCOME_URL} title="About Hearth">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          Hearth
        </a>
        <button
          className="icon-button"
          aria-label="New Dot"
          title="New Dot: spins up its own container"
          onClick={onCreateDot}
        >
          <Plus size={17} />
        </button>
      </div>
      <label className="sidebar-search">
        <Search size={15} aria-hidden="true" />
        <input
          aria-label="Search Dots"
          placeholder="Search..."
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </label>
      <nav
        className={`sidebar-scroll ${highlight ? 'has-highlight' : ''}`}
        aria-label="Workspace"
        ref={nav}
      >
        {/* The active Dot's background, one shape that glides from row to row. */}
        {highlight && (
          <span
            className="dot-highlight"
            aria-hidden="true"
            style={{
              transform: `translateY(${highlight.top}px)`,
              height: highlight.height,
            }}
          />
        )}
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
            data-dot-id={dot.id}
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
                {(latest?.preview || latest?.title) && (
                  <span className="dot-row-preview">
                    {latest.preview || latest.title}
                  </span>
                )}
              </span>
            </button>
            <DotMenu
              dot={dot}
              space={workspace.spaces.find((space) => space.id === dot.spaceId)}
              onSetup={() => onSetup(dot.spaceId)}
              onPages={() => onPages(dot.spaceId)}
            />
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
