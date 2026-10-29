import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type StudentNote = components['schemas']['StudentNoteDto'];

/** Staff notes on a student (backlog 3.10, Decision 400), newest first. */
export function useStudentNotes(schoolId: string | null, studentId: string | null) {
  return useQuery({
    queryKey: ['studentNotes', schoolId, studentId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/students/{studentId}/notes', { params: { path: { schoolId: schoolId!, studentId: studentId! } } })),
    enabled: !!schoolId && !!studentId,
    retry: false,
  });
}

export function useAddStudentNote(schoolId: string, studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { body: string; showToMember: boolean }) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/students/{studentId}/notes', { params: { path: { schoolId, studentId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['studentNotes', schoolId, studentId] }),
  });
}

export function useEditStudentNote(schoolId: string, studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, ...body }: { noteId: string; body?: string; showToMember?: boolean }) =>
      unwrap(apiClient.PATCH('/v1/schools/{schoolId}/students/{studentId}/notes/{noteId}', { params: { path: { schoolId, studentId, noteId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['studentNotes', schoolId, studentId] }),
  });
}

export function useDeleteStudentNote(schoolId: string, studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => unwrap(apiClient.DELETE('/v1/schools/{schoolId}/students/{studentId}/notes/{noteId}', { params: { path: { schoolId, studentId, noteId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['studentNotes', schoolId, studentId] }),
  });
}
