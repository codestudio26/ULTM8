import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type SignUp = components['schemas']['SignUpDto'];
export type SignUpView = 'WAITING' | 'REJECTED' | 'DONE';
export type ApproveSignUpResult = components['schemas']['ApproveSignUpResultDto'];

/** Decision 392: sign-ups from the front-desk tablet the caller may decide on. */
export function useSignUps(schoolId: string | null, view: SignUpView, enabled = true) {
  return useQuery({
    queryKey: ['sign-ups', schoolId, view],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/sign-ups', { params: { path: { schoolId: schoolId! }, query: { view } } })),
    enabled: !!schoolId && enabled,
  });
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>, schoolId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['sign-ups', schoolId] }),
    queryClient.invalidateQueries({ queryKey: ['students', schoolId] }),
  ]);
}

export function useApproveSignUp(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, branchId }: { id: string; branchId?: string }) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/sign-ups/{id}/approve', { params: { path: { schoolId, id } }, body: branchId ? { branchId } : {} })),
    onSuccess: () => invalidate(queryClient, schoolId),
  });
}

export function useRejectSignUp(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(apiClient.POST('/v1/schools/{schoolId}/sign-ups/{id}/reject', { params: { path: { schoolId, id } } })),
    onSuccess: () => invalidate(queryClient, schoolId),
  });
}
