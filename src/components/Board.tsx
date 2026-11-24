import type { Arrival } from '../lib/types';
import { STATION_TZ } from '../lib/time';
import { FlapText } from './SplitFlap';

export interface Column {
  key: string;
  label: string;
  width: number;
  /** Width on narrow screens, if different. */
  compactWidth?: number;
  align?: 'left' | 'right';
  /** Hidden on narrow screens. */
  wideOnly?: boolean;
  get: (row: Arrival) => string;
  /** Column used for "no arrivals" style notices. */
  notice?: boolean;
}

const timeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: STATION_TZ,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso)).replace(/\s?[AP]M$/i, '');
}

const timeCol: Column = { key: 'time', label: 'Time', width: 5, align: 'right', get: (r) => formatTime(r.scheduled) };
const statusCol: Column = { key: 'status', label: 'Status', width: 12, get: (r) => r.status };

/** Amtrak and Regional Rail: where the train is coming from. */
export const RAIL_COLUMNS: Column[] = [
  timeCol,
  { key: 'train', label: 'Train', width: 5, wideOnly: true, get: (r) => r.train },
  { key: 'origin', label: 'Arriving From', width: 16, notice: true, get: (r) => r.origin },
  { key: 'line', label: 'Line', width: 16, wideOnly: true, get: (r) => r.line },
  { key: 'track', label: 'Trk', width: 3, get: (r) => r.track },
  statusCol,
];

/** Metro subway and trolleys: where the train is going. */
export const METRO_COLUMNS: Column[] = [
  timeCol,
  { key: 'route', label: 'Route', width: 5, get: (r) => r.train },
  {
    key: 'destination',
    label: 'Destination',
    width: 22,
    compactWidth: 14,
    notice: true,
    get: (r) => r.destination ?? '',
  },
  { key: 'direction', label: 'Direction', width: 9, wideOnly: true, get: (r) => r.direction ?? '' },
  statusCol,
];

export function visibleColumns(columns: Column[], compact: boolean) {
  return columns
    .filter((c) => !compact || !c.wideOnly)
    .map((c) => ({ ...c, width: compact && c.compactWidth ? c.compactWidth : c.width }));
}

/** Character pitch a set of columns needs, counting one blank cell between columns. */
export function columnChars(columns: Column[]): number {
  return columns.reduce((n, c) => n + c.width, 0) + (columns.length - 1);
}

const STATUS_CLASS: Record<Arrival['statusKind'], string> = {
  ontime: 'text-flap-ink',
  late: 'text-flap-amber',
  early: 'text-flap-amber',
  arrived: 'text-flap-green',
  canceled: 'text-flap-red',
  scheduled: 'text-flap-muted',
  other: 'text-flap-amber',
};

interface BoardProps {
  title: string;
  subtitle: string;
  accent: string;
  columns: Column[];
  /** Shared character count, so every board uses the same flap size. */
  chars: number;
  rows: Arrival[];
  rowCount: number;
  error?: string;
  loading: boolean;
  note?: string;
}

export function Board({
  title,
  subtitle,
  accent,
  columns,
  chars,
  rows,
  rowCount,
  error,
  loading,
  note,
}: BoardProps) {
  const slots = Array.from({ length: rowCount }, (_, i) => rows[i]);
  const noticeIndex = Math.max(0, columns.findIndex((c) => c.notice));

  let notice: string | null = null;
  if (error) notice = 'Live data unavailable';
  else if (!loading && rows.length === 0) notice = 'No scheduled arrivals';

  return (
    <section className="board-housing" style={{ ['--chars' as string]: chars }} aria-label={title}>
      <header className="mb-3 flex items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="h-6 w-2 rounded-sm" style={{ background: accent }} aria-hidden="true" />
          <h2 className="font-board text-xl font-bold tracking-[0.2em] text-flap-ink uppercase sm:text-2xl">
            {title}
          </h2>
        </div>
        <p className="text-right text-xs tracking-widest text-stone-400 uppercase">{subtitle}</p>
      </header>

      <div className="board-grid" role="table" aria-label={title}>
        <div className="board-row board-labels" role="row">
          {columns.map((c) => (
            <span
              key={c.key}
              role="columnheader"
              className="board-label"
              style={{ width: `calc(var(--cell-pitch) * ${c.width})`, textAlign: c.align ?? 'left' }}
            >
              {c.label}
            </span>
          ))}
        </div>

        {slots.map((row, r) => (
          <div className="board-row" role="row" key={r}>
            {columns.map((c, ci) => (
              <span role="cell" key={c.key}>
                <FlapText
                  text={notice && r === 0 && ci === noticeIndex ? notice : row ? c.get(row) : ''}
                  width={c.width}
                  align={c.align}
                  delay={r * 60}
                  className={c.key === 'status' && row ? STATUS_CLASS[row.statusKind] : 'text-flap-ink'}
                />
              </span>
            ))}
          </div>
        ))}
      </div>

      {note && <p className="mt-3 text-xs text-stone-500">{note}</p>}
    </section>
  );
}
