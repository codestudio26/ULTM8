import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type CustomMemberField = components['schemas']['CustomMemberFieldDto'];
export type CustomMemberFieldType = components['schemas']['CustomMemberFieldType'];
export type CustomMemberStatus = components['schemas']['CustomMemberStatusDto'];
export type StudentCustomFields = components['schemas']['StudentCustomFieldsDto'];

export const CUSTOM_FIELD_TYPES: CustomMemberFieldType[] = ['TEXT', 'NUMBER', 'DATE', 'DROPDOWN', 'YES_NO'];
/** Same limits as the API (Decision 315 item 14: statuses up to 50 characters). */
export const CUSTOM_NAME_MAX = 50;
export const CUSTOM_TEXT_VALUE_MAX = 500;

/** Custom member fields and statuses (Decision 315 item 14). Staff only. */
export function useCustomMemberFields(schoolId: string | null) {
  return useQuery({
    queryKey: ['customMemberFields', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/custom-member-fields', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
    retry: false,
  });
}

export function useCustomMemberStatuses(schoolId: string | null) {
  return useQuery({
    queryKey: ['customMemberStatuses', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/custom-member-statuses', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
    retry: false,
  });
}

/** Each covered student's status (the Students list's filter and column). */
export function useCustomStatusAssignments(schoolId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['customStatusAssignments', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/custom-member-statuses/students', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId && enabled,
    retry: false,
  });
}

export function useStudentCustomFields(schoolId: string | null, studentId: string | null) {
  return useQuery({
    queryKey: ['studentCustomFields', schoolId, studentId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/students/{studentId}/custom-fields', { params: { path: { schoolId: schoolId!, studentId: studentId! } } })),
    enabled: !!schoolId && !!studentId,
    retry: false,
  });
}

/** Any change can change every custom-field query of the School. */
function useInvalidate(schoolId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      ['customMemberFields', 'customMemberStatuses', 'customStatusAssignments', 'studentCustomFields'].map((key) => queryClient.invalidateQueries({ queryKey: [key, schoolId] })),
    );
}

export function useCreateCustomField(schoolId: string) {
  const invalidate = useInvalidate(schoolId);
  return useMutation({
    mutationFn: (body: { name: string; type: CustomMemberFieldType; options?: string[] }) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/custom-member-fields', { params: { path: { schoolId } }, body })),
    onSuccess: invalidate,
  });
}

export function useUpdateCustomField(schoolId: string) {
  const invalidate = useInvalidate(schoolId);
  return useMutation({
    mutationFn: ({ fieldId, ...body }: { fieldId: string; name?: string; options?: string[] }) =>
      unwrap(apiClient.PATCH('/v1/schools/{schoolId}/custom-member-fields/{fieldId}', { params: { path: { schoolId, fieldId } }, body })),
    onSuccess: invalidate,
  });
}

export function useDeleteCustomField(schoolId: string) {
  const invalidate = useInvalidate(schoolId);
  return useMutation({
    mutationFn: (fieldId: string) => unwrap(apiClient.DELETE('/v1/schools/{schoolId}/custom-member-fields/{fieldId}', { params: { path: { schoolId, fieldId } } })),
    onSuccess: invalidate,
  });
}

export function useReorderCustomFields(schoolId: string) {
  const invalidate = useInvalidate(schoolId);
  return useMutation({
    mutationFn: (fieldIds: string[]) => unwrap(apiClient.PUT('/v1/schools/{schoolId}/custom-member-fields/order', { params: { path: { schoolId } }, body: { fieldIds } })),
    onSuccess: invalidate,
  });
}

export function useCreateCustomStatus(schoolId: string) {
  const invalidate = useInvalidate(schoolId);
  return useMutation({
    mutationFn: (name: string) => unwrap(apiClient.POST('/v1/schools/{schoolId}/custom-member-statuses', { params: { path: { schoolId } }, body: { name } })),
    onSuccess: invalidate,
  });
}

export function useRenameCustomStatus(schoolId: string) {
  const invalidate = useInvalidate(schoolId);
  return useMutation({
    mutationFn: ({ statusId, name }: { statusId: string; name: string }) =>
      unwrap(apiClient.PATCH('/v1/schools/{schoolId}/custom-member-statuses/{statusId}', { params: { path: { schoolId, statusId } }, body: { name } })),
    onSuccess: invalidate,
  });
}

export function useDeleteCustomStatus(schoolId: string) {
  const invalidate = useInvalidate(schoolId);
  return useMutation({
    mutationFn: (statusId: string) => unwrap(apiClient.DELETE('/v1/schools/{schoolId}/custom-member-statuses/{statusId}', { params: { path: { schoolId, statusId } } })),
    onSuccess: invalidate,
  });
}

export function useSetStudentCustomFields(schoolId: string, studentId: string) {
  const invalidate = useInvalidate(schoolId);
  return useMutation({
    mutationFn: (values: Array<{ fieldId: string; value: string | null }>) =>
      unwrap(apiClient.PUT('/v1/schools/{schoolId}/students/{studentId}/custom-fields', { params: { path: { schoolId, studentId } }, body: { values } })),
    onSuccess: invalidate,
  });
}

export function useSetStudentCustomStatus(schoolId: string, studentId: string) {
  const invalidate = useInvalidate(schoolId);
  return useMutation({
    mutationFn: (statusId: string | null) =>
      unwrap(apiClient.PUT('/v1/schools/{schoolId}/students/{studentId}/custom-status', { params: { path: { schoolId, studentId } }, body: { statusId } })),
    onSuccess: invalidate,
  });
}
