import type { Arrival, SourceResult } from './types';
import { lateStatus, minutesBetween, parseEasternWallTime } from './time';
import { parseTripUpdates, type Predictions } from './gtfsrt';

/**
 * SEPTA Metro at Drexel Station at 30th St (the subway/trolley station under
 * Market Street, connected to the train station's concourse).
 *
 * Times come from SEPTA's stop schedule API. Trolley (T1-T5) rows are then
 * made live, best source first:
 *   1. GTFS-realtime TripUpdates: a predicted arrival at this exact stop. SEPTA
 *      publishes these for trips in progress and for many trips not yet started.
 *   2. TransitView: the vehicle's current lateness, for trips in progress.
 * Anything with neither stays SCHEDULED.
 *
 * The schedule API drops a trip once its scheduled time passes, even if the
 * trolley is running late and has not arrived. Trips that GTFS-RT still
 * predicts for one of our stops are added back, using TransitView for the
 * destination and lateness. The L has no usable realtime feed
 * (its GTFS-RT entries carry no times), so L rows are schedule only.
 */
const SCHEDULE_URL = 'https://www3.septa.org/api/BusSchedules/index.php';
const TRANSITVIEW_URL = 'https://www3.septa.org/api/TransitViewAll/index.php';
const TRIP_UPDATES_URL = 'https://www3.septa.org/gtfsrt/septa-pa-us/Trip/rtTripUpdates.pb';
const STOPS_URL = 'https://www3.septa.org/api/Stops/index.php';

const L_STOPS = [
  { stopId: '21532', direction: 'Eastbound' },
  { stopId: '32176', direction: 'Westbound' },
];
const T_STOPS = [
  { stopId: '20643', direction: 'Eastbound' },
  { stopId: '20662', direction: 'Westbound' },
];

/** T2 at Baltimore Av & 49th St. 600 = toward Center City, 601 = toward 61st. */
const T2_49TH_STOPS = [
  { stopId: '600', direction: 'Eastbound' },
  { stopId: '601', direction: 'Westbound' },
];

const TROLLEY_STOP_IDS = new Set([...T_STOPS, ...T2_49TH_STOPS].map((s) => s.stopId));
const isTrolleyRoute = (routeId: string) => /^T\d$/.test(routeId);

/** Within this many minutes, a live trolley shows DUE instead of a delay. */
const DUE_MINUTES = 1;

const DESTINATION_NAMES: Record<string, string> = {
  'Frankford Transit Center': 'Frankford TC',
  'Frankford Transportation Center': 'Frankford TC',
  '69th St Transit Center': '69th St TC',
  '69th St Transportation Center': '69th St TC',
  'Darby Transit Center': 'Darby TC',
};

interface ScheduledStop {
  Route: string;
  trip_id: string;
  DateCalender: string;
  DirectionDesc: string;
}

interface Vehicle {
  trip: string;
  late: number;
  destination?: string;
  next_stop_id?: string | number | null;
  next_stop_name?: string | null;
  next_stop_sequence?: number | null;
}

interface VehicleStatus {
  late: number;
  destination?: string;
  nextStopId?: string;
  nextStopName?: string;
  nextStopSequence?: number;
}

/** "11/23/26 08:49 pm" (Eastern) -> Date */
export function parseScheduleTime(value: string): Date | null {
  const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*([ap])m$/i);
  if (!m) return null;
  const [, mo, d, y, h, min, ap] = m;
  const year = y.length === 2 ? `20${y}` : y;
  let hour = Number(h) % 12;
  if (ap.toLowerCase() === 'p') hour += 12;
  const pad = (n: string | number) => String(n).padStart(2, '0');
  return parseEasternWallTime(`${year}-${pad(mo)}-${pad(d)} ${pad(hour)}:${min}:00`);
}

async function getJson<T>(url: string, ttl: number): Promise<T> {
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    cf: { cacheTtl: ttl, cacheEverything: true },
  } as RequestInit);
  if (!res.ok) throw new Error(`SEPTA responded ${res.status}`);
  return (await res.json()) as T;
}

async function fetchStopSchedule(stopId: string, count: number): Promise<ScheduledStop[]> {
  const data = await getJson<Record<string, ScheduledStop[]> | []>(
    `${SCHEDULE_URL}?stop_id=${stopId}&req6=${count}`,
    30,
  );
  return Array.isArray(data) ? [] : Object.values(data).flat();
}

const shortDestination = (name: string) => DESTINATION_NAMES[name.trim()] ?? name.trim();

