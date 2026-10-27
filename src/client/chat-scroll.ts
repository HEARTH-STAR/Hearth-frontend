import { useCallback, useEffect, useRef, useState } from 'react';
// Keeps a conversation at its newest line while you are reading there: a streaming
// reply stays in view as it grows. Scroll up and it stops following, so nothing pulls
// you away from what you are reading; "Jump to latest" brings you back.

/** How close to the end still counts as "at the bottom", in pixels. */
export const NEAR_BOTTOM = 80;

export function isNearBottom(
  box: { scrollTop: number; scrollHeight: number; clientHeight: number },
  threshold = NEAR_BOTTOM,
) {
  return box.scrollHeight - box.scrollTop - box.clientHeight <= threshold;
}

export function useStickToBottom() {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // A ref, not state: the resize observer reads it between renders.
  const pinned = useRef(true);
  const [away, setAway] = useState(false);
  const toBottom = useCallback(() => {
    const box = scroller.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, []);
  useEffect(() => {
    const box = scroller.current;
    const inner = content.current;
    if (!box || !inner) return;
    const onScroll = () => {
      const near = isNearBottom(box);
      pinned.current = near;
      setAway(!near);
    };
    // Every change in height (a new message, a streaming token, a tool row
    // opening) follows the end, but only while pinned there.
    const observer = new ResizeObserver(() => {
      if (pinned.current) toBottom();
      else setAway(!isNearBottom(box));
    });
    box.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(inner);
    toBottom();
    return () => {
      box.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [toBottom]);
  /** Back to the newest line, following again. */
  const jump = useCallback(() => {
    pinned.current = true;
    setAway(false);
    toBottom();
  }, [toBottom]);
  return { scroller, content, away, jump };
}
