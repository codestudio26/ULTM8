import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type WaitlistEntryResponse = components['schemas']['WaitlistEntryResponseDto'];

/** Read-only — GET /classes/:id/waitlist (School Owner/Manager, Branch Staff, or
 * Instructor). FOUND ON REVIEW: this endpoint never existed before this phase —
 * see WaitlistService.findAllForClass's own header comment. Unpaginated,
 * matching the endpoint's own response shape (a single Class's queue is
 * inherently small/bounded). */
export function useClassWaitlist(classId: string | null) {
  return useQuery({
    queryKey: ['classWaitlist', classId],
    queryFn: () => unwrap(apiClient.GET('/v1/classes/{id}/waitlist', { params: { path: { id: classId! } } })),
    enabled: !!classId,
  });
}
