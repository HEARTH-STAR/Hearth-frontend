import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
// The hero's moving picture: a Dot upgrading a made-up SDK, then waiting for approval.
// It loops; with reduced motion (and when rendered without a window) it shows the end.

export const DEMO_ASK = 'Upgrade acme-pay to v4 and fix whatever breaks.';
export const DEMO_TOOLS = [
  'Found 7 usages in 4 files',
  'Edited src/billing/charge.ts',
  'Ran tests: 42 passed',
];
export const DEMO_REPLY =
  'Ready for your review: 4 files changed, all tests passing.';

/** typed: characters of the ask shown. stage: 0 asking, 1 working, 2–4 tools shown, 5 done. */
export interface DemoFrame {
  typed: number;
  stage: number;
}
export const DEMO_DONE: DemoFrame = { typed: DEMO_ASK.length, stage: 5 };

/** One loop of the demo: each frame and how long it stays, in milliseconds. */
export function demoTimeline(): [DemoFrame, number][] {
  const frames: [DemoFrame, number][] = [[{ typed: 0, stage: 0 }, 900]];
  for (let typed = 1; typed <= DEMO_ASK.length; typed++)
    frames.push([{ typed, stage: 0 }, 35]);
  frames.push([{ typed: DEMO_ASK.length, stage: 1 }, 1200]);
  for (let stage = 2; stage <= 4; stage++)
    frames.push([{ typed: DEMO_ASK.length, stage }, 900]);
  frames.push([DEMO_DONE, 4500]);
  return frames;
}

const stillPicture = () =>
  typeof window === 'undefined' ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function useDemo() {
  const [frame, setFrame] = useState<DemoFrame>(() =>
    stillPicture() ? DEMO_DONE : { typed: 0, stage: 0 },
  );
  useEffect(() => {
    if (stillPicture()) return;
    const timeline = demoTimeline();
    let index = 0;
    let timer = 0;
    const step = () => {
      const [next, wait] = timeline[index];
      setFrame(next);
      index = (index + 1) % timeline.length;
      timer = window.setTimeout(step, wait);
    };
    step();
    return () => window.clearTimeout(timer);
  }, []);
  return frame;
}

function status(stage: number) {
  if (stage === 0) return { label: 'Ready', tone: 'ready' };
  if (stage < 5) return { label: 'Working', tone: 'working' };
  return { label: 'Needs your review', tone: 'review' };
}

export function HeroDemo() {
  const { typed, stage } = useDemo();
  const state = status(stage);
  return (
    <div className="landing-preview" aria-hidden="true">
      <div className="preview-bar">
        <i />
        <i />
        <i />
      </div>
      <div className="preview-body">
        <div className="preview-dot">
          <img src="/dots/blue.png" alt="" />
          <strong>Scout</strong>
          <span className={`preview-status ${state.tone}`}>{state.label}</span>
        </div>
        {/* The untyped rest keeps its room, so the bubble never changes size. */}
        <p className="preview-ask">
          <span className={typed < DEMO_ASK.length ? 'typing' : ''}>
            {DEMO_ASK.slice(0, typed)}
          </span>
          <span className="ask-rest">{DEMO_ASK.slice(typed)}</span>
        </p>
        <div className={`preview-reply ${stage >= 1 ? 'shown' : ''}`}>
          {DEMO_TOOLS.map((tool, index) => (
            <span
              key={tool}
              className={`preview-tool ${stage >= index + 2 ? 'shown' : ''}`}
            >
              <Check size={12} strokeWidth={3} />
              {tool}
            </span>
          ))}
          <div className={`preview-done ${stage >= 5 ? 'shown' : ''}`}>
            <p>{DEMO_REPLY}</p>
            <span className="preview-approve">Approve</span>
          </div>
        </div>
      </div>
    </div>
  );
}
