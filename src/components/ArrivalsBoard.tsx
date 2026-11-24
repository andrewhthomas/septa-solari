import { useRef } from 'react';
import type { ArrivalsResponse, SourceResult } from '../lib/types';
import { Board, METRO_COLUMNS, RAIL_COLUMNS, columnChars, visibleColumns, type Column } from './Board';
import { selectBoards, useDisplayOptions, useFitToScreen } from './display';
import { PageShell, SEPTA_CREDIT, useCompact, usePolledJson } from './shared';

interface BoardConfig {
  /** Used by display mode's `boards=` option. */
  id: 'amtrak' | 'rail' | 'l' | 't';
  title: string;
  subtitle: string;
  accent: string;
  kind: 'rail' | 'metro';
  rows: number;
  source: (d: ArrivalsResponse) => SourceResult;
  note?: string;
}

const BOARDS: BoardConfig[] = [
  { id: 'amtrak', title: 'Amtrak', subtitle: 'Intercity', accent: '#1d6fb8', kind: 'rail', rows: 10, source: (d) => d.amtrak },
  {
    id: 'rail',
    title: 'SEPTA Regional Rail',
    subtitle: 'Gray 30th Street',
    accent: '#e2231a',
    kind: 'rail',
    rows: 10,
    source: (d) => d.septa,
  },
  {
    id: 'l',
    title: 'SEPTA Metro L',
    subtitle: 'Market-Frankford Line · Drexel Station at 30th St',
    accent: '#4aa3df',
    kind: 'metro',
    rows: 8,
    source: (d) => d.metroL,
    note: 'SEPTA publishes no live tracking for the L, so these are scheduled times.',
  },
  {
    id: 't',
    title: 'SEPTA Metro T',
    subtitle: 'Subway-Surface Trolleys · Drexel Station at 30th St',
    accent: '#5ea33a',
    kind: 'metro',
    rows: 8,
    source: (d) => d.metroT,
    note: 'Live arrival predictions from SEPTA where available; SCHEDULED means SEPTA has no prediction yet, usually because the trolley has not left its terminal.',
  },
];

export default function ArrivalsBoard() {
  const { data, error, loading, lastSuccess } = usePolledJson<ArrivalsResponse>('/api/arrivals');
  const compact = useCompact();
  const display = useDisplayOptions();

  const boards = display.enabled ? selectBoards(BOARDS, display.boards) : BOARDS;
  const columnsFor: Record<BoardConfig['kind'], Column[]> = {
    rail: visibleColumns(RAIL_COLUMNS, compact),
    metro: visibleColumns(METRO_COLUMNS, compact),
  };
  // One flap size for every board on screen, so columns line up.
  const chars = Math.max(...boards.map((b) => columnChars(columnsFor[b.kind])));

  const containerRef = useRef<HTMLDivElement>(null);
  const fitKey = `${boards.map((b) => b.id).join()}-${display.rows}-${compact}`;
  // Adapt rows to the screen: each board gets 3 to 12 rows (the API returns up to 12).
  const minBase = Math.min(...boards.map((b) => b.rows));
  const maxBase = Math.max(...boards.map((b) => b.rows));
  const extraRows = useFitToScreen(
    display.enabled,
    containerRef,
    fitKey,
    display.rows ? null : [3 - maxBase, 12 - minBase],
  );

  return (
    <PageShell
      kicker="William H. Gray III 30th Street Station"
      title="Arrivals"
      nav={{ href: '/49th-baltimore', label: 'T2 at 49th & Baltimore →' }}
      generatedAt={data?.generatedAt}
      error={error}
      lastSuccess={lastSuccess}
      display={display}
      containerRef={containerRef}
      credits={
        <>
          Amtrak data via{' '}
          <a className="underline hover:text-stone-300" href="https://amtraker.com">
            Amtraker
          </a>
          . SEPTA Regional Rail and Metro data via the {SEPTA_CREDIT}.
        </>
      }
    >
      {boards.map((b) => {
        const source = data ? b.source(data) : undefined;
        return (
          <Board
            key={b.id}
            title={b.title}
            subtitle={b.subtitle}
            accent={b.accent}
            columns={columnsFor[b.kind]}
            chars={chars}
            rows={source?.arrivals ?? []}
            rowCount={display.rows ?? Math.max(3, Math.min(12, b.rows + extraRows))}
            error={error ?? source?.error}
            loading={loading}
            note={display.enabled ? undefined : b.note}
          />
        );
      })}
    </PageShell>
  );
}
