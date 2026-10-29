import { useQuery } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type MemberNote = components['schemas']['MemberNoteDto'];

/** The notes the School shows the student (backlog 3.10, Decision 400); a
 * Guardian passes their child's id. */
export function useMemberNotes(studentId?: string) {
  return useQuery({
    queryKey: ['memberNotes', studentId ?? null],
    queryFn: () => unwrap(apiClient.GET('/v1/student-notes/me', { params: { query: studentId ? { studentId } : {} } })),
  });
}
