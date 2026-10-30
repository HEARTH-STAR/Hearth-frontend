import { LoaderCircle } from 'lucide-react';
import type { Problem } from './watch-view';

/**
 * An API watch failure: the Space still starting, GitHub not connected in it (both point to its
 * Setup page), or what Hearth-Core or GitHub said.
 */
export function WatchProblem({
  problem,
  spaceId,
}: {
  problem?: Problem;
  spaceId: string;
}) {
  if (!problem) return null;
  const setup = `#/spaces/${encodeURIComponent(spaceId)}/setup`;
  if (problem.stage)
    return (
      <p className="watch-notice" role="status">
        <LoaderCircle size={14} className="spinning" aria-hidden="true" />
        <span>
          {problem.message} API watch answers once the Space is running.{' '}
          <a href={setup}>Open Setup</a>
        </span>
      </p>
    );
  if (problem.github)
    return (
      <p className="watch-notice" role="alert">
        <span>
          {problem.message} Connect GitHub to this Space to review and merge its
          pull requests. <a href={setup}>Connect GitHub in Setup</a>
        </span>
      </p>
    );
  return (
    <p className="chat-error watch-error" role="alert">
      {problem.message}
    </p>
  );
}
