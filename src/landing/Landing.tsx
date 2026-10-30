import {
  ArrowRight,
  BellOff,
  Boxes,
  CircleCheck,
  Container,
  FileSearch,
  GitBranch,
  KeyRound,
  Laptop,
  Monitor,
  ScrollText,
  ShieldCheck,
  SquareTerminal,
  TriangleAlert,
  UserCheck,
  Wrench,
} from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { AGENT_IDS, AGENTS } from '../shared/agents';
import { HeroDemo } from './HeroDemo';
import { TypedPhrase } from './TypedPhrase';
import { BrandMark, LandingNav } from './LandingNav';
import { TestsVisual, UsageVisual } from './FeatureVisuals';
// The public landing page at /welcome/, for developers whose code depends on vendors'
// APIs and SDKs. The app itself stays at /. Claims here stay within what Hearth does.

/** Where "Get started" goes: the Hearth app. */
export const APP_URL = '/';
export const GITHUB_URL = 'https://github.com/HEARTH-STAR';

interface Item {
  icon: ReactNode;
  title: string;
  text: string;
}

export const PROBLEMS: Item[] = [
  {
    icon: <TriangleAlert size={18} />,
    title: 'Breaking changes ship quietly',
    text: 'Vendors rename, deprecate and reshape responses with little warning. You hear about it from an error in production.',
  },
  {
    icon: <BellOff size={18} />,
    title: 'Changelogs go unread',
    text: 'Nobody has time to follow every vendor’s release notes, so useful new features launch unnoticed too.',
  },
  {
    icon: <Wrench size={18} />,
    title: 'The fix is all on you',
    text: 'Finding every affected call across dozens of dependencies, and fixing it safely, falls on your team.',
  },
];

export const STEPS = [
  {
    title: 'Point a Dot at the change',
    text: 'Create a Dot, connect your repository, and tell it which API or SDK changed.',
  },
  {
    title: 'It finds and fixes the code',
    text: 'Working in its own container, it finds every place your code uses that API and rewrites it.',
  },
  {
    title: 'Tests prove it, you approve it',
    text: 'It runs your tests until they pass, then waits for your OK before anything lands.',
  },
];

/** Bento order: a wide card with a drawing opens the first row and closes the second. */
export const FEATURES: (Item & { visual?: ReactNode })[] = [
  {
    icon: <FileSearch size={18} />,
    title: 'Finds every usage',
    text: 'Reads your codebase and tracks down each call to the API or SDK that changed.',
    visual: <UsageVisual />,
  },
  {
    icon: <Container size={18} />,
    title: 'Fixes in isolation',
    text: 'Every job runs in its own container, so one vendor’s upgrade never touches another’s.',
  },
  {
    icon: <UserCheck size={18} />,
    title: 'You stay in the loop',
    text: 'Hearth shows you what changed and waits for your approval.',
  },
  {
    icon: <GitBranch size={18} />,
    title: 'Works with your GitHub',
    text: 'Connect a GitHub account to each container and work on your own repositories.',
  },
  {
    icon: <Monitor size={18} />,
    title: 'Watch it work',
    text: 'Browse the files it touched in a code view, or open a terminal in its container.',
  },
  {
    icon: <CircleCheck size={18} />,
    title: 'Proven by tests',
    text: 'A fix counts only once your tests pass against it.',
    visual: <TestsVisual />,
  },
];

/** Example Dots: one per vendor, each in its own container. The vendors are made up. */
export const DOTS = [
  { mascot: 'blue', name: 'Scout', vendor: 'acme-pay' },
  { mascot: 'mint', name: 'Sprout', vendor: 'nimbus-mail' },
  { mascot: 'orange', name: 'Ember', vendor: 'orbit-maps' },
  { mascot: 'purple', name: 'Nova', vendor: 'ledgerly' },
] as const;

/** ``["a", "b", "c"]`` → ``"a, b or c"``. */
const orList = (items: string[]) =>
  items.length > 1
    ? `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`
    : (items[0] ?? '');

/** "Claude Code, Cursor or Antigravity": every agent a Dot can run (src/shared/agents.ts). */
export const AGENT_NAMES = orList(AGENT_IDS.map((id) => AGENTS[id].name));
/** "Claude Code (Claude account), Cursor (Cursor account) or Antigravity (Google account)". */
export const AGENT_ACCOUNTS = orList(
  AGENT_IDS.map((id) => `${AGENTS[id].name} (${AGENTS[id].account} account)`),
);

