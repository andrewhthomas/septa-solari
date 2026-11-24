import { memo, useEffect, useRef, useState } from 'react';

/** Order of characters on the flap drum. The flaps only ever rotate forward. */
export const DRUM = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:.-/&'";
const STEP_MS = 45;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function toDrumChar(ch: string): string {
  const up = ch.toUpperCase();
  return DRUM.includes(up) ? up : ' ';
}

interface FlapCharProps {
  target: string;
  /** Delay before this flap starts moving, so a row ripples instead of moving in lockstep. */
  delay?: number;
}

export const FlapChar = memo(function FlapChar({ target, delay = 0 }: FlapCharProps) {
  const goal = toDrumChar(target);
  const [current, setCurrent] = useState(' ');
  const [previous, setPrevious] = useState(' ');
  const [flips, setFlips] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (current === goal) {
      started.current = false;
      return;
    }
    if (prefersReducedMotion()) {
      setPrevious(current);
      setCurrent(goal);
      return;
    }
    const wait = started.current ? STEP_MS : delay;
    started.current = true;
    const timer = setTimeout(() => {
      const next = DRUM[(DRUM.indexOf(current) + 1) % DRUM.length];
      setPrevious(current);
      setCurrent(next);
      setFlips((n) => n + 1);
    }, wait);
    return () => clearTimeout(timer);
  }, [current, goal, delay]);

  return (
    <span className="flap" aria-hidden="true">
      <span className="flap-half flap-top">
        <span>{current}</span>
      </span>
      <span className="flap-half flap-bottom">
        <span>{current}</span>
      </span>
      {flips > 0 && (
        <span key={flips} className="flap-half flap-top flap-fold">
          <span>{previous}</span>
        </span>
      )}
    </span>
  );
});

interface FlapTextProps {
  text: string;
  width: number;
  align?: 'left' | 'right';
  className?: string;
  /** Base stagger delay for the whole field. */
  delay?: number;
}

export function fit(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const t = text.toUpperCase().slice(0, width);
  return align === 'right' ? t.padStart(width, ' ') : t.padEnd(width, ' ');
}

export function FlapText({ text, width, align = 'left', className = '', delay = 0 }: FlapTextProps) {
  const padded = fit(text, width, align);
  return (
    <span className={`flap-field ${className}`}>
      <span className="sr-only">{text}</span>
      {Array.from(padded).map((ch, i) => (
        <FlapChar key={i} target={ch} delay={delay + i * 25} />
      ))}
    </span>
  );
}
