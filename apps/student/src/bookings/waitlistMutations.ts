import { useMutation } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';

/** Join is the one waitlist entry point this slice builds a real UI for — offered
 * inline when a booking attempt 409s "class full" (see AcademyDetailScreen). Returns
 * the created WaitlistEntryResponseDto directly; there is no GET /waitlist/me or any
 * other way to look an entry back up later (verified: apps/api's WaitlistController
 * only exposes join/withdraw/claim, no list), so the caller must hold onto the
 * returned id itself for the rest of this screen session. */
export function useJoinWaitlist() {
  return useMutation({
    // Self-join only — an empty body. `studentId` on JoinWaitlistDto is the same
    // Staff/Guardian on-behalf-of field as BookClassDto's (see bookingQueries.ts);
    // a Student joining their own waitlist entry never sends it.
    mutationFn: (classId: string) => unwrap(apiClient.POST('/v1/classes/{id}/waitlist', { params: { path: { id: classId } }, body: {} })),
  });
}

/** DELETE /waitlist/{id} responds 204 No Content on success. Originally worked around
 * here with a hand-rolled, cast-based error check, because @ultm8/api-client's
 * unwrap() used to treat any empty-body response as a failure — but that workaround
 * had its own real bug (found on review): a non-2xx response with an empty body is
 * indistinguishable, at the openapi-fetch level, from a genuine 204 success, so a
 * failed withdraw (e.g. a proxy/gateway error with no body) would have been silently
 * reported as succeeding. Fixed at the source instead — unwrap() now branches on the
 * real HTTP status (see its own header comment) — so this goes back through the same
 * shared helper every other call in this app uses. */
export function useWithdrawWaitlist() {
  return useMutation({
    mutationFn: (waitlistEntryId: string) => unwrap(apiClient.DELETE('/v1/waitlist/{id}', { params: { path: { id: waitlistEntryId } } })),
  });
}

/** NOT built: claiming an offered spot (POST /waitlist/{id}/claim). Verified directly
 * in apps/api/src/jobs/waitlist-cascade-processing.processor.ts's
 * notifyNextWaitingEntry(): flipping a WaitlistEntry to NOTIFIED never creates a
 * Notification row, sends a push, or does anything else observable by the Student —
 * it is a bare DB status flip. With no GET /waitlist/me and no notification carrying
 * the entry's id, there is no real product flow in which a Student could ever learn a
 * spot opened up or discover which id to claim. Building a "claim" button here would
 * imply a working feature that isn't reachable end-to-end — flagged as a backend gap
 * (see docs/TRACK-B-ROADMAP.md), not silently worked around. */