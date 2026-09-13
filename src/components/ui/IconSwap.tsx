import type { ReactNode } from 'react';

interface IconSwapProps {
  state: 'a' | 'b';
  iconA: ReactNode;
  iconB: ReactNode;
  className?: string;
}

export function IconSwap({ state, iconA, iconB, className }: IconSwapProps) {
  return (
    <div className={`t-icon-swap${className ? ` ${className}` : ''}`} data-state={state}>
      <span className="t-icon" data-icon="a">{iconA}</span>
      <span className="t-icon" data-icon="b">{iconB}</span>
    </div>
  );
}
