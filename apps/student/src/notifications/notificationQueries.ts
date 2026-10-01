import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';
import { usePaginatedQuery } from '../lib/usePaginatedQuery';

type NotificationList = components['schemas']['NotificationListResponseDto'];

/** GET /notifications/me — read-side only (Phase 15 scope). The `type` field on
 * NotificationResponseDto is explicitly "not spec-confirmed" (see the generated
 * type's own comment) — deliberately not used for any icon/categorization UI here,
 * only title/body/createdAt/read are rendered. Cursor-paginated, same convention as
 * every other list endpoint (Decision 22/70), even though the cursor's own internal
 * shape is a (createdAt, id) keyset rather than a bare id (apps/api's
 * NotificationsService header comment) — opaque to this client either way. */
export function useNotifications() {
  return usePaginatedQuery<NotificationList>(['notifications'], (cursor) =>
    unwrap(apiClient.GET('/v1/notifications/me', { params: { query: { cursor } } })),
  );
}

/** Patches the one changed item directly in the cached pages rather than
 * invalidating (and refetching) the whole `['notifications']` infinite query —
 * found on review: `notifications` is this app's first cursor-paginated list a
 * single-item mutation targets, and a full invalidate would refetch every
 * already-loaded page just to flip one boolean the response itself already tells us. */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) =>
      unwrap(apiClient.PATCH('/v1/notifications/{id}/read', { params: { path: { id: notificationId } } })),
    onSuccess: (updated) => {
      queryClient.setQueryData<InfiniteData<NotificationList>>(['notifications'], (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          pages: prev.pages.map((page) => ({
            ...page,
            items: page.items.map((item) => (item.id === updated.id ? updated : item)),
          })),
        };
      });
    },
  });
}
