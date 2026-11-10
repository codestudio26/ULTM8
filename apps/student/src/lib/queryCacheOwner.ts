import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient } from '@tanstack/react-query';
import { asyncStoragePersister, QUERY_CACHE_KEY, queryCacheStorage, type QueryCacheStorage } from './queryPersister';

/** Whose saved screens are in the cache: the signed-in person's user id. */
export const QUERY_CACHE_OWNER_KEY = 'ultm8-student-query-cache-owner';

interface Persister {
  removeClient: () => PromiseLike<void> | void;
}

/**
 * Decision 451 item 5 (S-6) — the saved screens belong to one person. The
 * query keys (my-bookings, notifications, my-memberships…) aren't per person,
 * so the cache is keyed by its owner instead: when someone signs in (or the
 * app starts with a session) and the cache was saved for anyone else, or for
 * nobody known, it is emptied, in memory and on the device, before their
 * screens show. Signing in again as the same person keeps it.
 */
export async function claimQueryCache(
  queryClient: QueryClient,
  userId: string,
  storage: QueryCacheStorage = queryCacheStorage,
  persister: Persister = asyncStoragePersister,
): Promise<void> {
  let owner: string | null = null;
  try {
    owner = await storage.getItem(QUERY_CACHE_OWNER_KEY);
  } catch {
    owner = null;
  }
  if (owner === userId) return;
  queryClient.clear();
  await Promise.resolve(persister.removeClient()).catch(() => {});
  await storage.setItem(QUERY_CACHE_OWNER_KEY, userId).catch(() => {});
}

/**
 * Empties the saved screens, in memory and on the device, and forgets whose
 * they were: on sign-out, and when the app starts with no session (on the web,
 * a closed tab ends the session without a sign-out). Never throws: a failed
 * removal must not block signing out (the owner check above still applies at
 * the next sign-in).
 */
export async function forgetQueryCache(
  queryClient: QueryClient,
  storage: QueryCacheStorage = queryCacheStorage,
  persister: Persister = asyncStoragePersister,
): Promise<void> {
  queryClient.clear();
  await Promise.resolve(persister.removeClient()).catch(() => {});
  await storage.removeItem(QUERY_CACHE_OWNER_KEY).catch(() => {});
}

/** Web only: a cache an older build saved in localStorage (AsyncStorage on
 * the web) is removed; the web build now keeps it in sessionStorage. */
export async function removeOldWebQueryCache(os: string = Platform.OS): Promise<void> {
  if (os !== 'web') return;
  await AsyncStorage.removeItem(QUERY_CACHE_KEY).catch(() => {});
}
