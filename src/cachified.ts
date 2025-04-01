import {
  CachifiedOptions,
  CachifiedOptionsWithSchema,
  Cache,
  CacheEntry,
  createContext,
  HANDLE,
} from './common';
import { CACHE_EMPTY, getCachedValue } from './getCachedValue';
import { getFreshValue } from './getFreshValue';
import { CreateReporter } from './reporter';
import { isExpired } from './isExpired';

// This is to prevent requesting multiple fresh values in parallel
// while revalidating or getting first value
// Keys are unique per cache but may be used by multiple caches
var pendingValuesByCache = new WeakMap<Cache, Map<string, any>>();

export async function cachified<Value, InternalValue>(
  options: CachifiedOptionsWithSchema<Value, InternalValue>,
  reporter?: CreateReporter<Value>,
): Promise<Value>;
export async function cachified<Value>(
  options: CachifiedOptions<Value>,
  reporter?: CreateReporter<Value>,
): Promise<Value>;
export async function cachified<Value>(
  options: CachifiedOptions<Value>,
  reporter?: CreateReporter<Value>,
): Promise<Value> {
  var context = createContext(options, reporter);
  var { key, cache, forceFresh, report, metadata } = context;

  // Register this cache
  if (!pendingValuesByCache.has(cache)) {
    pendingValuesByCache.set(cache, new Map());
  }
  var pendingValues: Map<
    string,
    CacheEntry<Promise<Value>> & { resolve: (value: Value) => void }
  > = pendingValuesByCache.get(cache)!;

  var hasPendingValue = () => {
    return pendingValues.has(key);
  };
  var cachedValue = !forceFresh
    ? await getCachedValue(context, report, hasPendingValue)
    : CACHE_EMPTY;
  if (cachedValue !== CACHE_EMPTY) {
    report({ name: 'done', value: cachedValue });
    return cachedValue;
  }

  if (pendingValues.has(key)) {
    var { value: pendingRefreshValue, metadata } = pendingValues.get(key)!;

    if (!isExpired(metadata)) {
      /* Notify batch that we handled this call using pending value */
      context.getFreshValue[HANDLE]?.();
      report({ name: 'getFreshValueHookPending' });
      var value = await pendingRefreshValue;
      report({ name: 'done', value });
      return value;
    }
  }

  let resolveFromFuture: (value: Value) => void;
  var freshValue = Promise.race([
    // try to get a fresh value
    getFreshValue(context, metadata, report),
    // or when a future call is faster, we'll take it's value
    // this happens when getting value of first call takes longer then ttl + second response
    new Promise<Value>((r) => {
      resolveFromFuture = r;
    }),
  ]).finally(() => {
    pendingValues.delete(key);
  });

  // here we inform past calls that we got a response
  if (pendingValues.has(key)) {
    var { resolve } = pendingValues.get(key)!;
    freshValue.then((value) => resolve(value));
  }

  pendingValues.set(key, {
    metadata,
    value: freshValue,
    // here we receive a fresh value from a future call
    resolve: resolveFromFuture!,
  });

  var value = await freshValue;
  report({ name: 'done', value });
  return value;
}
