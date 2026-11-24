import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { STATION_TZ } from '../lib/time';
import { FlapText } from './SplitFlap';
import {
  isDimHour,
  useNow,
  useSafeReload,
  useWakeLock,
  type DisplayOptions,
} from './display';

/** After this long without a successful update, the board shows as delayed. */
const STALE_MS = 2 * 60_000;

const REFRESH_MS = 30_000;

const clockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: STATION_TZ,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const updatedFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: STATION_TZ,
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});

export function useCompact(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return compact;
}

/** Fetch JSON now, every 30 seconds after, and whenever the tab comes back into view. */
export function usePolledJson<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccess, setLastSuccess] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function load() {
      try {
        const res = await fetch(url, { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as T;
        if (!cancelled) {
          setData(json);
          setError(null);
          setLastSuccess(Date.now());
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) timer = setTimeout(load, REFRESH_MS);
      }
    }

    load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer);
        load();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [url]);

  return { data, error, lastSuccess, loading: data === null && error === null };
}

function FlapClock({ size }: { size?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const label = clockFormat.format(now);
  const [time, meridiem] = label.split(' ');
  return (
    <div
      className="board-housing clock"
      style={size ? { ['--cell' as string]: size } : undefined}
      aria-label={`Local time ${label}`}
    >
      <FlapText text={time} width={5} align="right" />
      <span className="ml-2 text-sm font-bold tracking-widest text-stone-400">{meridiem}</span>
    </div>
  );
}

interface PageShellProps {
  kicker: string;
  title: string;
  nav: { href: string; label: string };
  children: ReactNode;
  credits: ReactNode;
  generatedAt?: string;
  error?: string | null;
  lastSuccess?: number | null;
  display: DisplayOptions;
  /** The display-mode container; the page fits it to the screen with useFitToScreen. */
  containerRef: RefObject<HTMLDivElement | null>;
}

export function PageShell({
  kicker,
  title,
  nav,
  children,
  credits,
  generatedAt,
  error,
  lastSuccess,
  display,
  containerRef,
}: PageShellProps) {
  const now = useNow(15_000);
  const stale = lastSuccess !== null && lastSuccess !== undefined && now - lastSuccess > STALE_MS;
  const dim = display.enabled && isDimHour(display.dim, now);

  useWakeLock(display.enabled);
  useSafeReload(display.enabled ? display.reloadHours : 0);

  useEffect(() => {
    document.documentElement.classList.toggle('display-mode', display.enabled);
    document.documentElement.classList.toggle('display-dim', dim);
  }, [display.enabled, dim]);

  if (display.enabled) {
    return (
      <div ref={containerRef} className="flex flex-col gap-3 px-3 py-3">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-4">
            <h1 className="font-board text-2xl font-bold tracking-[0.25em] text-flap-ink uppercase">{title}</h1>
            <p className="text-xs tracking-[0.3em] text-stone-400 uppercase">{kicker}</p>
          </div>
          <div className="flex items-center gap-4">
            {stale && (
              <p className="rounded bg-flap-amber px-2 py-1 text-xs font-bold tracking-widest text-black uppercase">
                Data delayed · last update{' '}
                {lastSuccess ? clockFormat.format(lastSuccess) : 'unknown'}
              </p>
            )}
            <FlapClock size="1.4rem" />
          </div>
        </header>
        <div className={`flex flex-col gap-3 transition-opacity ${stale ? 'opacity-50' : ''}`}>{children}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-8 px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-xs tracking-[0.35em] text-stone-400 uppercase">{kicker}</p>
          <h1 className="font-board mt-1 text-4xl font-bold tracking-[0.25em] text-flap-ink uppercase sm:text-6xl">
            {title}
          </h1>
        </div>
        <FlapClock />
      </header>

      {children}

      <footer className="flex flex-wrap justify-between gap-4 text-xs text-stone-500">
        <p>
          {credits} Unofficial; confirm with posted signage.{' '}
          <a className="underline hover:text-stone-300" href={nav.href}>
            {nav.label}
          </a>
        </p>
        <p aria-live="polite">
          {generatedAt ? `Updated ${updatedFormat.format(new Date(generatedAt))}` : 'Loading…'}
          {error ? ` · retrying (${error})` : ''}
          {stale ? ' · data delayed' : ''}
        </p>
      </footer>
    </div>
  );
}

export const SEPTA_CREDIT = (
  <a className="underline hover:text-stone-300" href="https://www3.septa.org/developer/">
    SEPTA API
  </a>
);
