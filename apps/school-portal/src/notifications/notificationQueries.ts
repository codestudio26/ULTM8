import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type NotificationResponse = components['schemas']['NotificationResponseDto'];
export type NotificationCountsResponse = components['schemas']['NotificationCountsResponseDto'];

/** The CALLER's own notification inbox — every authenticated User has one,
 * School staff included, so this is not School-scoped (no schoolId in the
 * route: GET /notifications/me). Deliberately doesn't touch the
 * device-tokens endpoints (POST/DELETE /notifications/device-tokens) — those
 * register a native push token, which has no meaning for a web portal (see
 * NotificationsController's own header comment: push dispatch is deferred
 * and this is the mobile-facing half of the module regardless). */
export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => unwrap(apiClient.GET('/v1/notifications/me', {})),
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(apiClient.PATCH('/v1/notifications/{id}/read', { params: { path: { id } } })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      // Marking a notification read changes the unread count — invalidate the
      // dedicated counts query too, not just the list, so NotificationsPage's
      // stat ribbon doesn't go stale after a mark-read.
      queryClient.invalidateQueries({ queryKey: ['notifications', 'counts'] });
    },
  });
}

/** v1.2 backend backlog ("Notifications page", Decision 204's Concept 5
 * finding) — a true, caller-wide total/unread count from a dedicated
 * endpoint (`GET /notifications/me/counts`), not derived from whatever page
 * of `useNotifications` happens to be loaded client-side. Same caller-only
 * scoping as `useNotifications` (no schoolId in the route). */
export function useNotificationCounts() {
  return useQuery({
    queryKey: ['notifications', 'counts'],
    queryFn: () => unwrap(apiClient.GET('/v1/notifications/me/counts', {})),
  });
}
