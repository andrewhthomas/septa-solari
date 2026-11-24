import type { APIRoute } from 'astro';
import { fetchT2At49th } from '../../lib/metro';
import { cachedJson, settled } from '../../lib/cache';
import type { StopResponse } from '../../lib/types';

export const prerender = false;

export const GET: APIRoute = ({ request }) =>
  cachedJson(request, '/api/49th-baltimore', 30, async () => {
    const now = new Date();
    const { value, error } = settled((await Promise.allSettled([fetchT2At49th(now)]))[0]);
    const body: StopResponse = {
      generatedAt: now.toISOString(),
      eastbound: { arrivals: value?.eastbound ?? [], error },
      westbound: { arrivals: value?.westbound ?? [], error },
    };
    return { body, hadError: Boolean(error) };
  });
