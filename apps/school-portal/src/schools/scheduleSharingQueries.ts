import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiBaseUrl, apiClient } from '../api';

export type ScheduleSharingSettings = components['schemas']['ScheduleSharingSettingsDto'];
export type UpdateScheduleSharingInput = components['schemas']['UpdateScheduleSharingDto'];
export type MyCalendarFeed = components['schemas']['MyCalendarFeedDto'];

/** Decision 319 item 4: the School's staff calendar links and schedule embed settings (owner only). */
export function useScheduleSharing(schoolId: string) {
  return useQuery({
    queryKey: ['scheduleSharing', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/schedule-sharing', { params: { path: { schoolId } } })),
  });
}

export function useUpdateScheduleSharing(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateScheduleSharingInput) =>
      unwrap(apiClient.PUT('/v1/schools/{schoolId}/schedule-sharing', { params: { path: { schoolId } }, body })),
    onSuccess: (data) => {
      queryClient.setQueryData(['scheduleSharing', schoolId], data);
      return queryClient.invalidateQueries({ queryKey: ['myCalendarFeed', schoolId] });
    },
  });
}

/** Decision 319 item 4: the signed-in staff member's own calendar link at a School. */
export function useMyCalendarFeed(schoolId: string | null) {
  return useQuery({
    queryKey: ['myCalendarFeed', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/calendar-feed/me', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

export function useCreateMyCalendarFeed(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(apiClient.POST('/v1/schools/{schoolId}/calendar-feed/me', { params: { path: { schoolId } } })),
    onSuccess: (data) => queryClient.setQueryData(['myCalendarFeed', schoolId], data),
  });
}

export function useDeleteMyCalendarFeed(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(apiClient.DELETE('/v1/schools/{schoolId}/calendar-feed/me', { params: { path: { schoolId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['myCalendarFeed', schoolId] }),
  });
}

/** The calendar link a staff member adds to Google Calendar ("From URL"). */
export function calendarFeedUrl(token: string): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}/v1/calendar-feeds/${token}.ics`;
}

/** The embed page's address, in one of the apps' languages. */
export function scheduleEmbedUrl(key: string, locale: string): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}/v1/schedule-embeds/${key}/page?lang=${encodeURIComponent(locale)}`;
}

/** The snippet the School pastes into its own web page. */
export function scheduleEmbedSnippet(key: string, locale: string, title: string): string {
  const escaped = title.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<iframe src="${scheduleEmbedUrl(key, locale)}" title="${escaped}" width="100%" height="600" style="border:0" loading="lazy"></iframe>`;
}
