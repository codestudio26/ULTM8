import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type TranslationResponse = components['schemas']['TranslationResponseDto'];
export type CreateTranslationInput = components['schemas']['CreateTranslationDto'];
export type UpdateTranslationInput = components['schemas']['UpdateTranslationDto'];

export interface TranslationsFilter {
  screen?: string;
  locale?: string;
}

/** GET /translations — Phase 49's public, unauthenticated list endpoint, reused
 * directly here rather than a separate admin-only list (PlatformAdminTranslationsController
 * deliberately has none — see that controller's own header comment). Cursor-based
 * (Decision 22/70); TranslationsPage owns accumulating pages into one list, since a
 * query's own cache entry is keyed on (filters, cursor) and only holds a single page. */
export function useTranslations(filter: TranslationsFilter, cursor: string | null) {
  return useQuery({
    queryKey: ['translations', filter.screen ?? null, filter.locale ?? null, cursor],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/translations', {
          params: { query: { screen: filter.screen, locale: filter.locale, cursor: cursor ?? undefined } },
        }),
      ),
  });
}

export function useCreateTranslation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTranslationInput) => unwrap(apiClient.POST('/v1/platform-admin/translations', { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['translations'] }),
  });
}

export function useUpdateTranslation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTranslationInput }) =>
      unwrap(apiClient.PATCH('/v1/platform-admin/translations/{id}', { params: { path: { id } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['translations'] }),
  });
}

/** Server-side FULL_ADMIN-only, same as create/update — see
 * PlatformAdminTranslationsController's own header comment. The 409 duplicate-triple
 * guard on create/update has no delete-side analogue (removing a row can't collide
 * with anything), so this mutation has nothing extra to surface beyond ApiError. */
export function useDeleteTranslation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(apiClient.DELETE('/v1/platform-admin/translations/{id}', { params: { path: { id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['translations'] }),
  });
}
