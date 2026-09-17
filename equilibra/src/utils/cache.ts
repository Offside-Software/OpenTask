/**
 * Browser storage cache utility with safe JSON serialization.
 *
 * CACHE SAFETY GUARANTEE
 * ─────────────────────
 * Every write that follows a UI mutation (optimistic update, server-confirmed
 * result, or delete) MUST also call setCached / updateCachedArray / similar
 * so that a hard reload never shows stale data.
 *
 * Rule of thumb:
 *   setStateOptimistically(value)  →  setCached(key, value)
 *   confirm from server(result)    →  setCached(key, result)   (or array variant)
 *   rollback on error              →  setCached(key, original)  (or just refetch)
 */

export function getCached<T>(key: string): T | null {
  try {
    const item = localStorage.getItem(key);
    if (!item) return null;
    return JSON.parse(item) as T;
  } catch (err) {
    console.warn(`[Cache] Failed to read key: ${key}`, err);
    return null;
  }
}

export function setCached<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.warn(`[Cache] Failed to write key: ${key}`, err);
  }
}

export function removeCached(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    console.warn(`[Cache] Failed to remove key: ${key}`, err);
  }
}

/**
 * Surgically patch one item inside a cached array (matched by id field).
 * Returns the resulting array so callers can also call setState with it.
 */
export function patchCachedArrayItem<T extends { id?: string | number }>(
  key: string,
  itemId: string | number,
  patch: Partial<T>,
): T[] {
  const cached = getCached<T[]>(key) ?? [];
  const next = cached.map((item) =>
    String(item.id) === String(itemId) ? { ...item, ...patch } : item,
  );
  setCached(key, next);
  return next;
}

/**
 * Append one item into a cached array (used for create-then-cache patterns).
 */
export function appendToCachedArray<T>(key: string, item: T): T[] {
  const cached = getCached<T[]>(key) ?? [];
  const next = [...cached, item];
  setCached(key, next);
  return next;
}

/**
 * Remove one item from a cached array by id.
 */
export function removeFromCachedArray<T extends { id?: string | number }>(
  key: string,
  itemId: string | number,
): T[] {
  const cached = getCached<T[]>(key) ?? [];
  const next = cached.filter((item) => String(item.id) !== String(itemId));
  setCached(key, next);
  return next;
}


