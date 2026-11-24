import type { Arrival, SourceResult } from './types';
import { lateStatus, minutesBetween, parseEasternWallTime } from './time';

const STATION = 'Gray 30th Street';
const FEED_URL = `https://www3.septa.org/api/Arrivals/index.php?station=${encodeURIComponent(
  STATION,
)}&results=20`;

interface SeptaTrain {
  train_id: string;
  origin: string;
  destination: string;
  line: string;
  status: string;
  sched_time: string;
  track: string | null;
  track_change: string | null;
}

/** Shorten names that would otherwise be cut mid-word on a 16-character field. */
const SHORT_NAMES: Record<string, string> = {
  'Airport Terminal E-F': 'Airport',
  'Penn Medical Station': 'Penn Medicine',
  'Chestnut Hill East': 'Chestnut Hl East',
  'Chestnut Hill West': 'Chestnut Hl West',
  'Chestnut H East': 'Chestnut Hl East',
  'Chestnut H West': 'Chestnut Hl West',
  'Wilmington/Newark': 'Wilmington',
  'Manayunk/Norristown': 'Norristown',
  'Lansdale/Doylestown': 'Doylestown',
  'Jefferson Station': 'Jefferson',
};

const shorten = (name: string) => SHORT_NAMES[name.trim()] ?? name.trim();

type SeptaFeed = Record<string, Array<Record<string, SeptaTrain[]>>>;

export function normalizeSepta(feed: SeptaFeed, now: Date): Arrival[] {
  const groups = Object.values(feed)[0] ?? [];
  const seen = new Set<string>();
  const arrivals: Arrival[] = [];

  for (const group of groups) {
    for (const train of Object.values(group).flat()) {
      if (/30th/i.test(train.origin)) continue; // originates here; no arrival
      const scheduled = parseEasternWallTime(train.sched_time);
      if (!scheduled) continue;

      const key = `${train.train_id}-${train.sched_time}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const raw = (train.status ?? '').trim();
      const lateMatch = raw.match(/^(\d+)\s*min/i);
      const delay = lateMatch ? Number(lateMatch[1]) : 0;
      const estimated = new Date(scheduled.getTime() + delay * 60_000);

      let status: string;
      let statusKind: Arrival['statusKind'];
      if (/cancel|suspend/i.test(raw)) {
        status = 'CANCELED';
        statusKind = 'canceled';
      } else if (delay > 0) {
        status = lateStatus(delay);
        statusKind = 'late';
      } else if (/on\s*time/i.test(raw) || raw === '') {
        status = 'ON TIME';
        statusKind = 'ontime';
      } else {
        status = raw.toUpperCase();
        statusKind = 'other';
      }

      if (minutesBetween(estimated, now) > 2) continue;

      arrivals.push({
        id: `septa-${key}`,
        carrier: 'septa',
        train: train.train_id,
        line: shorten(train.line),
        origin: shorten(train.origin),
        scheduled: scheduled.toISOString(),
        estimated: estimated.toISOString(),
        track: (train.track_change || train.track || '').trim(),
        status,
        statusKind,
      });
    }
  }

  return arrivals.sort((a, b) => a.estimated.localeCompare(b.estimated));
}

export async function fetchSepta(now: Date): Promise<SourceResult> {
  const res = await fetch(FEED_URL, {
    headers: { accept: 'application/json' },
    cf: { cacheTtl: 20, cacheEverything: true },
  } as RequestInit);
  if (!res.ok) throw new Error(`SEPTA responded ${res.status}`);
  const feed = (await res.json()) as SeptaFeed;
  return { arrivals: normalizeSepta(feed, now) };
}
