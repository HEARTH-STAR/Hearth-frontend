import { useEffect, useState } from 'react';
// The headline's moving part: a phrase typed out, held, erased, and the next one typed.
// Screen readers get the first phrase as plain text; with reduced motion (and when
// rendered without a window) the first phrase simply stands still.

export const PHRASES = [
  'API changes',
  'breaking SDK updates',
  'deprecated endpoints',
  'renamed fields',
];

const TYPE = 70;
const ERASE = 35;
const HOLD = 1900;
const GAP = 350;

/** One loop: each [characters shown of the phrase, which phrase, how long to wait]. */
export function typingTimeline(phrases = PHRASES): [number, number, number][] {
  const steps: [number, number, number][] = [];
  phrases.forEach((phrase, which) => {
    for (let shown = 1; shown <= phrase.length; shown++)
      steps.push([shown, which, shown === phrase.length ? HOLD : TYPE]);
    for (let shown = phrase.length - 1; shown >= 0; shown--)
      steps.push([shown, which, shown === 0 ? GAP : ERASE]);
  });
  return steps;
}

const stillPicture = () =>
  typeof window === 'undefined' ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function TypedPhrase() {
  // Starts whole, so the first paint (and anyone without motion) reads it at once.
  const [frame, setFrame] = useState({ shown: PHRASES[0].length, which: 0 });
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (stillPicture()) return;
    const timeline = typingTimeline();
    // Begin by holding the first phrase, then erase it: no flash of an empty headline.
    let index = PHRASES[0].length - 1;
    let timer = window.setTimeout(function step() {
      const [shown, which, wait] = timeline[index];
      setFrame({ shown, which });
      setMoving(true);
      index = (index + 1) % timeline.length;
      timer = window.setTimeout(step, wait);
    }, HOLD);
    return () => window.clearTimeout(timer);
  }, []);
  const phrase = PHRASES[frame.which];
  return (
    <>
      <span className="sr-only">{PHRASES[0]}</span>
      <span
        className={`typed-phrase ${moving ? 'moving' : ''}`}
        aria-hidden="true"
      >
        {phrase.slice(0, frame.shown)}
      </span>
    </>
  );
}
