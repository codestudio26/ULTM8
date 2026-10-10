import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type StudentSummary = components['schemas']['StudentSummaryResponseDto'];

/** The Student roster — Users holding an active STUDENT RoleGrant at this School.
 * No pagination in this UI yet, matching this codebase's own established
 * convention for small/bounded rosters (see useInstructors/useBranches). */
export function useStudents(schoolId: string | null) {
  return useQuery({
    queryKey: ['students', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{id}/students', { params: { path: { id: schoolId! } } })),
    enabled: !!schoolId,
  });
}
