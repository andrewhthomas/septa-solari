export const STATION_TZ = 'America/New_York';

/** Offset of a time zone from UTC in minutes at a given instant (e.g. -300 for EST). */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = part?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/**
 * Parse a zone-less wall-clock string such as "2026-11-23 20:29:00.000"
 * (SEPTA's format) as Eastern time.
 */
export function parseEasternWallTime(value: string): Date | null {
  const m = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  if (!m) return null;
  const asUtc = new Date(`${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}Z`);
  if (Number.isNaN(asUtc.getTime())) return null;
  // Two passes so the offset is right on DST transition days.
  let result = new Date(asUtc.getTime() - tzOffsetMinutes(asUtc, STATION_TZ) * 60_000);
  result = new Date(asUtc.getTime() - tzOffsetMinutes(result, STATION_TZ) * 60_000);
  return result;
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

export function lateStatus(delay: number): string {
  return delay < 100 ? `${delay} MIN LATE` : `LATE ${delay} MIN`;
}
