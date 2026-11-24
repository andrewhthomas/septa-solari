import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { STATION_TZ } from '../lib/time';

/**
 * Display mode: for a screen left running on a wall or shelf.
 *
 * Turned on with `?display` in the URL. Options (all optional):
 *   boards=a,b   which boards to show, in order (ids differ per page)
 *   rows=N       rows per board (default: each board's normal count)
 *   dim=23-6     dim the screen between these hours, station time
 *   reload=6     reload the page every N hours (0 = never); only reloads
 *                once the site answers, so a network drop can't strand an error page
 */
export interface DisplayOptions {
  enabled: boolean;
  boards: string[] | null;
  rows: number | null;
  dim: [number, number] | null;
  reloadHours: number;
}

const OFF: DisplayOptions = { enabled: false, boards: null, rows: null, dim: null, reloadHours: 0 };

export function readDisplayOptions(search: string): DisplayOptions {
  const params = new URLSearchParams(search);
  if (!params.has('display') || params.get('display') === '0') return OFF;

  const boards = params
    .get('boards')
    ?.split(',')
    .map((b) => b.trim().toLowerCase())
    .filter(Boolean);

  const rows = Number(params.get('rows'));
  const dimMatch = params.get('dim')?.match(/^(\d{1,2})-(\d{1,2})$/);
  const reload = params.has('reload') ? Number(params.get('reload')) : 6;

  return {
    enabled: true,
    boards: boards?.length ? boards : null,
    rows: Number.isInteger(rows) && rows > 0 ? Math.min(rows, 12) : null,
    dim: dimMatch ? [Number(dimMatch[1]) % 24, Number(dimMatch[2]) % 24] : null,
    reloadHours: Number.isFinite(reload) && reload > 0 ? reload : 0,
  };
}

export function useDisplayOptions(): DisplayOptions {
  // Pages render client-only, so the URL is available on first render.
  const [options] = useState(() =>
    typeof window === 'undefined' ? OFF : readDisplayOptions(window.location.search),
  );
  return options;
}

/** Keep the requested boards, in the requested order. Unknown ids are ignored. */
export function selectBoards<T extends { id: string }>(boards: T[], wanted: string[] | null): T[] {
  if (!wanted) return boards;
  const picked = wanted
    .map((id) => boards.find((b) => b.id === id))
    .filter((b): b is T => Boolean(b));
  return picked.length ? picked : boards;
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Size the flap cells so the whole page fits the screen with no scrolling:
 * as wide as the boards allow, then shrunk until the height fits too.
 *
 * With a `rowRange`, the row count adapts instead: rows are added to fill
 * spare height, or removed so flaps can stay as large as the width allows.
 * The same number is added to (or removed from) every board, within
 * [min, max]. Returns that number.
 */
export function useFitToScreen(
  enabled: boolean,
  container: RefObject<HTMLElement | null>,
  fitKey: string,
  rowRange: [min: number, max: number] | null = null,
): number {
  const [extraRows, setExtraRows] = useState(0);
  // Rows are chosen once per screen size and layout, so adding them can't loop.
  const rowsChosenFor = useRef('');

  useLayoutEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;

    function fit() {
      const el = container.current;
      const board = el?.querySelector<HTMLElement>('.board-housing[data-board]');
      if (!el || !board) return;

      const style = getComputedStyle(board);
      const chars = Number(style.getPropertyValue('--chars')) || 62;
      const inner = board.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      // 1.08 = cell + gap; a little slack so rounding never forces a scrollbar.
      let cell = Math.floor((inner / (chars * 1.08)) * 100) / 100 - 0.05;
      root.style.setProperty('--display-cell', `${cell}px`);

      const sizeKey = `${window.innerWidth}x${window.innerHeight}|${fitKey}`;
      if (rowRange && rowsChosenFor.current !== sizeKey) {
        rowsChosenFor.current = sizeKey;
        const row = el.querySelector<HTMLElement>('.board-row:not(.board-labels)');
        const grid = row?.parentElement;
        const boards = el.querySelectorAll('.board-housing[data-board]').length;
        if (row && grid && boards) {
          const pitch = row.offsetHeight + parseFloat(getComputedStyle(grid).rowGap || '0');
          const spare = window.innerHeight - el.scrollHeight;
          const [min, max] = rowRange;
          const next = Math.max(min, Math.min(max, extraRows + Math.floor(spare / (pitch * boards))));
          if (next !== extraRows) {
            setExtraRows(next); // re-renders with the new rows, then fits again
            return;
          }
        }
      }

      // Everything that isn't a flap (headers, padding) has a fixed height, so a
      // proportional shrink undershoots slightly; a few passes converge.
      for (let i = 0; i < 6 && el.scrollHeight > window.innerHeight; i++) {
        cell *= (window.innerHeight / el.scrollHeight) * 0.99;
        root.style.setProperty('--display-cell', `${cell}px`);
      }
    }

    fit();
    window.addEventListener('resize', fit);
    return () => {
      window.removeEventListener('resize', fit);
      root.style.removeProperty('--display-cell');
    };
    // rowRange is compared by value so a new array each render doesn't re-fit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, container, fitKey, rowRange?.[0], rowRange?.[1], extraRows]);

  return enabled ? extraRows : 0;
}

const hourFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: STATION_TZ,
  hour: 'numeric',
  hourCycle: 'h23',
});

/** True during the dim window. "23-6" wraps past midnight; "1-5" doesn't. */
export function isDimHour(window: [number, number] | null, now: number): boolean {
  if (!window) return false;
  const hour = Number(hourFormat.format(now));
  const [start, end] = window;
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Ask the browser to keep the screen on (tablets, laptops). Re-acquired when the tab returns. */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        // Not allowed (e.g. low battery); the screen's own settings apply.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, [enabled]);
}

/**
 * Reload every few hours to shed anything a long-lived page accumulates, but
 * only when the site is reachable: reloading while offline would replace the
 * board with the browser's error page for good.
 */
export function useSafeReload(hours: number) {
  useEffect(() => {
    if (!hours) return;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = async () => {
      try {
        const res = await fetch(window.location.href, { cache: 'no-store' });
        if (res.ok) {
          window.location.reload();
          return;
        }
      } catch {
        // offline; try again shortly
      }
      timer = setTimeout(attempt, 5 * 60_000);
    };
    timer = setTimeout(attempt, hours * 3_600_000);
    return () => clearTimeout(timer);
  }, [hours]);
}
