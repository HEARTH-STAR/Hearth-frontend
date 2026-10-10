import type { ReactNode } from 'react';
import { Mascot } from './Mascot';
import type { Dot } from '../shared/types';
export function DotHeader({
  dot,
  status,
  state = 'idle',
  online,
  children,
}: {
  dot: Dot;
  status: string;
  state?: 'idle' | 'working' | 'paused';
  online: boolean;
  children?: ReactNode;
}) {
  return (
    <header className="dot-header">
      <span className={`dot-avatar ${online ? 'online' : ''}`}>
        <Mascot identity={dot.id} name={dot.name} small state={state} />
      </span>
      <div className="dot-header-text">
        <strong>{dot.name}</strong>
        <span>
          {dot.role ? `${dot.role} · ` : ''}
          {status}
        </span>
      </div>
      <div className="dot-header-actions">{children}</div>
    </header>
  );
}