// Each line here is backed by the code: Space containers, default permissions
// (shared/computer-types.ts), Hearth-Core's policy, and per-Space sign-in.
export const SAFETY: Item[] = [
  {
    icon: <Boxes size={18} />,
    title: 'Its own container',
    text: 'Each Dot works in a separate container, apart from your own files and from other Dots.',
  },
  {
    icon: <SquareTerminal size={18} />,
    title: 'Commands off by default',
    text: 'A Dot can read and edit files in its folder. Running shell commands is off by default.',
  },
  {
    icon: <ShieldCheck size={18} />,
    title: 'Guardrails on every step',
    text: 'Whichever agent a Dot runs, Hearth’s tool policy checks every step, and commands like sudo, docker and gh are blocked.',
  },
  {
    icon: <KeyRound size={18} />,
    title: 'Your sign-ins stay put',
    text: 'Your agent and GitHub sign in inside the container. Hearth never stores your tokens.',
  },
  {
    icon: <UserCheck size={18} />,
    title: 'You have the final say',
    text: 'Ask to see a draft first, and it’s saved only if you approve it.',
  },
  {
    icon: <Laptop size={18} />,
    title: 'Runs on your machine',
    text: 'Hearth and its containers run on your computer with Docker, and the app only listens locally.',
  },
];

export const REQUIREMENTS: (Item & {
  link?: { href: string; label: string };
})[] = [
  {
    icon: <Container size={18} />,
    title: 'Docker Desktop',
    text: 'Runs each Dot’s container. On Windows, run wsl --install in an administrator PowerShell first, then restart.',
    link: {
      href: 'https://www.docker.com/products/docker-desktop/',
      label: 'Get Docker Desktop',
    },
  },
  {
    icon: <KeyRound size={18} />,
    title: 'An account for your agent',
    text: `${AGENT_ACCOUNTS}. You sign in from each Dot’s setup page. No API key needed.`,
  },
  {
    icon: <ScrollText size={18} />,
    title: 'The Hearth repositories',
    text: 'Hearth-frontend and Hearth-backend from GitHub. Hearth-Core is set up inside each container for you.',
    link: { href: GITHUB_URL, label: 'View on GitHub' },
  },
];

/** Made-up vendors for the strip under the hero, with the version each moved to. */
export const STRIP_VENDORS = [
  ...DOTS.map((dot) => dot.vendor),
  'skyqueue',
  'parcelbox',
].map((vendor, index) => ({
  vendor,
  version: ['v4', 'v3.2', 'v2', 'v5.1', 'v1.8', 'v6'][index % 6],
}));

/** "Watching for changes in" and the vendors, gliding across the page (twice over, for a seamless loop). */
function VendorStrip() {
  const row = (copy: number) => (
    <span className="strip-row" key={copy}>
      <span className="strip-label">Watching for changes in</span>
      {STRIP_VENDORS.map(({ vendor, version }) => (
        <span className="strip-vendor" key={vendor}>
          <code>{vendor}</code>
          <span className="strip-version">{version}</span>
        </span>
      ))}
    </span>
  );
  return (
    <div className="vendor-strip" aria-hidden="true">
      <div className="strip-track">{[0, 1].map(row)}</div>
    </div>
  );
}

/**
 * Leans its child toward the mouse, a few degrees, over a soft glow. Mouse only: touch and
 * reduced motion keep it flat (landing.css).
 */
function TiltStage({ children }: { children: ReactNode }) {
  const stage = useRef<HTMLDivElement>(null);
  const lean = (x: number, y: number) => {
    stage.current?.style.setProperty('--tilt-x', `${x.toFixed(2)}deg`);
    stage.current?.style.setProperty('--tilt-y', `${y.toFixed(2)}deg`);
  };
  return (
    <div
      className="tilt-stage"
      ref={stage}
      onMouseMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - box.left) / box.width - 0.5;
        const y = (event.clientY - box.top) / box.height - 0.5;
        lean(x * 8, -y * 8);
      }}
      onMouseLeave={() => lean(0, 0)}
    >
      <span className="tilt-glow" aria-hidden="true" />
      {children}
    </div>
  );
}

function Bento() {
  return (
    <div className="landing-bento">
      {FEATURES.map((feature) => (
        <article
          key={feature.title}
          className={feature.visual ? 'wide' : undefined}
        >
          <div>
            <span className="card-icon" aria-hidden="true">
              {feature.icon}
            </span>
            <h3>{feature.title}</h3>
            <p>{feature.text}</p>
          </div>
          {feature.visual}
        </article>
      ))}
    </div>
  );
}

function Cards({ items, className }: { items: Item[]; className: string }) {
  return (
    <div className={`landing-cards ${className}`}>
      {items.map((item) => (
        <article key={item.title}>
          <span className="card-icon" aria-hidden="true">
            {item.icon}
          </span>
          <h3>{item.title}</h3>
          <p>{item.text}</p>
        </article>
      ))}
    </div>
  );
}

/** What fades up into view as the page scrolls to it. */
export const REVEAL = [
  '.landing-section h2',
  '.section-lede',
  '.landing-cards article',
  '.landing-steps li',
  '.landing-dots li',
  '.landing-bento article',
  '.landing-requirements li',
  '.requirements-note',
  '.landing-cta',
].join(', ');

/** Delay for the nth item in a row of cards, so they arrive one after another. */
export const staggerDelay = (position: number) => `${(position % 6) * 80}ms`;

