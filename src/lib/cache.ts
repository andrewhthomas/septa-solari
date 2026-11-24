/**
 * Serve a JSON body from Cloudflare's edge cache, building it on a miss.
 * Responses that report an upstream error are cached briefly so a blip recovers fast.
 */
export async function cachedJson(
  request: Request,
  path: string,
  ttlSeconds: number,
  build: () => Promise<{ body: unknown; hadError: boolean }>,
): Promise<Response> {
  const cache = (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches?.default;
  const cacheKey = new Request(new URL(path, request.url).toString());

  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const { body, hadError } = await build();
  const response = new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${hadError ? 5 : ttlSeconds}`,
    },
  });

  if (cache) await cache.put(cacheKey, response.clone());
  return response;
}

export function settled<T>(result: PromiseSettledResult<T>): { value?: T; error?: string } {
  if (result.status === 'fulfilled') return { value: result.value };
  const reason = result.reason;
  return { error: reason instanceof Error ? reason.message : String(reason) };
}
