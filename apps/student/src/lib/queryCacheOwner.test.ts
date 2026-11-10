import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient } from '@tanstack/react-query';
import { claimQueryCache, forgetQueryCache, QUERY_CACHE_OWNER_KEY, removeOldWebQueryCache } from './queryCacheOwner';
import { createWebSessionQueryStorage, QUERY_CACHE_KEY } from './queryPersister';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const AsyncStorage = require('@react-native-async-storage/async-storage') as { removeItem: ReturnType<typeof jest.fn> };

/** Decision 451 item 5 (S-6): the member app's saved screens. */
function memoryStorage() {
  const saved = new Map<string, string>();
  return {
    saved,
    getItem: async (key: string) => saved.get(key) ?? null,
    setItem: async (key: string, value: string) => void saved.set(key, value),
    removeItem: async (key: string) => void saved.delete(key),
  };
}

describe('claimQueryCache', () => {
  let queryClient: QueryClient;
  let persister: { removeClient: ReturnType<typeof jest.fn> };
  beforeEach(() => {
    queryClient = new QueryClient();
    queryClient.setQueryData(['my-bookings'], ['a booking']);
    persister = { removeClient: jest.fn(async () => undefined) };
  });

  it('keeps the cache of the person it was saved for', async () => {
    const storage = memoryStorage();
    storage.saved.set(QUERY_CACHE_OWNER_KEY, 'u1');
    await claimQueryCache(queryClient, 'u1', storage, persister);
    expect(queryClient.getQueryData(['my-bookings'])).toEqual(['a booking']);
    expect(persister.removeClient).not.toHaveBeenCalled();
  });

  it('empties a cache saved for someone else, and records the new owner', async () => {
    const storage = memoryStorage();
    storage.saved.set(QUERY_CACHE_OWNER_KEY, 'u1');
    await claimQueryCache(queryClient, 'u2', storage, persister);
    expect(queryClient.getQueryData(['my-bookings'])).toBeUndefined();
    expect(persister.removeClient).toHaveBeenCalled();
    expect(storage.saved.get(QUERY_CACHE_OWNER_KEY)).toBe('u2');
  });

  it('empties a cache saved for nobody known', async () => {
    const storage = memoryStorage();
    await claimQueryCache(queryClient, 'u1', storage, persister);
    expect(queryClient.getQueryData(['my-bookings'])).toBeUndefined();
    expect(storage.saved.get(QUERY_CACHE_OWNER_KEY)).toBe('u1');
  });

  it('a storage that fails to read still empties the cache', async () => {
    const storage = { ...memoryStorage(), getItem: async () => Promise.reject(new Error('refused')) };
    await claimQueryCache(queryClient, 'u1', storage, persister);
    expect(queryClient.getQueryData(['my-bookings'])).toBeUndefined();
  });
});

describe('forgetQueryCache', () => {
  it('empties the cache and forgets its owner, even if removing the saved copy fails', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['notifications'], ['a notice']);
    const storage = memoryStorage();
    storage.saved.set(QUERY_CACHE_OWNER_KEY, 'u1');
    await forgetQueryCache(queryClient, storage, { removeClient: jest.fn(async () => Promise.reject(new Error('io'))) });
    expect(queryClient.getQueryData(['notifications'])).toBeUndefined();
    expect(storage.saved.has(QUERY_CACHE_OWNER_KEY)).toBe(false);
  });
});

describe('the web build', () => {
  it('keeps the saved screens in sessionStorage, which ends with the tab', async () => {
    const values = new Map<string, string>();
    const session = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => void values.set(k, v),
      removeItem: (k: string) => void values.delete(k),
    } as unknown as Storage;
    const storage = createWebSessionQueryStorage(() => session);
    await storage.setItem(QUERY_CACHE_KEY, '{"x":1}');
    expect(values.get(QUERY_CACHE_KEY)).toBe('{"x":1}');
    expect(await storage.getItem(QUERY_CACHE_KEY)).toBe('{"x":1}');
    await storage.removeItem(QUERY_CACHE_KEY);
    expect(await storage.getItem(QUERY_CACHE_KEY)).toBeNull();
  });

  it('keeps nothing, without failing, when sessionStorage is refused', async () => {
    const refused = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;
    const storage = createWebSessionQueryStorage(() => refused);
    await expect(storage.setItem('k', 'v')).resolves.toBeUndefined();
    await expect(storage.getItem('k')).resolves.toBeNull();
    await expect(storage.removeItem('k')).resolves.toBeUndefined();
  });

  it('removes a cache an older build left in localStorage, on the web only', async () => {
    AsyncStorage.removeItem.mockClear();
    await removeOldWebQueryCache('ios');
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    await removeOldWebQueryCache('web');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(QUERY_CACHE_KEY);
  });
});