interface LiveData {
  predictions: Predictions | null;
  vehicles: Map<string, VehicleStatus> | null;
  /** Stop ID -> name, to label a vehicle's next stop when TransitView leaves it blank. */
  stopNames?: Map<string, string> | null;
}

/** "Baltimore Av & 55th St - FS" -> "55th St"; "Drexel Station at 30th St" -> "30th St". */
function shortStopName(name: string): string {
  const clean = name.replace(/\s+-\s+\w+$/, '').replace(/^Drexel Station at\s+/i, '').trim();
  const parts = clean.split(/\s*&\s*/);
  if (parts.length < 2) return clean;
  // Name the cross street, not the avenue the trolley runs along.
  return parts.find((p) => !/\b(Av|Ave|Avenue)\b/i.test(p)) ?? parts[parts.length - 1];
}

/**
 * Where a tracked trolley is relative to `stopId`. TransitView's next_stop_sequence
 * and GTFS-RT's stop_sequence use the same numbering (checked against every
 * tracked vehicle), so their difference is the number of stops still to go.
 */
function positionFor(tripId: string, stopId: string, live: LiveData | null) {
  const vehicle = live?.vehicles?.get(tripId);
  if (!vehicle?.nextStopId) return {};
  const name = vehicle.nextStopName || live?.stopNames?.get(vehicle.nextStopId);
  const target = live?.predictions?.get(tripId)?.stops.get(stopId)?.sequence;
  const stopsAway =
    target !== undefined && vehicle.nextStopSequence !== undefined
      ? target - vehicle.nextStopSequence
      : undefined;
  return { nextStop: name ? shortStopName(name) : undefined, stopsAway };
}

function statusFor(late: number | undefined, estimated: Date, now: Date) {
  if (late === undefined) return { status: 'SCHEDULED', statusKind: 'scheduled' as const };
  if (minutesBetween(now, estimated) <= DUE_MINUTES) return { status: 'DUE', statusKind: 'arrived' as const };
  if (late >= 2) return { status: lateStatus(late), statusKind: 'late' as const };
  if (late <= -2) return { status: `${-late} MIN EARLY`, statusKind: 'early' as const };
  return { status: 'ON TIME', statusKind: 'ontime' as const };
}

