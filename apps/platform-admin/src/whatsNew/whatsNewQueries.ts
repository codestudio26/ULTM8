import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type ProductUpdate = components['schemas']['ProductUpdateAdminDto'];
export type WriteProductUpdate = components['schemas']['WriteProductUpdateDto'];

const KEY = ['whats-new-posts'];

/** GET /platform-admin/whats-new (Decision 318 item 3) — any admin. */
export function useWhatsNewPosts() {
  return useQuery({ queryKey: KEY, queryFn: () => unwrap(apiClient.GET('/v1/platform-admin/whats-new')) });
}

/** POST / PATCH — a Full Admin, server-side; audit-logged. */
export function useSaveWhatsNewPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: WriteProductUpdate }) =>
      id
        ? unwrap(apiClient.PATCH('/v1/platform-admin/whats-new/{id}', { params: { path: { id } }, body }))
        : unwrap(apiClient.POST('/v1/platform-admin/whats-new', { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

/** DELETE — a Full Admin, server-side; audit-logged. */
export function useDeleteWhatsNewPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(apiClient.DELETE('/v1/platform-admin/whats-new/{id}', { params: { path: { id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
