import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';
import { formatLocale } from '../i18n/format';

/** Decision 404: freezing a membership. The staff side: the owner, or Branch
 * Staff with "Can freeze memberships" (Decision 409). */
export type SchoolFreeze = components['schemas']['SchoolMembershipFreezeResponseDto'];
export type StudentFreezableMembership = components['schemas']['StudentFreezableMembershipDto'];

/** The School's freeze requests waiting for a decision. Branch Staff with the
 * switch get only their branches' students' (Decision 409). */
export function useFreezeRequests(schoolId: string | null) {
  return useQuery({
    queryKey: ['freezes', schoolId, 'REQUESTED'],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/freezes', { params: { path: { schoolId: schoolId! }, query: { status: 'REQUESTED' } } })),
    enabled: !!schoolId,
  });
}

/** A freeze changes the Student's memberships, the requests list, the roster's
 * Frozen badge and (with a fee) the Transactions page. */
function invalidateFreezeViews(queryClient: ReturnType<typeof useQueryClient>, schoolId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['studentMemberships', schoolId] }),
    queryClient.invalidateQueries({ queryKey: ['freezableMemberships', schoolId] }),
    queryClient.invalidateQueries({ queryKey: ['freezes', schoolId] }),
    queryClient.invalidateQueries({ queryKey: ['students', schoolId] }),
    queryClient.invalidateQueries({ queryKey: ['transactions'] }),
  ]);
}

/** Decision 409: a student's memberships that can be frozen, for Branch
 * Staff with "Can freeze memberships" (who can't see the full Memberships
 * card). */
export function useStudentFreezableMemberships(schoolId: string | null, studentId: string | null) {
  return useQuery({
    queryKey: ['freezableMemberships', schoolId, studentId],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/students/{studentId}/freezable-memberships', {
          params: { path: { schoolId: schoolId!, studentId: studentId! } },
        }),
      ),
    enabled: !!schoolId && !!studentId,
  });
}

/** Staff freeze a membership straight away. */
export function useFreezeMembership(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ membershipId, startsAt, endsAt }: { membershipId: string; startsAt: string; endsAt: string }) =>
      unwrap(
        apiClient.POST('/v1/schools/{schoolId}/memberships/{membershipId}/freezes', {
          params: { path: { schoolId, membershipId } },
          body: { startsAt, endsAt },
        }),
      ),
    onSuccess: () => invalidateFreezeViews(queryClient, schoolId),
  });
}

/** Approve, decline or end a freeze. */
export function useFreezeAction(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ freezeId, action }: { freezeId: string; action: 'approve' | 'decline' | 'end' }) => {
      const params = { params: { path: { schoolId, id: freezeId } } };
      if (action === 'approve') return unwrap(apiClient.POST('/v1/schools/{schoolId}/freezes/{id}/approve', params));
      if (action === 'decline') return unwrap(apiClient.POST('/v1/schools/{schoolId}/freezes/{id}/decline', params));
      return unwrap(apiClient.POST('/v1/schools/{schoolId}/freezes/{id}/end', params));
    },
    onSuccess: () => invalidateFreezeViews(queryClient, schoolId),
  });
}

/** Plan types that can be frozen (Decision 404): not a class pack, and not a
 * friend or visit pass. The API checks this too. */
export const FREEZABLE_TYPES = ['SUBSCRIPTION', 'WEEKLY_PASS', 'TRIAL_MEMBERSHIP'];

/** A freeze day (YYYY-MM-DD, a calendar day, not an instant) as text, read in
 * this browser's calendar so it never shows as the day before. */
export function formatCalendarDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

/** A YYYY-MM-DD day `offset` days from today, in this browser's calendar. */
export function dayFromToday(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
