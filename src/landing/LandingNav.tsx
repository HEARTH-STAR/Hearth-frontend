import { ArrowRight, Menu, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ThemeToggle } from './ThemeToggle';
// The landing page's top bar. It stays at the top while you scroll, slims down and
// gains an edge once the page moves, marks the section you are reading, and fills a
// thin line as you go. On phones its links move into a menu.

export const NAV_LINKS = [
  { id: 'problem', label: 'Problem' },
  { id: 'how', label: 'How it works' },
  { id: 'safety', label: 'Safety' },
  { id: 'requirements', label: 'What you need' },
];
/** Every section in page order, including those without a link (they clear the mark). */
export const SECTION_ORDER = [
  'problem',
  'how',
  'dots',
  'features',
  'safety',
  'requirements',
];
/** How far below the top of the window a section counts as "being read". */
const READING_LINE = 140;
/** Below this width the links live in the menu (matches landing.css). */
const PHONE = 860;

/** The last section whose top has passed the reading line, if any. */
export function activeSection(
  sections: { id: string; top: number }[],
  line = READING_LINE,
): string | undefined {
  let current: string | undefined;
  for (const section of sections) if (section.top <= line) current = section.id;
  return current;
}

/** How much of the page has been scrolled through, from 0 to 1. */
export function readingProgress(
  scrollY: number,
  scrollHeight: number,
  viewport: number,
) {
  const room = scrollHeight - viewport;
  if (room <= 0) return 0;
  return Math.min(1, Math.max(0, scrollY / room));
}

function useScrollState() {
  const [state, setState] = useState<{
    active?: string;
    scrolled: boolean;
    progress: number;
  }>({ scrolled: false, progress: 0 });
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const sections = SECTION_ORDER.flatMap((id) => {
        const element = document.getElementById(id);
        return element
          ? [{ id, top: element.getBoundingClientRect().top }]
          : [];
      });
      const active = activeSection(sections);
      const scrolled = window.scrollY > 4;
      // Rounded to a thousandth, so tiny scrolls don't re-render the bar.
      const progress =
        Math.round(
          readingProgress(
            window.scrollY,
            document.documentElement.scrollHeight,
            window.innerHeight,
          ) * 1000,
        ) / 1000;
      setState((current) =>
        current.active === active &&
        current.scrolled === scrolled &&
        current.progress === progress
          ? current
          : { active, scrolled, progress },
      );
    };
    // At most one measurement per frame, however fast the page scrolls.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);
  return state;
}

/** The phone menu: closes on a pick, Escape, a click outside, or a wider window. */
function useMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const resize = () => {
      if (window.innerWidth > PHONE) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', resize);
    };
  }, [open]);
  return { open, setOpen, root };
}

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/** GitHub's mark, drawn inline (no icon font or outside image needed). */
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

export function LandingNav({
  appUrl,
  githubUrl,
}: {
  appUrl: string;
  githubUrl: string;
}) {
  const { active, scrolled, progress } = useScrollState();
  const menu = useMenu();
  const links = (onPick?: () => void) =>
    NAV_LINKS.map((link) => (
      <a
        key={link.id}
        href={`#${link.id}`}
        className={active === link.id ? 'active' : undefined}
        aria-current={active === link.id ? 'location' : undefined}
        onClick={onPick}
      >
        {link.label}
      </a>
    ));
  return (
    <header
      ref={menu.root}
      className={`landing-nav ${scrolled ? 'scrolled' : ''}`}
    >
      <a className="skip-link" href="#top">
        Skip to content
      </a>
      <a className="landing-brand" href="#top">
        <BrandMark />
        Hearth
      </a>
      <nav className="landing-links" aria-label="Landing">
        {links()}
      </nav>
      <div className="landing-nav-actions">
        <a
          className="nav-icon nav-github"
          href={githubUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="Hearth on GitHub"
          title="Hearth on GitHub"
        >
          <GitHubMark />
        </a>
        <ThemeToggle />
        <a className="landing-button small" href={appUrl}>
          Open Hearth <ArrowRight size={14} aria-hidden="true" />
        </a>
        <button
          type="button"
          className="nav-icon menu-toggle"
          aria-label={menu.open ? 'Close menu' : 'Open menu'}
          aria-expanded={menu.open}
          aria-controls="landing-menu"
          onClick={() => menu.setOpen(!menu.open)}
        >
          {menu.open ? (
            <X size={18} aria-hidden="true" />
          ) : (
            <Menu size={18} aria-hidden="true" />
          )}
        </button>
      </div>
      <nav
        id="landing-menu"
        className="landing-menu"
        aria-label="Landing menu"
        hidden={!menu.open}
      >
        {links(() => menu.setOpen(false))}
        <a
          className="menu-github"
          href={githubUrl}
          target="_blank"
          rel="noreferrer"
        >
          <GitHubMark /> Hearth on GitHub
        </a>
      </nav>
      {/* Reading progress: a thin line under the bar that fills as you scroll. */}
      <span className="nav-progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${progress})` }} />
      </span>
    </header>
  );
}
