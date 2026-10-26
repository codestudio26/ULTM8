import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type TimetableSlotResponse = components['schemas']['TimetableSlotResponseDto'];
export type CreateTimetableSlotInput = components['schemas']['CreateTimetableSlotDto'];
export type UpdateTimetableSlotInput = components['schemas']['UpdateTimetableSlotDto'];
export type UpcomingImpactResponse = components['schemas']['UpcomingImpactResponseDto'];
/** GET /timetable/:id/occurrence's response — the materialized Class, field-for-field
 * (see TimetableService.findOccurrence's own comment for why this reuses
 * ClassResponseDto rather than a new, narrower DTO). */
export type TimetableOccurrenceResponse = components['schemas']['ClassResponseDto'];

/** No pagination in this UI yet — same established convention as
 * useBranches/useDisciplines/useInstructors/useClasses (see their own header
 * comments). Decision 226 — always fetches `includeArchived: true`, same
 * "fetch everything, filter/toggle client-side" convention useBranches
 * already established, so TimetablePage can show an accurate count and let
 * the caller toggle archived slots' visibility without a second request. */
export function useTimetableSlots(schoolId: string | null) {
  return useQuery({
    queryKey: ['timetable', schoolId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/schools/{schoolId}/timetable', { params: { path: { schoolId: schoolId! }, query: { includeArchived: true } } })),
    enabled: !!schoolId,
  });
}

export function useCreateTimetableSlot(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTimetableSlotInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/timetable', { params: { path: { schoolId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['timetable', schoolId] }),
  });
}

export function useUpdateTimetableSlot(schoolId: string, slotId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateTimetableSlotInput) =>
      unwrap(apiClient.PATCH('/v1/timetable/{id}', { params: { path: { id: slotId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['timetable', schoolId] }),
  });
}

/** Decision 322 — upcoming Classes from a slot and how many have bookings, read
 * just before saving an edit that moves them, so it's fetched on demand rather
 * than kept as a query. */
export function fetchUpcomingImpact(slotId: string): Promise<UpcomingImpactResponse> {
  return unwrap(apiClient.GET('/v1/timetable/{id}/upcoming-impact', { params: { path: { id: slotId } } }));
}

/** Decision 226 — School Owner/Manager only, idempotent, blocked (409) by an
 * upcoming Booking against a generated Class. */
export function useArchiveTimetableSlot(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slotId: string) => unwrap(apiClient.POST('/v1/timetable/{id}/archive', { params: { path: { id: slotId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['timetable', schoolId] }),
  });
}

export function useUnarchiveTimetableSlot(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slotId: string) => unwrap(apiClient.POST('/v1/timetable/{id}/unarchive', { params: { path: { id: slotId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['timetable', schoolId] }),
  });
}

/**
 * Timetable page redesign (click-to-book) — GET /timetable/:id/occurrence?date=,
 * resolving one specific weekday occurrence of a recurring slot to its
 * materialized, bookable `Class` (TimetableService.findOccurrence's own header
 * comment has the full SKILL.md §9 account). `enabled` only while the booking
 * dialog is actually open for a slot+date — this is a point lookup triggered by a
 * click, not a list this page loads eagerly.
 *
 * A 404 here (`ApiError.status === 404`) is an EXPECTED, disclosed outcome — no
 * Class has been generated yet for that date (beyond the 4-week horizon, or the
 * job hasn't run) — not a fetch failure. The caller (TimetableBookingDialog)
 * checks `error.status === 404` itself to render the "not bookable yet" state
 * rather than a generic ErrorBanner; react-query's own `retry` is disabled so a
 * genuine 404 doesn't retry 3 times before settling.
 */
export function useTimetableOccurrence(slotId: string | null, date: string | null) {
  return useQuery({
    queryKey: ['timetableOccurrence', slotId, date],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/timetable/{id}/occurrence', { params: { path: { id: slotId! }, query: { date: date! } } })),
    enabled: !!slotId && !!date,
    retry: false,
  });
}
