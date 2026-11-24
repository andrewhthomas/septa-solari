import type { Arrival, SourceResult } from './types';
import { lateStatus, minutesBetween } from './time';

const FEED_URL = 'https://api-v3.amtraker.com/v3/trains';
const STATION_CODE = 'PHL';

interface AmtrakerStop {
  code: string;
  schArr?: string | null;
  arr?: string | null;
  schDep?: string | null;
  status: 'Enroute' | 'Station' | 'Departed' | string;
  platform?: string;
}

interface AmtrakerTrain {
  trainID: string;
  trainNum: string;
  routeName: string;
  origCode: string;
  origName: string;
  trainState: string;
  statusMsg?: string;
  stations: AmtrakerStop[];
}

const ORIGIN_NAMES: Record<string, string> = {
  'Washington Union': 'Washington',
  'Washington Union Station': 'Washington',
  'Boston South': 'Boston',
  'Boston South Station': 'Boston',
};

const LINE_NAMES: Record<string, string> = {
  'Northeast Regional': 'NE Regional',
};

function cleanStationName(name: string): string {
  const trimmed = name.trim();
  return ORIGIN_NAMES[trimmed] ?? trimmed.replace(/\s+Station$/i, '');
}

export function normalizeAmtrak(
  feed: Record<string, AmtrakerTrain[]>,
  now: Date,
): Arrival[] {
  const arrivals: Arrival[] = [];

  for (const trains of Object.values(feed)) {
    for (const train of trains) {
      if (train.origCode === STATION_CODE) continue; // originates here; no arrival
      const stop = train.stations.find((s) => s.code === STATION_CODE);
      if (!stop || stop.status === 'Departed') continue;

      const schedIso = stop.schArr ?? stop.schDep;
      if (!schedIso) continue;
      const scheduled = new Date(schedIso);
      const estimated = new Date(stop.arr ?? schedIso);
      if (Number.isNaN(scheduled.getTime()) || Number.isNaN(estimated.getTime())) continue;

      const canceled = /cancel/i.test(train.statusMsg ?? '');
      const delay = minutesBetween(scheduled, estimated);

      let status: string;
      let statusKind: Arrival['statusKind'];
      if (canceled) {
        status = 'CANCELED';
        statusKind = 'canceled';
      } else if (stop.status === 'Station' && minutesBetween(now, estimated) <= 5) {
        // Amtraker sometimes flags "Station" while the train is still at an
        // earlier stop, so only trust it when the arrival is close.
        status = 'ARRIVED';
        statusKind = 'arrived';
      } else if (delay >= 1) {
        status = lateStatus(delay);
        statusKind = 'late';
      } else {
        status = 'ON TIME';
        statusKind = 'ontime';
      }

      // Drop stale "Enroute" rows whose estimate is well in the past.
      if (statusKind !== 'arrived' && minutesBetween(estimated, now) > 10) continue;

      arrivals.push({
        id: `amtrak-${train.trainID}`,
        carrier: 'amtrak',
        train: train.trainNum,
        line: LINE_NAMES[train.routeName] ?? train.routeName,
        origin: cleanStationName(train.origName),
        scheduled: scheduled.toISOString(),
        estimated: estimated.toISOString(),
        track: stop.platform?.trim() ?? '',
        status,
        statusKind,
      });
    }
  }

  return arrivals.sort((a, b) => a.estimated.localeCompare(b.estimated));
}

export async function fetchAmtrak(now: Date): Promise<SourceResult> {
  const res = await fetch(FEED_URL, {
    headers: { accept: 'application/json' },
    // Let Cloudflare's edge cache the 1.2 MB upstream feed briefly.
    cf: { cacheTtl: 30, cacheEverything: true },
  } as RequestInit);
  if (!res.ok) throw new Error(`Amtraker responded ${res.status}`);
  const feed = (await res.json()) as Record<string, AmtrakerTrain[]>;
  return { arrivals: normalizeAmtrak(feed, now) };
}
