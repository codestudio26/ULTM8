import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type MedicalInfoShared = components['schemas']['MedicalInfoSharedDto'];

/** Decision 419 item 1: the Schools holding medical information about a
 * member (oneself as an adult, or a Guardian's child), with when consent was
 * given. Never the text. */
export function useMedicalInfoShared(studentId: string | undefined) {
  return useQuery({
    queryKey: ['medical-info-shared', studentId],
    queryFn: () => unwrap(apiClient.GET('/v1/students/{studentId}/medical-info', { params: { path: { studentId: studentId! } } })),
    enabled: !!studentId,
    retry: false,
  });
}

/** Withdraws consent at one School: its copy is deleted at once. */
export function useWithdrawMedicalInfo(studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (schoolId: string) =>
      unwrap(apiClient.DELETE('/v1/schools/{schoolId}/students/{studentId}/medical-info', { params: { path: { schoolId, studentId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['medical-info-shared', studentId] }),
  });
}
