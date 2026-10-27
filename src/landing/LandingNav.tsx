import { useEffect, useState } from 'react';
import { ThemeToggle } from './ThemeToggle';
// The landing page's top bar. It stays at the top while you scroll, gains a soft
// border once the page moves, and marks the link of the section you are reading.

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

/** The last section whose top has passed the reading line, if any. */
export function activeSection(
  sections: { id: string; top: number }[],
  line = READING_LINE,
): string | undefined {
  let current: string | undefined;
  for (const section of sections) if (section.top <= line) current = section.id;
  return current;
}

function useScrollState() {
  const [state, setState] = useState<{ active?: string; scrolled: boolean }>({
    scrolled: false,
  });
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
      setState((current) =>
        current.active === active && current.scrolled === scrolled
          ? current
          : { active, scrolled },
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

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export function LandingNav({ appUrl }: { appUrl: string }) {
  const { active, scrolled } = useScrollState();
  return (
    <header className={`landing-nav ${scrolled ? 'scrolled' : ''}`}>
      <a className="landing-brand" href="#top">
        <BrandMark />
        Hearth
      </a>
      <nav aria-label="Landing">
        {NAV_LINKS.map((link) => (
          <a
            key={link.id}
            href={`#${link.id}`}
            className={active === link.id ? 'active' : undefined}
            aria-current={active === link.id ? 'location' : undefined}
          >
            {link.label}
          </a>
        ))}
        <ThemeToggle />
        <a className="landing-button small" href={appUrl}>
          Open Hearth
        </a>
      </nav>
    </header>
  );
}

export { BrandMark };
