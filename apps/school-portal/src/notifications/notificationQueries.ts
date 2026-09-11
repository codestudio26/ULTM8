import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type NotificationResponse = components['schemas']['NotificationResponseDto'];

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
