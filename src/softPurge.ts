import { Cache, createCacheEntry, staleWhileRevalidate } from './common';
import { CACHE_EMPTY, getCacheEntry } from './getCachedValue';
import { isExpired } from './isExpired';

interface SoftPurgeOpts {
  cache: Cache;
  key: string;
  /**
   * Force the entry to outdate after ms
   */
  staleWhileRevalidate?: number;
  /**
   * Force the entry to outdate after ms
   */
  swr?: number;
}

export async function softPurge({
  cache,
  key,
  ...swrOverwrites
}: SoftPurgeOpts) {
  let swrOverwrite = swrOverwrites.swr ?? swrOverwrites.staleWhileRevalidate;
  let entry = await getCacheEntry({ cache, key }, () => {});

  if (entry === CACHE_EMPTY || isExpired(entry.metadata)) {
    return;
  }

  let ttl = entry.metadata.ttl || Infinity;
  let swr = staleWhileRevalidate(entry.metadata) || 0;
  let lt = Date.now() - entry.metadata.createdTime;

  await cache.set(
    key,
    createCacheEntry(entry.value, {
      ttl: 0,
      swr: swrOverwrite === undefined ? ttl + swr : swrOverwrite + lt,
      createdTime: entry.metadata.createdTime,
    }),
  );
}
