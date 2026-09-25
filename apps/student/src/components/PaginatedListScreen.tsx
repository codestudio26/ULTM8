import React, { ReactElement } from 'react';
import { ActivityIndicator, FlatList, Text } from 'react-native';
import { ErrorBanner, Screen } from './ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';

/** Structural, not `UseInfiniteQueryResult` itself — every list screen's query hook
 * already satisfies this shape, and keeping it structural means this file doesn't
 * need to import react-query's generics just to describe what it actually reads. */
interface InfiniteListQuery<T> {
  data?: { pages: { items: T[] }[] };
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  fetchNextPage: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage: boolean;
}

/** The loading/error/infinite-scroll shell shared by every cursor-paginated list
 * screen in this app (Academies, My Bookings, Notifications, My Memberships) —
 * extracted after the 4th occurrence of the identical isLoading/isError/FlatList
 * block (Track B Slice 4a review flagged this as due). Takes the raw query-hook
 * result directly rather than its fields unpacked into separate props — found on
 * review: threading isLoading/isError/error/fetchNextPage/hasNextPage/
 * isFetchingNextPage through individually just re-lists react-query's own result
 * shape at every call site for no benefit.
 *
 * FOUND ON REVIEW: a background fetchNextPage() failure (e.g. a transient network
 * error while scrolling) sets isError even though `data` still holds every
 * already-loaded page — checking isError unconditionally would wipe the Student's
 * whole scrolled list behind a bare error banner. Only shown full-screen when
 * there's nothing else to show (`items.length === 0`); otherwise the failure just
 * quietly stops offering more pages, same as the footer spinner disappearing. */
export function PaginatedListScreen<T extends { id: string }>({
  query,
  renderItem,
  emptyMessage,
  errorFallbackMessage,
  keyExtractor = (item) => item.id,
}: {
  query: InfiniteListQuery<T>;
  renderItem: (item: T) => ReactElement;
  emptyMessage: string;
  errorFallbackMessage: string;
  keyExtractor?: (item: T) => string;
}) {
  if (query.isLoading) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  if (query.isError && items.length === 0) {
    return (
      <Screen>
        <ErrorBanner message={getApiErrorMessage(query.error, errorFallbackMessage)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={keyExtractor}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator /> : null}
        ListEmptyComponent={<Text style={{ color: '#5F6368' }}>{emptyMessage}</Text>}
        renderItem={({ item }) => renderItem(item)}
      />
    </Screen>
  );
}
