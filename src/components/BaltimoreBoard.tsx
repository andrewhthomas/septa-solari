import type { Arrival, StopResponse } from '../lib/types';
import { Board, columnChars, formatTime, visibleColumns, type Column } from './Board';
import { PageShell, SEPTA_CREDIT, useCompact, usePolledJson } from './shared';

const ROWS = 6;

/** Status for a tracked trolley says where it is; otherwise its schedule status. */
function positionStatus(r: Arrival): string {
  if (r.stopsAway === undefined || r.status === 'DUE') return r.status;
  if (r.stopsAway === 0) return 'APPROACHING';
  return r.stopsAway === 1 ? '1 STOP AWAY' : `${r.stopsAway} STOPS AWAY`;
}

// Every row is a T2 and each board is one direction, so no Route or Direction columns.
const COLUMNS: Column[] = [
  { key: 'time', label: 'Time', width: 5, align: 'right', get: (r) => formatTime(r.scheduled) },
  {
    key: 'expected',
    label: 'Exp',
    width: 5,
    align: 'right',
    get: (r) => (r.statusKind === 'scheduled' ? '' : formatTime(r.estimated)),
  },
  { key: 'destination', label: 'Destination', width: 14, notice: true, get: (r) => r.destination ?? '' },
  { key: 'next', label: 'Next Stop', width: 12, wideOnly: true, get: (r) => r.nextStop ?? '' },
  { key: 'status', label: 'Status', width: 12, get: positionStatus },
];

export default function BaltimoreBoard() {
  const { data, error, loading } = usePolledJson<StopResponse>('/api/49th-baltimore');
  const compact = useCompact();

  const columns = visibleColumns(COLUMNS, compact);
  const chars = columnChars(columns);

  return (
    <PageShell
      kicker="SEPTA Metro T2 · Baltimore Av & 49th St"
      title="49th & Baltimore"
      nav={{ href: '/', label: '← 30th Street Station' }}
      generatedAt={data?.generatedAt}
      error={error}
      credits={<>SEPTA Metro data via the {SEPTA_CREDIT}.</>}
    >
      <Board
        title="T2 to Center City"
        subtitle="Eastbound · Baltimore Av & 49th St"
        accent="#5ea33a"
        columns={columns}
        chars={chars}
        rows={data?.eastbound.arrivals ?? []}
        rowCount={ROWS}
        error={error ?? data?.eastbound.error}
        loading={loading}
      />

      <Board
        title="T2 to 61st & Baltimore"
        subtitle="Westbound · Baltimore Av & 49th St"
        accent="#5ea33a"
        columns={columns}
        chars={chars}
        rows={data?.westbound.arrivals ?? []}
        rowCount={ROWS}
        error={error ?? data?.westbound.error}
        loading={loading}
        note="Exp is SEPTA's predicted arrival. For trolleys SEPTA is tracking, Next Stop and Status show where the trolley is now. SCHEDULED means no prediction yet, usually because the trolley has not left its terminal."
      />
    </PageShell>
  );
}
