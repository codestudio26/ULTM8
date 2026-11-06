import { useMutation, useQuery } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type AccountDeletionState = components['schemas']['AccountDeletionStateDto'];

/** "Delete my account": what deleting would do — the children deleted with
 * the account, those who keep theirs, and any School or Franchise the member
 * must hand over or close first. */
export function useAccountDeletionPreview() {
  return useQuery({
    queryKey: ['account-deletion'],
    queryFn: () => unwrap(apiClient.GET('/v1/users/me/deletion')),
    retry: false,
  });
}

/** Asks for the deletion, with the step-up proof from StepUpPrompt (sent as
 * the `X-Step-Up-Token` header). The account is locked straight away, so
 * nothing is refetched afterwards: the screen shows the outcome, then signs
 * out. */
export function useRequestAccountDeletion() {
  return useMutation({
    mutationFn: (stepUpToken: string) =>
      unwrap(apiClient.POST('/v1/users/me/deletion', { params: { header: { 'x-step-up-token': stepUpToken } } })),
  });
}
