import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type IncomeCategory = components['schemas']['IncomeCategoryDto'];

/** Longest name the API takes (INCOME_CATEGORY_NAME_MAX). */
export const INCOME_CATEGORY_NAME_MAX = 60;

/** The School's income categories (Decision 316 item 10). Any staff read them;
 * the owner manages them. */
export function useIncomeCategories(schoolId: string | null) {
  return useQuery({
    queryKey: ['incomeCategories', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/income-categories', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
    retry: false,
  });
}

function useInvalidate(schoolId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['incomeCategories', schoolId] });
}

export function useCreateIncomeCategory(schoolId: string) {
  const invalidate = useInvalidate(schoolId);
  return useMutation({
    mutationFn: (name: string) => unwrap(apiClient.POST('/v1/schools/{schoolId}/income-categories', { params: { path: { schoolId } }, body: { name } })),
    onSuccess: invalidate,
  });
}

export function useRenameIncomeCategory(schoolId: string) {
  const invalidate = useInvalidate(schoolId);
  return useMutation({
    mutationFn: ({ categoryId, name }: { categoryId: string; name: string }) =>
      unwrap(apiClient.PATCH('/v1/schools/{schoolId}/income-categories/{categoryId}', { params: { path: { schoolId, categoryId } }, body: { name } })),
    onSuccess: invalidate,
  });
}

export function useDeleteIncomeCategory(schoolId: string) {
  const invalidate = useInvalidate(schoolId);
  return useMutation({
    mutationFn: (categoryId: string) => unwrap(apiClient.DELETE('/v1/schools/{schoolId}/income-categories/{categoryId}', { params: { path: { schoolId, categoryId } } })),
    onSuccess: invalidate,
  });
}

/** The options of an income category picker: "No category" first, then the
 * School's list by name (a category in use can't be deleted, so a record's
 * own category is always in it). */
export function incomeCategoryOptions(items: IncomeCategory[] | undefined, noneLabel: string) {
  return [{ value: '', label: noneLabel }, ...(items ?? []).map((c) => ({ value: c.id, label: c.name }))];
}
