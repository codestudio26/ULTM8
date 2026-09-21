import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { AuthProvider } from './src/auth/AuthContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { asyncStoragePersister, MAX_CACHED_QUERY_AGE_MS, PERSISTED_QUERY_KEY_PREFIXES } from './src/lib/queryPersister';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** Light read-only offline caching (Phase 7, docs/TRACK-B-ROADMAP.md's Version
 * 1 Plan) — previously-loaded screens stay viewable with no connection,
 * including across an app restart, not just mid-session. `maxAge` bounds how
 * long a restored cache is trusted before being discarded outright, rather
 * than shown indefinitely as if it were fresh. `asyncStoragePersister` lives
 * in src/lib/queryPersister.ts, not here — see AuthContext.tsx's logout(),
 * which explicitly clears it too.
 *
 * `shouldDehydrateQuery` below is an ALLOWLIST (PERSISTED_QUERY_KEY_PREFIXES),
 * not react-query's bare default — FOUND ON REVIEW: the default persists
 * every successful query indiscriminately, which included Waiver signature
 * text and a Guardian's linked-minor PII/consent status before this was
 * added. See queryPersister.ts's own comment for the full reasoning; the
 * `query.state.status === 'success'` half mirrors react-query's own
 * `defaultShouldDehydrateQuery` (reimplemented inline rather than adding
 * @tanstack/query-core as a direct dependency for one line). Mutations are
 * still excluded by react-query's own separate default regardless of this
 * option, so there's no offline-write/sync/conflict-resolution surface
 * introduced here, matching this phase's deliberately narrow scope. */

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: asyncStoragePersister,
            maxAge: MAX_CACHED_QUERY_AGE_MS,
            dehydrateOptions: {
              shouldDehydrateQuery: (query) =>
                query.state.status === 'success' && PERSISTED_QUERY_KEY_PREFIXES.includes(String(query.queryKey[0])),
            },
          }}
        >
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </PersistQueryClientProvider>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
