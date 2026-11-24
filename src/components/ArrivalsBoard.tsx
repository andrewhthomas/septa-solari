import type { ArrivalsResponse } from '../lib/types';
import { Board, METRO_COLUMNS, RAIL_COLUMNS, columnChars, visibleColumns } from './Board';
import { PageShell, SEPTA_CREDIT, useCompact, usePolledJson } from './shared';

const RAIL_ROWS = 10;
const METRO_ROWS = 8;

export default function ArrivalsBoard() {
  const { data, error, loading } = usePolledJson<ArrivalsResponse>('/api/arrivals');
  const compact = useCompact();

  const railColumns = visibleColumns(RAIL_COLUMNS, compact);
  const metroColumns = visibleColumns(METRO_COLUMNS, compact);
  const chars = Math.max(columnChars(railColumns), columnChars(metroColumns));

  return (
    <PageShell
      kicker="William H. Gray III 30th Street Station"
      title="Arrivals"
      nav={{ href: '/49th-baltimore', label: 'T2 at 49th & Baltimore →' }}
      generatedAt={data?.generatedAt}
      error={error}
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
      <Board
        title="Amtrak"
        subtitle="Intercity"
        accent="#1d6fb8"
        columns={railColumns}
        chars={chars}
        rows={data?.amtrak.arrivals ?? []}
        rowCount={RAIL_ROWS}
        error={error ?? data?.amtrak.error}
        loading={loading}
      />

      <Board
        title="SEPTA Regional Rail"
        subtitle="Gray 30th Street"
        accent="#e2231a"
        columns={railColumns}
        chars={chars}
        rows={data?.septa.arrivals ?? []}
        rowCount={RAIL_ROWS}
        error={error ?? data?.septa.error}
        loading={loading}
      />

      <Board
        title="SEPTA Metro L"
        subtitle="Market-Frankford Line · Drexel Station at 30th St"
        accent="#4aa3df"
        columns={metroColumns}
        chars={chars}
        rows={data?.metroL.arrivals ?? []}
        rowCount={METRO_ROWS}
        error={error ?? data?.metroL.error}
        loading={loading}
        note="SEPTA publishes no live tracking for the L, so these are scheduled times."
      />

      <Board
        title="SEPTA Metro T"
        subtitle="Subway-Surface Trolleys · Drexel Station at 30th St"
        accent="#5ea33a"
        columns={metroColumns}
        chars={chars}
        rows={data?.metroT.arrivals ?? []}
        rowCount={METRO_ROWS}
        error={error ?? data?.metroT.error}
        loading={loading}
        note="Live arrival predictions from SEPTA where available; SCHEDULED means SEPTA has no prediction yet, usually because the trolley has not left its terminal."
      />
    </PageShell>
  );
}
