import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type TimetableSlotResponse = components['schemas']['TimetableSlotResponseDto'];
export type CreateTimetableSlotInput = components['schemas']['CreateTimetableSlotDto'];
export type UpdateTimetableSlotInput = components['schemas']['UpdateTimetableSlotDto'];

/** No pagination in this UI yet — same established convention as
 * useBranches/useDisciplines/useInstructors/useClasses (see their own header
 * comments). */
export function useTimetableSlots(schoolId: string | null) {
  return useQuery({
    queryKey: ['timetable', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/timetable', { params: { path: { schoolId: schoolId! } } })),
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