function buildRows(
  carrier: Arrival['carrier'],
  stops: { stopId: string; direction: string; trips: ScheduledStop[] }[],
  now: Date,
  live: LiveData | null,
  routes?: string[],
): Arrival[] {
  const rows: Arrival[] = [];
  const seen = new Set<string>();
  const seenTrips = new Set<string>();

  for (const { stopId, direction, trips } of stops) {
    for (const trip of trips) {
      const scheduled = parseScheduleTime(trip.DateCalender);
      if (!scheduled) continue;
      const key = `${trip.Route}-${trip.trip_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      seenTrips.add(trip.trip_id);

      const predicted = live?.predictions?.get(trip.trip_id)?.stops.get(stopId);
      let estimated: Date;
      let late: number | undefined;
      if (predicted) {
        estimated = new Date(predicted.time * 1000);
        late = minutesBetween(scheduled, estimated);
      } else {
        late = live?.vehicles?.get(trip.trip_id)?.late;
        estimated = new Date(scheduled.getTime() + (late ?? 0) * 60_000);
      }

      const { status, statusKind } = statusFor(late, estimated, now);
      const position = positionFor(trip.trip_id, stopId, live);

      if (minutesBetween(estimated, now) > 1) continue;
      if (position.stopsAway !== undefined && position.stopsAway < 0) continue; // already passed

      rows.push({
        ...position,
        id: `${carrier}-${key}`,
        carrier,
        train: trip.Route === 'L1' ? 'L' : trip.Route,
        line: trip.Route,
        origin: '',
        destination: shortDestination(trip.DirectionDesc),
        direction,
        scheduled: scheduled.toISOString(),
        estimated: estimated.toISOString(),
        track: '',
        status,
        statusKind,
      });
    }
  }

  // Late trolleys the schedule API has already dropped, but GTFS-RT still predicts.
  for (const [tripId, prediction] of live?.predictions ?? []) {
    if (seenTrips.has(tripId)) continue;
    if (routes && !routes.includes(prediction.routeId)) continue;
    const vehicle = live?.vehicles?.get(tripId);
    if (!vehicle?.destination) continue; // no way to label it honestly

    for (const { stopId, direction } of stops) {
      const predicted = prediction.stops.get(stopId);
      if (!predicted) continue;
      const estimated = new Date(predicted.time * 1000);
      if (minutesBetween(estimated, now) > 1) continue;
      const position = positionFor(tripId, stopId, live);
      if (position.stopsAway !== undefined && position.stopsAway < 0) continue;
      const scheduled = new Date(estimated.getTime() - vehicle.late * 60_000);
      const { status, statusKind } = statusFor(vehicle.late, estimated, now);

      rows.push({
        ...position,
        id: `${carrier}-${prediction.routeId}-${tripId}`,
        carrier,
        train: prediction.routeId,
        line: prediction.routeId,
        origin: '',
        destination: shortDestination(vehicle.destination),
        direction,
        scheduled: scheduled.toISOString(),
        estimated: estimated.toISOString(),
        track: '',
        status,
        statusKind,
      });
    }
  }

  return rows.sort((a, b) => a.estimated.localeCompare(b.estimated));
}

export async function fetchMetroL(now: Date): Promise<SourceResult> {
  const stops = await Promise.all(
    L_STOPS.map(async (s) => ({ ...s, trips: await fetchStopSchedule(s.stopId, 10) })),
  );
  return { arrivals: buildRows('septa-l', stops, now, null) };
}

/** Lateness (minutes) and destination of trolleys SEPTA is tracking, keyed by trip ID. */
async function trolleyVehicles(): Promise<Map<string, VehicleStatus> | null> {
  try {
    const tv = await getJson<{ routes: Record<string, Vehicle[]>[] }>(TRANSITVIEW_URL, 15);
    const map = new Map<string, VehicleStatus>();
    for (const group of tv.routes) {
      for (const [route, vehicles] of Object.entries(group)) {
        if (!isTrolleyRoute(route)) continue;
        for (const v of vehicles) {
          if (v.trip && Number.isFinite(Number(v.late))) {
            const seq = Number(v.next_stop_sequence);
            map.set(String(v.trip), {
              late: Number(v.late),
              destination: v.destination,
              nextStopId: v.next_stop_id ? String(v.next_stop_id) : undefined,
              nextStopName: v.next_stop_name ?? undefined,
              nextStopSequence: Number.isFinite(seq) && v.next_stop_sequence != null ? seq : undefined,
            });
          }
        }
      }
    }
    return map;
  } catch {
    // Live data is a bonus: if TransitView is down, fall back to the schedule.
    return null;
  }
}

async function trolleyStops(
  stops: { stopId: string; direction: string }[],
  count: number,
  routes?: string[],
) {
  return Promise.all(
    stops.map(async (s) => {
      const trips = await fetchStopSchedule(s.stopId, count);
      return {
        ...s,
        trips: routes ? trips.filter((t) => routes.includes(t.Route)) : trips,
      };
    }),
  );
}

/** Predicted arrivals at our trolley stops from SEPTA's GTFS-realtime feed. */
async function trolleyPredictions(): Promise<Predictions | null> {
  try {
    const res = await fetch(TRIP_UPDATES_URL, {
      cf: { cacheTtl: 15, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) throw new Error(`SEPTA GTFS-RT responded ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    return parseTripUpdates(buf, isTrolleyRoute, TROLLEY_STOP_IDS);
  } catch {
    // Fall back to TransitView lateness, then to the schedule.
    return null;
  }
}

/** Stop names for a route. They rarely change, so the edge keeps them for a day. */
async function routeStopNames(route: string): Promise<Map<string, string> | null> {
  try {
    const stops = await getJson<{ stopid: string; stopname: string }[]>(
      `${STOPS_URL}?req1=${route}`,
      86_400,
    );
    return new Map(stops.map((s) => [String(s.stopid), s.stopname]));
  } catch {
    return null;
  }
}

async function trolleyLive(namesForRoute?: string): Promise<LiveData> {
  const [predictions, vehicles, stopNames] = await Promise.all([
    trolleyPredictions(),
    trolleyVehicles(),
    namesForRoute ? routeStopNames(namesForRoute) : null,
  ]);
  return { predictions, vehicles, stopNames };
}

export async function fetchMetroT(now: Date): Promise<SourceResult> {
  const [stops, live] = await Promise.all([trolleyStops(T_STOPS, 10), trolleyLive()]);
  return { arrivals: buildRows('septa-t', stops, now, live) };
}

export async function fetchT2At49th(now: Date) {
  const [stops, live] = await Promise.all([
    trolleyStops(T2_49TH_STOPS, 10, ['T2']),
    trolleyLive('T2'),
  ]);
  const rows = buildRows('septa-t', stops, now, live, ['T2']);
  return {
    eastbound: rows.filter((r) => r.direction === 'Eastbound'),
    westbound: rows.filter((r) => r.direction === 'Westbound'),
  };
}
