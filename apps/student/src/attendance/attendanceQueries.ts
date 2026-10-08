import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';

/** Resolves a scanned Class's title/time for display — on-demand, only once a scan
 * has matched an upcoming Booking (not a list operation), so a single GET is fine.
 * Accessible to a Student via class_tenant_isolation's "any active RoleGrant at this
 * School" RLS shape (confirmed against the School Portal's own Check-in screen, which
 * reads the same endpoint) — a Student holds a STUDENT RoleGrant at any School they
 * have an upcoming Booking with. */
export function useClass(classId: string | null) {
  return useQuery({
    queryKey: ['class', classId],
    queryFn: () => unwrap(apiClient.GET('/v1/classes/{id}', { params: { path: { id: classId! } } })),
    enabled: !!classId,
  });
}

/** POST /attendance/scan — the self-service QR check-in endpoint (already built,
 * Phase 13). Does all the real enforcement (booking ownership, check-in time window,
 * camera-tier consent) — this screen's own classId/nonce/freshness check is purely a
 * client-side "was this screenshot taken just now" gate, never a security boundary;
 * nothing server-side ever inspects the QR payload itself (confirmed in
 * AttendanceService.scan — it only ever takes a bookingId). */
export function useScanAttendance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) => unwrap(apiClient.POST('/v1/attendance/scan', { body: { bookingId } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-bookings'] }),
  });
}
