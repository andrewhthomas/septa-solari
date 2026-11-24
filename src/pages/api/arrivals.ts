import type { APIRoute } from 'astro';
import { fetchAmtrak } from '../../lib/amtrak';
import { fetchSepta } from '../../lib/septa';
import { fetchMetroL, fetchMetroT } from '../../lib/metro';
import { cachedJson, settled } from '../../lib/cache';
import type { ArrivalsResponse, SourceResult } from '../../lib/types';

export const prerender = false;

const MAX_ROWS = 12;

function toSource(result: PromiseSettledResult<SourceResult>): SourceResult {
  const { value, error } = settled(result);
  return value ? { arrivals: value.arrivals.slice(0, MAX_ROWS) } : { arrivals: [], error };
}

export const GET: APIRoute = ({ request }) =>
  cachedJson(request, '/api/arrivals', 30, async () => {
    const now = new Date();
    const [amtrak, septa, metroL, metroT] = await Promise.allSettled([
      fetchAmtrak(now),
      fetchSepta(now),
      fetchMetroL(now),
      fetchMetroT(now),
    ]);

    const body: ArrivalsResponse = {
      generatedAt: now.toISOString(),
      amtrak: toSource(amtrak),
      septa: toSource(septa),
      metroL: toSource(metroL),
      metroT: toSource(metroT),
    };
    const hadError = [body.amtrak, body.septa, body.metroL, body.metroT].some((s) => s.error);
    return { body, hadError };
  });
