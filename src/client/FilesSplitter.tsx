import {
  useEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { clampTree, type TreeSize } from './files-split';

/**
 * The line between the file tree and the open file: drag it to give the tree more room. It runs
 * down between them when they sit side by side, and across when the tree is stacked above.
 */
export function FilesSplitter({
  workspace,
  onSize,
}: {
  workspace: RefObject<HTMLElement | null>;
  /** A new size for one axis (undefined: back to the default); ``done`` to remember it. */
  onSize: (
    axis: keyof TreeSize,
    size: number | undefined,
    done: boolean,
  ) => void;
}) {
  // Side by side once the panel is wide (a container query): the grid then has three columns.
  const [across, setAcross] = useState(true);
  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const check = () =>
      setAcross(
        getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/)
          .length >= 3,
      );
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [workspace]);
  const axis: keyof TreeSize = across ? 'width' : 'height';
  /** The tree's size now, and the room the two share. */
  const measure = () => {
    const element = workspace.current;
    const tree = element?.querySelector('.code-sidebar');
    if (!element || !tree) return null;
    const box = element.getBoundingClientRect();
    const own = tree.getBoundingClientRect();
    return across
      ? { size: own.width, total: box.width }
      : { size: own.height, total: box.height };
  };
  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = event.button === 0 ? measure() : null;
    if (!start) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const origin = across ? event.clientX : event.clientY;
    const at = (next: PointerEvent) =>
      clampTree(
        start.size + (across ? next.clientX : next.clientY) - origin,
        start.total,
        axis,
      );
    const cursor = across ? 'resizing-cols' : 'resizing-rows';
    document.body.classList.add(cursor);
    const move = (next: PointerEvent) => onSize(axis, at(next), false);
    const end = (last: PointerEvent) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      document.body.classList.remove(cursor);
      onSize(axis, at(last), true);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };
  return (
    <div
      className="code-splitter"
      role="separator"
      aria-orientation={across ? 'vertical' : 'horizontal'}
      aria-label="Resize the file tree"
      title="Drag to resize · double-click to reset"
      tabIndex={0}
      onPointerDown={drag}
      onDoubleClick={() => onSize(axis, undefined, true)}
      onKeyDown={(event) => {
        const grow = across ? 'ArrowRight' : 'ArrowDown';
        const shrink = across ? 'ArrowLeft' : 'ArrowUp';
        if (event.key !== grow && event.key !== shrink) return;
        event.preventDefault();
        const now = measure();
        if (!now) return;
        const step = (event.shiftKey ? 64 : 16) * (event.key === grow ? 1 : -1);
        onSize(axis, clampTree(now.size + step, now.total, axis), true);
      }}
    />
  );
}
