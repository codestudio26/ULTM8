import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type MemberFile = components['schemas']['MemberFileDto'];

/** Backlog 5.11 (Decision 315 item 9): PDF, JPG and PNG, up to 10 MB each. */
export const MEMBER_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const MEMBER_FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

/** Whether the name is one the API accepts; the API also reads the content. */
export function hasMemberFileExtension(name: string): boolean {
  return /\.(pdf|jpe?g|png)$/i.test(name);
}

/** Files on a student, newest first. Owners and Branch Staff with "See and
 * manage member files" only. */
export function useMemberFiles(schoolId: string | null, studentId: string | null) {
  return useQuery({
    queryKey: ['memberFiles', schoolId, studentId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/students/{studentId}/files', { params: { path: { schoolId: schoolId!, studentId: studentId! } } })),
    enabled: !!schoolId && !!studentId,
    retry: false,
  });
}

export function useUploadMemberFile(schoolId: string, studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      unwrap(
        apiClient.POST('/v1/schools/{schoolId}/students/{studentId}/files', {
          params: { path: { schoolId, studentId } },
          body: { file: file as unknown as string },
          bodySerializer: () => {
            const form = new FormData();
            form.append('file', file, file.name);
            return form;
          },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['memberFiles', schoolId, studentId] }),
  });
}

/** A signed link that downloads the file for the next 5 minutes. */
export function useMemberFileDownload(schoolId: string, studentId: string) {
  return useMutation({
    mutationFn: (fileId: string) =>
      unwrap(apiClient.GET('/v1/schools/{schoolId}/students/{studentId}/files/{fileId}/download', { params: { path: { schoolId, studentId, fileId } } })),
  });
}

export function useDeleteMemberFile(schoolId: string, studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => unwrap(apiClient.DELETE('/v1/schools/{schoolId}/students/{studentId}/files/{fileId}', { params: { path: { schoolId, studentId, fileId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['memberFiles', schoolId, studentId] }),
  });
}
