import {
  ArrowRight,
  Check,
  Circle,
  LoaderCircle,
  PackageCheck,
  ScrollText,
  Search,
  Wrench,
} from 'lucide-react';
import { Mascot } from './Mascot';
import { STAGE_LABEL, working } from './space-stage';
import type { Dot, Space } from '../shared/types';
import { agentOf } from '../shared/agents';
// What an empty conversation shows: starting points when the Dot is ready, and the
// steps left (with a way to finish them) when it is not.

/** Ways to begin, matched to what Hearth is for. [Brackets] mark what to fill in. */
export const STARTERS = [
  {
    icon: <PackageCheck size={16} />,
    label: 'Upgrade an SDK',
    text: 'Upgrade [SDK name] to its latest version and fix whatever breaks.',
  },
  {
    icon: <Search size={16} />,
    label: 'Find every usage',
    text: 'Find every place our code calls [API or method name].',
  },
  {
    icon: <ScrollText size={16} />,
    label: 'Check a changelog',
    text: 'Check our code against this changelog and list what needs to change:\n\n[paste the changelog or its link]',
  },
  {
    icon: <Wrench size={16} />,
    label: 'Fix a broken update',
    text: 'Our tests started failing after updating [dependency]. Find out why and fix it.',
  },
];

/** Where the first [blank] is, so it can be selected for typing over. */
export function starterSelection(text: string): [number, number] {
  const start = text.indexOf('[');
  const end = text.indexOf(']', start);
  return start >= 0 && end > start
    ? [start, end + 1]
    : [text.length, text.length];
}

/** What the empty composer invites: a reason it's off, a first ask, or a reply. */
export function composerPlaceholder({
  name,
  paused,
  online,
  started,
}: {
  name: string;
  paused: boolean;
  online: boolean;
  started: boolean;
}) {
  if (paused) return 'All Dots are paused';
  if (!online) return `Finish ${name}’s setup to start`;
  return started ? `Message ${name}` : 'Which API or SDK changed?';
}

/** The line under the composer: how to send, or how to stop a running reply. */
export function composerHint({
  running,
  files,
}: {
  running: boolean;
  files: boolean;
}) {
  if (running) return 'Esc to stop';
  return [
    'Enter to send',
    'Shift+Enter for a new line',
    ...(files ? ['+ to reference a file'] : []),
  ].join(' · ');
}

/** Focus the composer with a starter's first [blank] selected, ready to type over. */
export function focusBlank(input: HTMLTextAreaElement | null, text: string) {
  if (!input) return;
  input.focus();
  input.setSelectionRange(...starterSelection(text));
}

type StepState = 'done' | 'working' | 'todo';

/** The two things a Dot needs before it can chat, as its Setup page shows them. */
export function setupSteps(space?: Space): {
  label: string;
  detail: string;
  state: StepState;
}[] {
  const stage = space?.stage ?? 'none';
  const ready = stage === 'ready';
  return [
    {
      label: 'Container',
      detail: ready ? 'Running' : STAGE_LABEL[stage],
      state: ready ? 'done' : working(stage) ? 'working' : 'todo',
    },
    {
      label: agentOf(space).name,
      detail: !ready
        ? 'Waits for the container'
        : space?.signedIn === false
          ? 'Sign in needed'
          : 'Signed in',
      state: ready && space?.signedIn !== false ? 'done' : 'todo',
    },
  ];
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <Check size={14} strokeWidth={3} />;
  if (state === 'working')
    return <LoaderCircle size={14} className="spinning" />;
  return <Circle size={14} />;
}

export function SetupCard({
  dot,
  space,
  compact = false,
}: {
  dot: Dot;
  space?: Space;
  /** One line above the composer, for a conversation that already has messages. */
  compact?: boolean;
}) {
  const steps = setupSteps(space);
  const href = `#/spaces/${dot.spaceId}/setup`;
  if (compact)
    return (
      <div className="setup-strip" role="status">
        <span>
          {dot.name} can’t reply until its setup is finished:{' '}
          {steps
            .filter((step) => step.state !== 'done')
            .map(
              (step) =>
                `${step.label.toLowerCase()} ${step.detail.toLowerCase()}`,
            )
            .join(', ')}
          .
        </span>
        <a className="button" href={href}>
          Finish setup
        </a>
      </div>
    );
  return (
    <section className="setup-card" aria-label={`${dot.name}’s setup`}>
      <h3>Finish setting up {dot.name}</h3>
      <p>
        {dot.name} needs a running container and{' '}
        {/^[aeiou]/i.test(agentOf(space).name) ? 'an' : 'a'}{' '}
        {agentOf(space).name} sign-in before it can work.
      </p>
      <ol>
        {steps.map((step) => (
          <li key={step.label} className={step.state}>
            <span className="setup-step-icon" aria-hidden="true">
              <StepIcon state={step.state} />
            </span>
            <strong>{step.label}</strong>
            <span>{step.detail}</span>
          </li>
        ))}
      </ol>
      <a className="button primary" href={href}>
        Finish setup <ArrowRight size={15} aria-hidden="true" />
      </a>
    </section>
  );
}

export function StarterPrompts({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="starter-prompts" aria-label="Ways to start">
      {STARTERS.map((starter) => (
        <button
          key={starter.label}
          type="button"
          onClick={() => onPick(starter.text)}
        >
          <span className="starter-icon" aria-hidden="true">
            {starter.icon}
          </span>
          <strong>{starter.label}</strong>
          <span className="starter-text">{starter.text.split('\n')[0]}</span>
        </button>
      ))}
    </div>
  );
}

/** The whole empty state: mascot, a question, then starters or the setup card. */
export function ChatStart({
  dot,
  space,
  online,
  paused,
  onPick,
}: {
  dot: Dot;
  space?: Space;
  online: boolean;
  paused: boolean;
  onPick: (text: string) => void;
}) {
  return (
    <div className="chat-start">
      <Mascot
        identity={dot.id}
        name={dot.name}
        state={paused ? 'paused' : 'idle'}
      />
      <h2>What should {dot.name} work on?</h2>
      {online ? (
        <>
          <p>Pick a starting point, or describe the change yourself.</p>
          <StarterPrompts onPick={onPick} />
        </>
      ) : (
        <SetupCard dot={dot} space={space} />
      )}
    </div>
  );
}