/**
 * Hide each REVEAL element until it scrolls into view, then let it fade up. Nothing is
 * hidden before this runs, so the page reads fine without scripts or with reduced motion.
 */
function useScrollReveal() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const items = [...document.querySelectorAll<HTMLElement>(REVEAL)];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const item = entry.target as HTMLElement;
          // Once in, hand the element back to its own styles (hover lifts and all).
          item.addEventListener(
            'transitionend',
            () => {
              item.classList.remove('reveal', 'revealed');
              item.style.transitionDelay = '';
            },
            { once: true },
          );
          item.classList.add('revealed');
          observer.unobserve(item);
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    for (const item of items) {
      const siblings = item.parentElement
        ? [...item.parentElement.children]
        : [item];
      item.style.transitionDelay = staggerDelay(siblings.indexOf(item));
      item.classList.add('reveal');
      observer.observe(item);
    }
    return () => observer.disconnect();
  }, []);
}

export function Landing() {
  useScrollReveal();
  return (
    <div className="landing">
      <LandingNav appUrl={APP_URL} githubUrl={GITHUB_URL} />

      <main id="top">
        <section className="landing-hero">
          {/* Soft clouds in the brand-mark colors drift behind the hero, over a faint dot grid. */}
          <div className="hero-backdrop" aria-hidden="true">
            <i className="cloud teal" />
            <i className="cloud lavender" />
            <i className="cloud amber" />
          </div>
          <div className="hero-copy">
            <div className="hero-mascots" aria-hidden="true">
              {DOTS.map((dot) => (
                <img key={dot.mascot} src={`/dots/${dot.mascot}.png`} alt="" />
              ))}
            </div>
            <p className="hero-eyebrow">
              <span className="pulse-dot" aria-hidden="true" />
              For developers who depend on APIs
            </p>
            <h1>
              Stop finding out about <TypedPhrase /> in production.
            </h1>
            <p className="hero-lede">
              When a vendor’s API or SDK changes, a Hearth agent finds every
              place your code uses it, fixes it in an isolated container, proves
              the fix with your tests, and waits for your approval.
            </p>
            <div className="hero-actions">
              <a className="landing-button" href={APP_URL}>
                Get started <ArrowRight size={16} aria-hidden="true" />
              </a>
              <a className="landing-link" href="#how">
                See how it works
              </a>
            </div>
            <ul className="hero-note">
              <li>Runs on your machine</li>
              <li>No API key needed</li>
              <li>Needs Docker</li>
            </ul>
          </div>
          <TiltStage>
            <HeroDemo />
          </TiltStage>
        </section>

        <VendorStrip />

        <section id="problem" className="landing-section band">
          <h2>Keeping up with every vendor is a job nobody has time for</h2>
          <Cards items={PROBLEMS} className="problems" />
        </section>

        <section id="how" className="landing-section">
          <h2>How it works</h2>
          <ol className="landing-steps">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="step-number">{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="dots" className="landing-section band">
          <h2>One Dot per vendor</h2>
          <p className="section-lede">
            Give each API you depend on its own Dot. Every Dot gets its own
            container, its own look, a name you choose, and the agent you
            prefer: {AGENT_NAMES}.
          </p>
          <ul className="landing-dots">
            {DOTS.map((dot) => (
              <li key={dot.name}>
                <img src={`/dots/${dot.mascot}.png`} alt="" />
                <h3>{dot.name}</h3>
                <p>
                  Looks after <code>{dot.vendor}</code>
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section id="features" className="landing-section">
          <h2>Built for upgrades you can trust</h2>
          <Bento />
        </section>

        <section id="safety" className="landing-section band">
          <h2>Safe by design</h2>
          <p className="section-lede">
            Hearth works on a copy of your code in a container, with guardrails
            on every step.
          </p>
          <Cards items={SAFETY} className="safety" />
        </section>

        <section id="requirements" className="landing-section">
          <h2>What you need</h2>
          <ol className="landing-requirements">
            {REQUIREMENTS.map((item) => (
              <li key={item.title}>
                <span className="card-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                  {item.link && (
                    <a
                      className="requirement-link"
                      href={item.link.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.link.label}
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="requirements-note">
            The first container takes a few minutes while Docker builds it.
            After that, a new Dot is ready in seconds.
          </p>
        </section>

        <section className="landing-cta">
          <h2>Your next API upgrade, handled</h2>
          <p>Set up your first Dot and point it at a change.</p>
          <a className="landing-button" href={APP_URL}>
            Get started <ArrowRight size={16} aria-hidden="true" />
          </a>
        </section>
      </main>

      <footer className="landing-footer">
        <span className="landing-brand">
          <BrandMark />
          Hearth
        </span>
        <p>
          A human-in-the-loop, container-isolated coding agent for API and SDK
          changes.
        </p>
        <nav aria-label="Footer">
          <a href={APP_URL}>Open Hearth</a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
      </footer>
    </div>
  );
}
