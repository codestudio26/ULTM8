import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

/** The whole inbox for NotificationsPage, one page at a time ("Load more").
 * `useNotifications` above stays the newest page only, for the short previews
 * elsewhere. Same `['notifications']` prefix, so every mutation below that
 * invalidates `['notifications']` refreshes every loaded page too. */
export function useNotificationPages() {
  return useInfiniteQuery({
    queryKey: ['notifications', 'pages'],
    queryFn: ({ pageParam }) =>
      unwrap(apiClient.GET('/v1/notifications/me', { params: { query: { cursor: pageParam ?? undefined } } })),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? null,
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

/** Decision 355 — "Mark all read": every unread notification the caller has,
 * on every page. Same list + counts invalidation as useMarkNotificationRead. */
export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(apiClient.POST('/v1/notifications/me/read-all', {})),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'counts'] });
    },
  });
}

/** Decision 355 — the portal page a notification opens when clicked, or null
 * when it has nothing to open. */
export function notificationLink(n: Pick<NotificationResponse, 'targetType' | 'targetId'>): string | null {
  switch (n.targetType) {
    case 'CLASS':
      return n.targetId ? `/classes/${n.targetId}` : null;
    case 'WAIVER':
      return '/waivers';
    case 'PAYMENT':
      return '/transactions';
    case 'CANCELLATIONS':
      return '/cancellations';
    case 'GRADING':
      return '/grading';
    default:
      return null;
  }
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

/** Decision 277 — Delete hides one Notification (a soft delete on the API;
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

/** Decision 277 — "Clear all read": hides every read Notification the caller
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

const BROADCAST_CLASS_WINDOW_DAYS = 30;
const BROADCAST_CLASS_PAGE_LIMIT = 10;

/** The "One class" picker in BroadcastNotificationModal: live (not archived)
 * Classes starting from now to 30 days ahead, soonest first. The Classes list
 * endpoint pages in id order, so this walks its pages (up to 10 × 100) and
 * sorts here — a plain `useClasses` call returned only its first 20 rows, in
 * an order that meant nothing to the person picking. */
export function useUpcomingClassesForBroadcast(schoolId: string | null) {
  return useQuery({
    queryKey: ['classes', schoolId, 'broadcast-upcoming'],
    enabled: !!schoolId,
    queryFn: async () => {
      const startsFrom = new Date();
      const startsTo = new Date(startsFrom.getTime() + BROADCAST_CLASS_WINDOW_DAYS * 86_400_000);
      const items: components['schemas']['ClassResponseDto'][] = [];
      let cursor: string | undefined;
      for (let page = 0; page < BROADCAST_CLASS_PAGE_LIMIT; page++) {
        const res = await unwrap(
          apiClient.GET('/v1/schools/{schoolId}/classes', {
            params: {
              path: { schoolId: schoolId! },
              query: { startsFrom: startsFrom.toISOString(), startsTo: startsTo.toISOString(), limit: 100, cursor },
            },
          }),
        );
        items.push(...res.items);
        if (!res.nextCursor) break;
        cursor = res.nextCursor;
      }
      return items.sort((a, b) => a.startDate.localeCompare(b.startDate));
    },
  });
}
