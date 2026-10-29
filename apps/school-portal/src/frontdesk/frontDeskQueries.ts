import { useMemo } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, translateApiErrorMessage, unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';
import { useClasses, type ClassResponse } from '../classes/classQueries';
import { ALL_PAGES_LIMIT, fetchAllPages } from '../lib/fetchAllPages';
import type { BookingResponse } from '../bookings/bookingQueries';
import type { DeskPaymentMethod } from '../membershipPlans/membershipPlanQueries';

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

/** A student's personal check-in code typed at the desk (Decision 384): who
 * it is, and a lookup token to check them in with, as for a scanned QR. */
export function useCodeLookup(schoolId: string | null) {
  return useMutation({
    mutationFn: (code: string) => unwrap(apiClient.POST('/v1/schools/{schoolId}/front-desk/code-lookups', { params: { path: { schoolId: schoolId! } }, body: { code } })),
  });
}

/** A student's personal check-in code, for their page (Decision 384). Made
 * the first time it's asked for. */
export function useStudentCheckInCode(schoolId: string | null, studentId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['studentCheckInCode', schoolId, studentId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/schools/{schoolId}/students/{studentId}/check-in-code', { params: { path: { schoolId: schoolId!, studentId: studentId! } } })),
    enabled: enabled && !!schoolId && !!studentId,
    retry: false,
  });
}

/** What a student's membership card shows (backlog 3.11). It has no QR code. */
export function useMembershipCard(schoolId: string | null, studentId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['membershipCard', schoolId, studentId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/schools/{schoolId}/students/{studentId}/membership-card', { params: { path: { schoolId: schoolId!, studentId: studentId! } } })),
    enabled: enabled && !!schoolId && !!studentId,
    retry: false,
  });
}

export function useNewStudentCheckInCode(schoolId: string | null, studentId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/students/{studentId}/check-in-code', { params: { path: { schoolId: schoolId!, studentId: studentId! } } })),
    onSuccess: (data) => {
      queryClient.setQueryData(['studentCheckInCode', schoolId, studentId], data);
      void queryClient.invalidateQueries({ queryKey: ['membershipCard', schoolId, studentId] });
    },
  });
}

/** One booking's guests, with their waiver and whether they're checked in
 * (Decision 377). */
