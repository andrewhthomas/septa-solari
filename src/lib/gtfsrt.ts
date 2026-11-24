/**
 * Minimal, allocation-light reader for a GTFS-realtime TripUpdates feed.
 *
 * SEPTA's feed is ~750 KB covering every bus, trolley and subway trip. A full
 * protobuf decode costs more CPU than a Worker request should spend, so this
 * walks the wire format directly, checks each trip's route first, and jumps
 * over the bytes of any trip it does not care about.
 *
 * Field numbers are from gtfs-realtime.proto:
 *   FeedMessage { 2: entity }
 *   FeedEntity { 3: trip_update }
 *   TripUpdate { 1: trip, 2: stop_time_update }
 *   TripDescriptor { 1: trip_id, 5: route_id }
 *   StopTimeUpdate { 1: stop_sequence, 2: arrival, 3: departure, 4: stop_id }
 *   StopTimeEvent { 2: time }
 */

const textDecoder = new TextDecoder();

class Reader {
  readonly buf: Uint8Array;
  readonly end: number;
  pos: number;

  constructor(buf: Uint8Array, start = 0, end = buf.length) {
    this.buf = buf;
    this.pos = start;
    this.end = end;
  }

  get done() {
    return this.pos >= this.end;
  }

  /** Varint as a JS number. Safe for the 32-bit ids and 64-bit epoch seconds GTFS-RT uses. */
  varint(): number {
    let result = 0;
    let scale = 1;
    for (;;) {
      if (this.pos >= this.end) throw new Error('GTFS-RT: truncated varint');
      const byte = this.buf[this.pos++];
      result += (byte & 0x7f) * scale;
      if (byte < 0x80) return result;
      scale *= 128;
    }
  }

  /** Returns [start, end) of a length-delimited field's payload and moves past it. */
  bytes(): [number, number] {
    const len = this.varint();
    const start = this.pos;
    this.pos += len;
    if (this.pos > this.end) throw new Error('GTFS-RT: truncated field');
    return [start, this.pos];
  }

  string(): string {
    const [s, e] = this.bytes();
    return textDecoder.decode(this.buf.subarray(s, e));
  }

  skip(wireType: number) {
    switch (wireType) {
      case 0:
        this.varint();
        return;
      case 1:
        this.pos += 8;
        return;
      case 2:
        this.bytes();
        return;
      case 5:
        this.pos += 4;
        return;
      default:
        throw new Error(`GTFS-RT: unsupported wire type ${wireType}`);
    }
  }

  /** Iterate the fields of the message spanning [pos, end). */
  *fields(): Generator<[field: number, wireType: number]> {
    while (this.pos < this.end) {
      const tag = this.varint();
      yield [Math.floor(tag / 8), tag & 7];
    }
  }
}

export interface TripPrediction {
  routeId: string;
  /** Predicted arrival by stop ID. */
  stops: Map<string, StopPrediction>;
}

export interface StopPrediction {
  /** Epoch seconds */
  time: number;
  /** The stop's position in the trip; matches TransitView's next_stop_sequence. */
  sequence?: number;
}

/** Keyed by trip ID. */
export type Predictions = Map<string, TripPrediction>;

function readEventTime(r: Reader, [start, end]: [number, number]): number | undefined {
  const sub = new Reader(r.buf, start, end);
  let time: number | undefined;
  for (const [field, wire] of sub.fields()) {
    if (field === 2 && wire === 0) time = sub.varint();
    else sub.skip(wire);
  }
  return time || undefined;
}

function readStopTimeUpdate(r: Reader, span: [number, number], stopIds: Set<string>) {
  const sub = new Reader(r.buf, span[0], span[1]);
  let stopId: string | undefined;
  let sequence: number | undefined;
  let arrival: number | undefined;
  let departure: number | undefined;
  for (const [field, wire] of sub.fields()) {
    if (field === 4 && wire === 2) stopId = sub.string();
    else if (field === 1 && wire === 0) sequence = sub.varint();
    else if (field === 2 && wire === 2) arrival = readEventTime(sub, sub.bytes());
    else if (field === 3 && wire === 2) departure = readEventTime(sub, sub.bytes());
    else sub.skip(wire);
  }
  if (!stopId || !stopIds.has(stopId)) return null;
  const time = arrival ?? departure;
  return time ? { stopId, time, sequence } : null;
}

function readTripDescriptor(r: Reader, span: [number, number]) {
  const sub = new Reader(r.buf, span[0], span[1]);
  let tripId = '';
  let routeId = '';
  for (const [field, wire] of sub.fields()) {
    if (field === 1 && wire === 2) tripId = sub.string();
    else if (field === 5 && wire === 2) routeId = sub.string();
    else sub.skip(wire);
  }
  return { tripId, routeId };
}

function readTripUpdate(
  r: Reader,
  span: [number, number],
  wantRoute: (routeId: string) => boolean,
  stopIds: Set<string>,
  out: Predictions,
) {
  const sub = new Reader(r.buf, span[0], span[1]);
  let trip: { tripId: string; routeId: string } | undefined;
  const pending: [number, number][] = [];

  for (const [field, wire] of sub.fields()) {
    if (field === 1 && wire === 2) {
      trip = readTripDescriptor(sub, sub.bytes());
      // The trip descriptor comes first in practice: bail out of unwanted routes early.
      if (!wantRoute(trip.routeId)) return;
    } else if (field === 2 && wire === 2) {
      pending.push(sub.bytes());
    } else {
      sub.skip(wire);
    }
  }

  if (!trip || !trip.tripId || !wantRoute(trip.routeId)) return;
  for (const stuSpan of pending) {
    const hit = readStopTimeUpdate(sub, stuSpan, stopIds);
    if (!hit) continue;
    let entry = out.get(trip.tripId);
    if (!entry) out.set(trip.tripId, (entry = { routeId: trip.routeId, stops: new Map() }));
    entry.stops.set(hit.stopId, { time: hit.time, sequence: hit.sequence });
  }
}

/** Extract predicted arrivals at the given stops for routes matching `wantRoute`. */
export function parseTripUpdates(
  buf: Uint8Array,
  wantRoute: (routeId: string) => boolean,
  stopIds: Set<string>,
): Predictions {
  const out: Predictions = new Map();
  const feed = new Reader(buf);
  for (const [field, wire] of feed.fields()) {
    if (field !== 2 || wire !== 2) {
      feed.skip(wire);
      continue;
    }
    const entity = new Reader(buf, ...feed.bytes());
    for (const [ef, ew] of entity.fields()) {
      if (ef === 3 && ew === 2) readTripUpdate(entity, entity.bytes(), wantRoute, stopIds, out);
      else entity.skip(ew);
    }
  }
  return out;
}
