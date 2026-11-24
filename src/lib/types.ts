export type Carrier = 'amtrak' | 'septa' | 'septa-l' | 'septa-t';

export type StatusKind = 'ontime' | 'late' | 'early' | 'arrived' | 'canceled' | 'scheduled' | 'other';

export interface Arrival {
  id: string;
  carrier: Carrier;
  train: string;
  line: string;
  origin: string;
  /** Where the train is headed (used by the Metro boards). */
  destination?: string;
  /** e.g. "Eastbound" */
  direction?: string;
  /** Live position (trolleys SEPTA is tracking): the vehicle's next stop. */
  nextStop?: string;
  /** Live position: stops between the vehicle and this stop (0 = this is its next stop). */
  stopsAway?: number;
  /** ISO timestamp of the scheduled arrival at 30th Street */
  scheduled: string;
  /** ISO timestamp of the best current estimate */
  estimated: string;
  track: string;
  status: string;
  statusKind: StatusKind;
}

export interface SourceResult {
  arrivals: Arrival[];
  error?: string;
}

export interface ArrivalsResponse {
  generatedAt: string;
  amtrak: SourceResult;
  septa: SourceResult;
  metroL: SourceResult;
  metroT: SourceResult;
}

export interface StopResponse {
  generatedAt: string;
  eastbound: SourceResult;
  westbound: SourceResult;
}
