function normalizeKey(key) {
  return String(key || "").trim();
}

function cloneValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  try {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }
  } catch (error) {
    // Fall through to JSON cloning for plain response data.
  }
  return JSON.parse(JSON.stringify(value));
}

const queryCacheStore = new Map();
const queryCacheInFlight = new Map();
const persistentCachePrefix = "joyno:query-cache:v1:";

function getPersistentQueryCacheStorage() {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }
    return window.localStorage;
  } catch (error) {
    return null;
  }
}

function getPersistentQueryCacheStorageKey(key) {
  return `${persistentCachePrefix}${key}`;
}

function readPersistentQueryCacheEntry(key) {
  const storage = getPersistentQueryCacheStorage();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(getPersistentQueryCacheStorageKey(key));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

function writePersistentQueryCacheEntry(key, value, updatedAt) {
  const storage = getPersistentQueryCacheStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(
      getPersistentQueryCacheStorageKey(key),
      JSON.stringify({
        value: cloneValue(value),
        updatedAt: Number(updatedAt || Date.now())
      })
    );
  } catch (error) {
    // Ignore quota and serialization errors for persistent cache writes.
  }
}

function removePersistentQueryCacheEntry(key) {
  const storage = getPersistentQueryCacheStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(getPersistentQueryCacheStorageKey(key));
  } catch (error) {
    // Ignore storage cleanup errors.
  }
}

function clearPersistentQueryCacheEntries() {
  const storage = getPersistentQueryCacheStorage();
  if (!storage) {
    return;
  }
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const storageKey = String(storage.key(index) || "");
      if (storageKey.startsWith(persistentCachePrefix)) {
        storage.removeItem(storageKey);
      }
    }
  } catch (error) {
    // Ignore storage cleanup errors.
  }
}

export function readQueryCache(key, options = {}) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) {
    return null;
  }
  let entry = queryCacheStore.get(normalizedKey);
  if (!entry) {
    const persistentEntry = readPersistentQueryCacheEntry(normalizedKey);
    if (persistentEntry && typeof persistentEntry === "object") {
      entry = {
        value: cloneValue(persistentEntry.value),
        updatedAt: Number(persistentEntry.updatedAt || 0)
      };
      queryCacheStore.set(normalizedKey, entry);
    }
  }
  if (!entry) {
    return null;
  }
  const ageMs = Math.max(0, Date.now() - Number(entry.updatedAt || 0));
  const maxAgeMs = Math.max(0, Number(options.maxAgeMs || 0));
  if (maxAgeMs && ageMs > maxAgeMs) {
    queryCacheStore.delete(normalizedKey);
    removePersistentQueryCacheEntry(normalizedKey);
    return null;
  }
  const staleMs = Math.max(0, Number(options.staleMs || 0));
  return {
    key: normalizedKey,
    value: cloneValue(entry.value),
    updatedAt: Number(entry.updatedAt || 0),
    ageMs,
    stale: staleMs ? ageMs > staleMs : false
  };
}

export function writeQueryCache(key, value) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) {
    return null;
  }
  const entry = {
    value: cloneValue(value),
    updatedAt: Date.now()
  };
  queryCacheStore.set(normalizedKey, entry);
  writePersistentQueryCacheEntry(normalizedKey, entry.value, entry.updatedAt);
  return readQueryCache(normalizedKey);
}

export async function fetchAndCacheQuery(key, fetcher) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey || typeof fetcher !== "function") {
    throw new Error("A cache key and fetcher are required.");
  }
  if (queryCacheInFlight.has(normalizedKey)) {
    return queryCacheInFlight.get(normalizedKey);
  }
  const request = Promise.resolve()
    .then(() => fetcher())
    .then((value) => {
      writeQueryCache(normalizedKey, value);
      return cloneValue(value);
    })
    .finally(() => {
      queryCacheInFlight.delete(normalizedKey);
    });
  queryCacheInFlight.set(normalizedKey, request);
  return request;
}

export function invalidateQueryCache(key) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) {
    return;
  }
  queryCacheStore.delete(normalizedKey);
  queryCacheInFlight.delete(normalizedKey);
  removePersistentQueryCacheEntry(normalizedKey);
}

export function invalidateQueryCacheByPrefix(prefix) {
  const normalizedPrefix = normalizeKey(prefix);
  if (!normalizedPrefix) {
    return;
  }
  [...queryCacheStore.keys()].forEach((key) => {
    if (key.startsWith(normalizedPrefix)) {
      queryCacheStore.delete(key);
    }
  });
  [...queryCacheInFlight.keys()].forEach((key) => {
    if (key.startsWith(normalizedPrefix)) {
      queryCacheInFlight.delete(key);
    }
  });
  const storage = getPersistentQueryCacheStorage();
  if (!storage) {
    return;
  }
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const storageKey = String(storage.key(index) || "");
      if (storageKey.startsWith(`${persistentCachePrefix}${normalizedPrefix}`)) {
        storage.removeItem(storageKey);
      }
    }
  } catch (error) {
    // Ignore storage cleanup errors.
  }
}

export function clearQueryCache(options = {}) {
  const preservePersistent = Boolean(options?.preservePersistent);
  queryCacheStore.clear();
  queryCacheInFlight.clear();
  if (!preservePersistent) {
    clearPersistentQueryCacheEntries();
  }
}