export function useBookingGuests(bookingId: string | null) {
  return useQuery({
    queryKey: ['bookingGuests', bookingId],
    queryFn: () => unwrap(apiClient.GET('/v1/bookings/{id}/guests', { params: { path: { id: bookingId! } } })),
    enabled: !!bookingId,
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

/** Why the one-step check-in did nothing: each item that stopped it, with its
 * reason already in the screen's language. */
export class DeskCheckInError extends Error {
  constructor(readonly items: Array<{ classId?: string; attendeeId?: string; code?: string; message: string }>) {
    super('desk-check-in-not-done');
  }
}

/** What the welcome card sends to check one student in. */
export interface DeskCheckInVars {
  studentId: string;
  classIds: string[];
  qr: QrLookup | null;
  /** Decision 377: the guests ticked at the desk. */
  guests?: Array<{ bookingId: string; attendeeId: string }>;
}

type DeskCheckInBody = components['schemas']['DeskCheckInDto'];
type DeskCheckInResult = components['schemas']['DeskCheckInResponseDto'];

/**
 * Checks one student in to the ticked Classes and guests in one step
 * (Decision 378), through `post`: the staff endpoint or the locked tablet's.
 * The API books the place first where the student has none (a staff booking,
 * with every booking rule), records each check-in (INSTRUCTOR_SCAN with the
 * scanned QR's lookup, PERSONAL_CODE with a typed code's, otherwise
 * INSTRUCTOR_MANUAL) and checks in the ticked
 * guests. All or nothing: when one item can't be done, nothing is, and the
 * error says which items stopped it.
 */
export function useDeskCheckIn(post: (body: DeskCheckInBody) => Promise<DeskCheckInResult>, onSettled: (vars: DeskCheckInVars) => void) {
  return useMutation({
    mutationFn: async ({ studentId, classIds, qr, guests }: DeskCheckInVars) => {
      if (qr && qr.expiresAt <= Date.now()) throw new QrExpiredError();
      const result = await post({ studentId, classIds, guests: guests ?? [], ...(qr ? { lookupToken: qr.lookupToken } : {}) });
      if (!result.done) {
        const failed = [
          ...result.classes.filter((c) => !c.ok).map((c) => ({ classId: c.classId, code: c.code, message: c.message })),
          ...result.guests.filter((g) => !g.ok).map((g) => ({ attendeeId: g.attendeeId, code: g.code, message: g.message })),
        ];
        throw new DeskCheckInError(
          await Promise.all(failed.map(async ({ code, message, ...item }) => ({ ...item, code, message: await translateApiErrorMessage(409, code ?? 'CONFLICT', message ?? '') }))),
        );
      }
      return classIds;
    },
    onSettled: (_data, _err, vars) => onSettled(vars),
  });
}

/** The staff screens' check-in (`POST /schools/{schoolId}/front-desk/check-ins`). */
export function useFrontDeskCheckIn(schoolId: string | null) {
  const queryClient = useQueryClient();
  return useDeskCheckIn(
    (body) => unwrap(apiClient.POST('/v1/schools/{schoolId}/front-desk/check-ins', { params: { path: { schoolId: schoolId! } }, body })),
    ({ classIds, guests }) => {
      classIds.forEach((id) => queryClient.invalidateQueries({ queryKey: ['classBookings', id] }));
      (guests ?? []).forEach((g) => queryClient.invalidateQueries({ queryKey: ['bookingGuests', g.bookingId] }));
    },
  );
}

/**
 * Decision 393 (handover F8): "Pack used up: buy the same pack". The same
 * three calls for the staff desk and the tablet: offer the pack in the
 * person's app, see whether it's paid, then finish the check-in.
 */
export interface PackRechargeApi {
  create: (body: { studentId: string; classIds: string[]; lookupToken?: string }) => Promise<{ id: string; membershipPlanId: string; planTitle: string; price: number; currency?: string | null }>;
  /** Decision 395: record the same pack as a desk sale (cash, bank, Pix or card
   * terminal). Only for staff who may record desk payments; never on the tablet. */
  sell?: (body: { studentId: string; membershipPlanId: string; paymentMethod: DeskPaymentMethod }) => Promise<unknown>;
  status: (id: string) => Promise<{ paid: boolean; expired: boolean; completed: boolean }>;
  complete: (id: string) => Promise<DeskCheckInResult>;
}

/** `maySell`: the caller may record desk payments here (Decision 347): the
 * owner, or Branch Staff when the School allows it. */
export function useStaffPackRecharges(schoolId: string | null, maySell = false): PackRechargeApi {
  const queryClient = useQueryClient();
  const path = { schoolId: schoolId! };
  return {
    ...(maySell
      ? {
          sell: async (body: { studentId: string; membershipPlanId: string; paymentMethod: DeskPaymentMethod }) => {
            const sold = await unwrap(apiClient.POST('/v1/schools/{schoolId}/desk-payments', { params: { path }, body }));
            await queryClient.invalidateQueries({ queryKey: ['transactions', schoolId] });
            return sold;
          },
        }
      : {}),
    create: (body) => unwrap(apiClient.POST('/v1/schools/{schoolId}/front-desk/pack-recharges', { params: { path }, body })),
    status: (id) => unwrap(apiClient.GET('/v1/schools/{schoolId}/front-desk/pack-recharges/{id}', { params: { path: { ...path, id } } })),
    complete: (id) => unwrap(apiClient.POST('/v1/schools/{schoolId}/front-desk/pack-recharges/{id}/complete', { params: { path: { ...path, id } } })),
  };
}

export function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/** A typed code that isn't anyone's gets the desk's own friendlier line. */
export function codeErrorText(err: unknown, notFound: string): string {
  return err instanceof ApiError && err.code === 'CHECK_IN_CODE_NOT_FOUND' ? notFound : errorText(err, notFound);
}
