import type { Arrival, StopResponse } from '../lib/types';
import { Board, columnChars, formatTime, visibleColumns, type Column } from './Board';
import { useRef } from 'react';
import { selectBoards, useDisplayOptions, useFitToScreen } from './display';
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
  // 13 wide so two-digit counts fit: "14 STOPS AWAY".
  { key: 'status', label: 'Status', width: 13, get: positionStatus },
];

const NOTE =
  "Exp is SEPTA's predicted arrival. For trolleys SEPTA is tracking, Next Stop and Status show where the trolley is now. SCHEDULED means no prediction yet, usually because the trolley has not left its terminal.";

const BOARDS = [
  { id: 'east', title: 'T2 to Center City', subtitle: 'Eastbound · Baltimore Av & 49th St', pick: (d: StopResponse) => d.eastbound },
  { id: 'west', title: 'T2 to 61st & Baltimore', subtitle: 'Westbound · Baltimore Av & 49th St', pick: (d: StopResponse) => d.westbound },
];

export default function BaltimoreBoard() {
  const { data, error, loading, lastSuccess } = usePolledJson<StopResponse>('/api/49th-baltimore');
  const compact = useCompact();
  const display = useDisplayOptions();

  const columns = visibleColumns(COLUMNS, compact);
  const chars = columnChars(columns);
  const boards = display.enabled ? selectBoards(BOARDS, display.boards) : BOARDS;

  const containerRef = useRef<HTMLDivElement>(null);
  const fitKey = `${boards.map((b) => b.id).join()}-${display.rows}-${compact}`;
  // Adapt rows to the screen: 3 to 10 (the API returns up to 10 per direction).
  const extraRows = useFitToScreen(display.enabled, containerRef, fitKey, display.rows ? null : [3 - ROWS, 10 - ROWS]);

  return (
    <PageShell
      kicker="SEPTA Metro T2 · Baltimore Av & 49th St"
      title="49th & Baltimore"
      nav={{ href: '/', label: '← 30th Street Station' }}
      generatedAt={data?.generatedAt}
      error={error}
      lastSuccess={lastSuccess}
      display={display}
      containerRef={containerRef}
      credits={<>SEPTA Metro data via the {SEPTA_CREDIT}.</>}
    >
      {boards.map((b, i) => {
        const source = data ? b.pick(data) : undefined;
        return (
          <Board
            key={b.id}
            title={b.title}
            subtitle={b.subtitle}
            accent="#5ea33a"
            columns={columns}
            chars={chars}
            rows={source?.arrivals ?? []}
            rowCount={display.rows ?? Math.max(3, Math.min(10, ROWS + extraRows))}
            error={error ?? source?.error}
            loading={loading}
            note={!display.enabled && i === boards.length - 1 ? NOTE : undefined}
          />
        );
      })}
    </PageShell>
  );
}
