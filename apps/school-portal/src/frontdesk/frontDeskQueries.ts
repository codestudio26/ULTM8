import { useMemo } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';
import { useClasses, type ClassResponse } from '../classes/classQueries';
import { ALL_PAGES_LIMIT, fetchAllPages } from '../lib/fetchAllPages';
import type { BookingResponse } from '../bookings/bookingQueries';

export type MembershipStatus = components['schemas']['MembershipStatusResponseDto']['status'];

/** Start and end of the viewer's own today, as ISO date-times. */
export function todayWindow(now: Date = new Date()): { startsFrom: string; startsTo: string } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setMilliseconds(-1);
  return { startsFrom: start.toISOString(), startsTo: end.toISOString() };
}

/** Today's Classes at the School (or one Branch), in start order, without the
 * cancelled ones. The API has no Branch filter, so it's applied here. */
export function useTodayClasses(schoolId: string | null, branchId: string | null) {
  const window = useMemo(() => todayWindow(), []);
  const query = useClasses(schoolId, { ...window, when: 'all', limit: 100 });
  const classes = useMemo(
    () =>
      (query.data?.items ?? [])
        .filter((c) => !c.cancelledAt && (!branchId || c.branchId === branchId))
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [query.data, branchId],
  );
  return { ...query, classes };
}

/** Every booking of today's Classes, read with the same cache key and request
 * as `useClassBookings`, so the roll call and the Class page share it. */
export function useTodayBookings(classes: ClassResponse[]) {
  const results = useQueries({
    queries: classes.map((c) => ({
      queryKey: ['classBookings', c.id],
      queryFn: async () => ({
        items: await fetchAllPages((cursor) =>
          unwrap(apiClient.GET('/v1/classes/{id}/bookings', { params: { path: { id: c.id }, query: { cursor, limit: ALL_PAGES_LIMIT } } })),
        ),
      }),
      refetchInterval: 30_000,
    })),
  });
  // `results` is a new array every render; when each query last changed is what matters.
  const version = results.map((r) => r.dataUpdatedAt).join(',');
  return useMemo(() => {
    const byClass = new Map<string, BookingResponse[]>();
    classes.forEach((c, i) => byClass.set(c.id, results[i]?.data?.items ?? []));
    return byClass;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` stands for `results`.
  }, [classes, version]);
}

/** Students whose name matches `term` (two letters or more). */
export function useStudentSearch(schoolId: string | null, term: string) {
  const search = term.trim();
  return useQuery({
    queryKey: ['students', schoolId, 'search', search],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{id}/students', { params: { path: { id: schoolId! }, query: { search } } })),
    enabled: !!schoolId && search.length >= 2,
    staleTime: 30_000,
  });
}

/** Whether the student has a live membership here (open to Branch Staff and
 * coaches, unlike the full membership list, which is the owner's). */
export function useMembershipStatus(studentId: string | null, schoolId: string | null) {
  return useQuery({
    queryKey: ['membershipStatus', studentId, schoolId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/students/{id}/membership-status', { params: { path: { id: studentId! }, query: { schoolId: schoolId! } } })),
    enabled: !!studentId && !!schoolId,
  });
}

/**
 * The student id inside the QR the ULTM8 app shows (`GET /attendance/my-qr-token`,
 * a signed JWT). Read without checking the signature, only to know whose
 * welcome card to open: the API checks the token itself when the check-in is
 * sent. Returns null for anything that isn't one of these tokens.
 */
export function readStudentQr(token: string): { studentId: string; expiresAt: number } | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof json?.studentId !== 'string' || typeof json?.exp !== 'number') return null;
    return { studentId: json.studentId, expiresAt: json.exp * 1000 };
  } catch {
    return null;
  }
}

export class QrExpiredError extends Error {
  constructor() {
    super('qr-expired');
  }
}

/**
 * Checks one student in to the ticked Classes. Each Class needs a booking: an
 * existing Upcoming one is used, otherwise staff book the place for the
 * student first (`POST /classes/{id}/book`, the staff-on-behalf booking every
 * booking rule still applies to). Then `POST /classes/{id}/attendance-scan`
 * records the check-in: with the scanned QR when there is one (INSTRUCTOR_SCAN),
 * otherwise as staff confirming by name (INSTRUCTOR_MANUAL).
 */
export function useFrontDeskCheckIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      studentId,
      classIds,
      bookingsByClass,
      qr,
    }: {
      studentId: string;
      classIds: string[];
      bookingsByClass: Map<string, BookingResponse[]>;
      qr: { token: string; expiresAt: number } | null;
    }) => {
      const done: string[] = [];
      for (const classId of classIds) {
        if (qr && qr.expiresAt <= Date.now()) throw new QrExpiredError();
        const mine = (bookingsByClass.get(classId) ?? []).filter((b) => b.studentId === studentId);
        if (mine.some((b) => b.status === 'COMPLETED')) {
          done.push(classId);
          continue;
        }
        if (!mine.some((b) => b.status === 'UPCOMING')) {
          await unwrap(apiClient.POST('/v1/classes/{id}/book', { params: { path: { id: classId } }, body: { studentId } }));
        }
        await unwrap(
          apiClient.POST('/v1/classes/{id}/attendance-scan', {
            params: { path: { id: classId } },
            body: qr ? { studentId, studentToken: qr.token } : { studentId },
          }),
        );
        done.push(classId);
      }
      return done;
    },
    onSettled: (_data, _err, { classIds }) => {
      classIds.forEach((id) => queryClient.invalidateQueries({ queryKey: ['classBookings', id] }));
    },
  });
}

export function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}
