import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type SchoolTag = components['schemas']['SchoolTagDto'];
export type StudentTag = components['schemas']['StudentTagDto'];

/** Tags on students (backlog 5.4, Decision 315 item 7). Staff only. */
export function useSchoolTags(schoolId: string | null) {
  return useQuery({
    queryKey: ['schoolTags', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/student-tags', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
    retry: false,
  });
}

/** The students with a tag (the Students list's tag filter). */
export function useTaggedStudents(schoolId: string | null, tagId: string | null) {
  return useQuery({
    queryKey: ['taggedStudents', schoolId, tagId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/student-tags/{tagId}/students', { params: { path: { schoolId: schoolId!, tagId: tagId! } } })),
    enabled: !!schoolId && !!tagId,
    retry: false,
  });
}

export function useStudentTags(schoolId: string | null, studentId: string | null) {
  return useQuery({
    queryKey: ['studentTags', schoolId, studentId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/students/{studentId}/tags', { params: { path: { schoolId: schoolId!, studentId: studentId! } } })),
    enabled: !!schoolId && !!studentId,
    retry: false,
  });
}

/** Any change to tags can change every tag query of the School. */
function useInvalidateTags(schoolId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['schoolTags', schoolId] }),
      queryClient.invalidateQueries({ queryKey: ['studentTags', schoolId] }),
      queryClient.invalidateQueries({ queryKey: ['taggedStudents', schoolId] }),
    ]);
}

/** Tag a student with a tag from the list (`tagId`) or a new one (`name`). */
export function useAddStudentTag(schoolId: string, studentId: string) {
  const invalidate = useInvalidateTags(schoolId);
  return useMutation({
    mutationFn: (body: { tagId: string } | { name: string }) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/students/{studentId}/tags', { params: { path: { schoolId, studentId } }, body })),
    onSuccess: invalidate,
  });
}

export function useRemoveStudentTag(schoolId: string, studentId: string) {
  const invalidate = useInvalidateTags(schoolId);
  return useMutation({
    mutationFn: (tagId: string) => unwrap(apiClient.DELETE('/v1/schools/{schoolId}/students/{studentId}/tags/{tagId}', { params: { path: { schoolId, studentId, tagId } } })),
    onSuccess: invalidate,
  });
}

export function useCreateSchoolTag(schoolId: string) {
  const invalidate = useInvalidateTags(schoolId);
  return useMutation({
    mutationFn: (name: string) => unwrap(apiClient.POST('/v1/schools/{schoolId}/student-tags', { params: { path: { schoolId } }, body: { name } })),
    onSuccess: invalidate,
  });
}

export function useRenameSchoolTag(schoolId: string) {
  const invalidate = useInvalidateTags(schoolId);
  return useMutation({
    mutationFn: ({ tagId, name }: { tagId: string; name: string }) =>
      unwrap(apiClient.PATCH('/v1/schools/{schoolId}/student-tags/{tagId}', { params: { path: { schoolId, tagId } }, body: { name } })),
    onSuccess: invalidate,
  });
}

export function useDeleteSchoolTag(schoolId: string) {
  const invalidate = useInvalidateTags(schoolId);
  return useMutation({
    mutationFn: (tagId: string) => unwrap(apiClient.DELETE('/v1/schools/{schoolId}/student-tags/{tagId}', { params: { path: { schoolId, tagId } } })),
    onSuccess: invalidate,
  });
}
