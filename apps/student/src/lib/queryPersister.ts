import { Platform } from 'react-native';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Where the saved screens are kept. */
export const QUERY_CACHE_KEY = 'ultm8-student-query-cache';

export interface QueryCacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Web only: the browser's sessionStorage, where the web build keeps its
 * tokens (secureTokenStore's createWebSessionTokenStore). Decision 451 item 5
 * (S-6): the saved screens (bookings, notifications, memberships) used to sit
 * in localStorage (AsyncStorage on web) for 24 hours, after the tab-scoped
 * session had ended; now they end with the tab like the session does. A
 * storage that is missing or refused just keeps nothing. Exported for its
 * tests. */
export function createWebSessionQueryStorage(
  storage: () => Storage | undefined = () => (typeof window === 'undefined' ? undefined : window.sessionStorage),
): QueryCacheStorage {
  return {
    async getItem(key) {
      try {
        return storage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    async setItem(key, value) {
      try {
        storage()?.setItem(key, value);
      } catch {
        /* noop — nothing saved */
      }
    },
    async removeItem(key) {
      try {
        storage()?.removeItem(key);
      } catch {
        /* noop */
      }
    },
  };
}

/** iOS/Android: AsyncStorage, as before. Web: the tab's sessionStorage. */
export const queryCacheStorage: QueryCacheStorage = Platform.OS === 'web' ? createWebSessionQueryStorage() : AsyncStorage;

/** Shared between App.tsx (wires it into PersistQueryClientProvider) and
 * AuthContext.tsx (explicitly clears it on logout). Defined here, not in
 * App.tsx, since AuthContext can't import from the app root without a
 * circular dependency. */
export const asyncStoragePersister = createAsyncStoragePersister({
  storage: queryCacheStorage,
  key: QUERY_CACHE_KEY,
  // FOUND ON REVIEW: the default (1000ms) only throttles the AsyncStorage
  // write itself — the full-cache dehydrate walk that triggers it runs
  // unthrottled on every cache event (fetch start/success/error/invalidate).
  // Several invalidating mutations across bookings/memberships could
  // otherwise write in a tight burst. Set explicitly higher since the 24h
  // maxAge below already makes a few extra seconds of staleness before a
  // snapshot lands inconsequential.
  throttleTime: 1000 * 10,
});

export const MAX_CACHED_QUERY_AGE_MS = 1000 * 60 * 60 * 24; // 24 hours

/** Query key prefixes safe to persist to unencrypted on-device storage — an
 * explicit allowlist, not an opt-out, per docs/TRACK-B-ROADMAP.md's Phase 7
 * scope ("previously-loaded screens (bookings, timetable, ranks)").
 *
 * FOUND ON REVIEW: the first version persisted every query indiscriminately,
 * including `my-waiver-signatures` (a Student's actual typed legal signature)
 * and `my-minors`/`my-consent-records` (a linked minor's name, date of birth,
 * and camera-consent status) — sensitive data this codebase already treats
 * differently elsewhere (the access token itself lives in expo-secure-store,
 * never AsyncStorage, specifically because AsyncStorage is plain, unencrypted
 * storage — see secureTokenStore.ts's own header comment). Waiver and
 * Guardian query keys are deliberately left off this list — not persisted
 * and cleaned up later, never written to disk at all. */
export const PERSISTED_QUERY_KEY_PREFIXES = [
  'academies',
  'academy',
  'academy-timetable',
  'my-bookings',
  'notifications',
  'student-ranks',
  'disciplines',
  'rank',
  'my-memberships',
];
