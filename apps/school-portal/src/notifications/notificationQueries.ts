import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type NotificationResponse = components['schemas']['NotificationResponseDto'];
export type NotificationCountsResponse = components['schemas']['NotificationCountsResponseDto'];
export type SnoozeNotificationInput = components['schemas']['SnoozeNotificationDto'];
export type BroadcastNotificationInput = components['schemas']['BroadcastNotificationDto'];
export type BroadcastResponse = components['schemas']['BroadcastResponseDto'];

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
 * scoping as `useNotifications` (no schoolId in the route). Also now carries
 * the Read-within-24h metric (v1.2 backend backlog, approved by the product
 * owner) — see NotificationCountsResponseDto's own header comment. */
export function useNotificationCounts() {
  return useQuery({
    queryKey: ['notifications', 'counts'],
    queryFn: () => unwrap(apiClient.GET('/v1/notifications/me/counts', {})),
  });
}

/** v1.2 backend backlog ("Notifications page" — Snooze, approved by the
 * product owner). Same self-only scoping as useMarkNotificationRead — both
 * invalidate the list AND the counts query (a Snooze changes the unread
 * total exactly like a mark-read does, see
 * NotificationsService.getCountsForCaller's own header comment). */
export function useSnoozeNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SnoozeNotificationInput }) =>
      unwrap(apiClient.PATCH('/v1/notifications/{id}/snooze', { params: { path: { id } }, body })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'counts'] });
    },
  });
}

/** Decision 274 — Delete hides one Notification (a soft delete on the API;
 * the record is kept). Same self-only scoping and list + counts invalidation
 * as useMarkNotificationRead. */
export function useDeleteNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(apiClient.DELETE('/v1/notifications/{id}', { params: { path: { id } } })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'counts'] });
    },
  });
}

/** Decision 274 — "Clear all read": hides every read Notification the caller
 * has, across every page, not just the rows loaded here. */
export function useClearReadNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(apiClient.POST('/v1/notifications/me/clear-read', {})),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'counts'] });
    },
  });
}

/** v1.2 backend backlog ("Notifications page" — Broadcast/compose, approved
 * by the product owner). School-Owner-gated on the backend
 * (NotificationBroadcastService.broadcast) — `schoolId` here is
 * NotificationsPage's own `useOwnedSchoolId()`, same convention
 * WaiversPage/MembershipPlansPage already use for an Owner-only write. No
 * query to invalidate on success — a broadcast fans out to OTHER Students'
 * own inboxes, never the calling Staff member's own `GET /notifications/me`. */
export function useBroadcastNotification(schoolId: string) {
  return useMutation({
    mutationFn: (body: BroadcastNotificationInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/notifications/broadcast', { params: { path: { schoolId } }, body })),
  });
}
