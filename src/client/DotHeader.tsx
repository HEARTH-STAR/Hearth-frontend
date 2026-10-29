import type { ReactNode } from 'react';
import { Mascot } from './Mascot';
import type { Dot } from '../shared/types';

export type DotState = 'idle' | 'working' | 'paused';

/** One word or two for where the Dot stands, and a tone for its dot of color. */
export function dotStatus(state: DotState, online: boolean) {
  if (state === 'paused') return { label: 'Paused', tone: 'paused' };
  if (state === 'working') return { label: 'Working…', tone: 'working' };
  if (!online) return { label: 'Needs setup', tone: 'setup' };
  return { label: 'Ready', tone: 'ready' };
}

export function DotHeader({
  dot,
  state = 'idle',
  online,
  title,
  children,
}: {
  dot: Dot;
  state?: DotState;
  online: boolean;
  /** The conversation's title, shown after the status. */
  title?: string;
  children?: ReactNode;
}) {
  const status = dotStatus(state, online);
  return (
    <header className="dot-header">
      <span
        className={`dot-avatar ${online ? 'online' : ''} ${state === 'working' ? 'working' : ''}`}
      >
        <Mascot identity={dot.id} name={dot.name} small state={state} />
      </span>
      <div className="dot-header-text">
        <strong>{dot.name}</strong>
        <span className="dot-header-sub">
          <span className={`dot-status ${status.tone}`} role="status">
            {status.label}
          </span>
          {title && (
            <>
              <span aria-hidden="true">·</span>
              <span className="dot-header-title" title={title}>
                {title}
              </span>
            </>
          )}
        </span>
      </div>
      <div className="dot-header-actions">{children}</div>
    </header>
  );
}
