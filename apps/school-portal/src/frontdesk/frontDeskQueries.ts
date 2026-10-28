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

/** Today's Classes at the School (or one Branch, with the School-wide ones), in
 * start order, without the cancelled ones. The API has no Branch filter, so
 * it's applied here. `now` moves "today" on at midnight, for a tablet left on
 * overnight (check-in review CI5). */
export function useTodayClasses(schoolId: string | null, branchId: string | null, now: number) {
  const day = new Date(now).toDateString();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `day` stands for `now`, so the window moves only at midnight.
  const window = useMemo(() => todayWindow(new Date(now)), [day]);
  const query = useClasses(schoolId, { ...window, when: 'all', limit: 100 });
  const classes = useMemo(
    () =>
      (query.data?.items ?? [])
        // A Whole School class (no Branch) is on at every Branch (CI3).
        .filter((c) => !c.cancelledAt && (!branchId || !c.branchId || c.branchId === branchId))
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [query.data, branchId],
  );
  return { ...query, classes };
}

/** Every booking of today's Classes, read with the same cache key and request
 * as `useClassBookings`, so the roll call and the Class page share it.
 * `ready` once every Class's bookings have loaded. */
export function useTodayBookings(classes: ClassResponse[]): { byClass: Map<string, BookingResponse[]>; ready: boolean } {
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
  const ready = results.every((r) => !r.isPending);
  const byClass = useMemo(() => {
    const map = new Map<string, BookingResponse[]>();
    classes.forEach((c, i) => map.set(c.id, results[i]?.data?.items ?? []));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` stands for `results`.
  }, [classes, version]);
  return { byClass, ready };
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

/** Students' waivers at this School, for the welcome card (check-in review Q4). */
export function useWaiverStatus(studentId: string | null, schoolId: string | null) {
  return useQuery({
    queryKey: ['waiverStatus', studentId, schoolId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/students/{id}/waiver-status', { params: { path: { id: studentId! }, query: { schoolId: schoolId! } } })),
    enabled: !!studentId && !!schoolId,
  });
}

/** A scanned app QR lasts about 20 seconds. The API checks it once here and
 * gives a lookup that checks this student in for five minutes, so ticking
 * classes isn't a race (check-in review Q2). It also says who it is, and
 * refuses someone who isn't a student here (CI6). */
export function useQrLookup(schoolId: string | null) {
  return useMutation({
    mutationFn: (studentToken: string) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/front-desk/qr-lookups', { params: { path: { schoolId: schoolId! } }, body: { studentToken } })),
  });
}

/** What the welcome card checks a scanned student in with. */
export interface QrLookup {
  lookupToken: string;
  expiresAt: number;
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
 * records the check-in: with the scanned QR's lookup when there is one (INSTRUCTOR_SCAN),
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
      qr: QrLookup | null;
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
            body: qr ? { studentId, lookupToken: qr.lookupToken } : { studentId },
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
