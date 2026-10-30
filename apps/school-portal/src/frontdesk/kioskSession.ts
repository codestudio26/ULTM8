import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, createApiClient, unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';
import { todayWindow, useDeskCheckIn, type PackRechargeApi } from './frontDeskQueries';

/**
 * The locked front-desk tablet (Decision 380, handover F1, F2). Starting
 * front-desk mode gives the device a session token and signs the staff member
 * out of it, so the tablet never holds a staff login. The token is kept in
 * localStorage, so the tablet stays in front-desk mode through a reload or a
 * restart, and only reaches the API's /front-desk/kiosk endpoints.
 */
const TOKEN_KEY = 'ultm8.frontDesk.sessionToken';

export function readKioskToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveKioskToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // A browser that refuses storage keeps the token for this page only.
  }
  memoryToken = token;
}

export function clearKioskToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored.
  }
  memoryToken = null;
}

let memoryToken: string | null = null;

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

/** The tablet's own client: its session token, never a staff one, and no
 * refresh (a session that has ended stays ended). */
export const kioskClient = createApiClient({ baseUrl, getAccessToken: () => readKioskToken() ?? memoryToken });

/** The API's answer once the session has ended, expired or been ended by staff. */
export function isSessionEnded(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

/** The tablet is locked after too many wrong member codes (Decision 417). */
export function isTabletLocked(err: unknown): boolean {
  return err instanceof ApiError && err.status === 423;
}

export type KioskClass = components['schemas']['KioskClassDto'];
export type KioskStudentCard = components['schemas']['KioskStudentCardDto'];

// ---------------------------------------------------------------------------
// The tablet
// ---------------------------------------------------------------------------

export function useKioskInfo(enabled: boolean) {
  return useQuery({
    queryKey: ['kiosk', 'session'],
    queryFn: () => unwrap(kioskClient.GET('/v1/front-desk/kiosk/session')),
    enabled,
    retry: (count, err) => !isSessionEnded(err) && count < 2,
    // Notices an ended session (staff ended it from Check-in) within a minute.
    refetchInterval: 60_000,
  });
}

/** Today's Classes at the tablet's Branch and today's last 10 check-ins. */
export function useKioskToday(enabled: boolean, now: number) {
  const day = new Date(now).toDateString();
  return useQuery({
    queryKey: ['kiosk', 'today', day],
    queryFn: () => unwrap(kioskClient.GET('/v1/front-desk/kiosk/today', { params: { query: todayWindow(new Date(now)) } })),
    enabled,
    retry: (count, err) => !isSessionEnded(err) && !isTabletLocked(err) && count < 2,
    refetchInterval: 30_000,
  });
}

export function useKioskStudentSearch(term: string) {
  const search = term.trim();
  return useQuery({
    queryKey: ['kiosk', 'students', search],
    queryFn: () => unwrap(kioskClient.GET('/v1/front-desk/kiosk/students', { params: { query: { search } } })),
    enabled: search.length >= 2,
    staleTime: 30_000,
  });
}

/** `lookupToken`: the QR or code lookup that found them; with it the card
 * also has the notes the School shows them (Decision 400). */
export function useKioskCard(studentId: string, lookupToken?: string | null) {
  return useQuery({
    queryKey: ['kiosk', 'card', studentId, lookupToken ?? null],
    queryFn: () =>
      unwrap(
        kioskClient.GET('/v1/front-desk/kiosk/students/{id}/card', {
          params: { path: { id: studentId }, query: { ...todayWindow(), ...(lookupToken ? { lookupToken } : {}) } },
        }),
      ),
  });
}

export function useKioskQrLookup() {
  return useMutation({ mutationFn: (studentToken: string) => unwrap(kioskClient.POST('/v1/front-desk/kiosk/qr-lookups', { body: { studentToken } })) });
}

/** A personal check-in code typed on the tablet (Decision 384). */
export function useKioskCodeLookup() {
  return useMutation({ mutationFn: (code: string) => unwrap(kioskClient.POST('/v1/front-desk/kiosk/code-lookups', { body: { code } })) });
}

/** Find me (Decision 385): only whether a full name and date of birth match
 * a member here. */
export function useKioskFindMe() {
  return useMutation({
    mutationFn: (body: { fullName: string; dateOfBirth: string }) => unwrap(kioskClient.POST('/v1/front-desk/kiosk/find-me', { body })),
  });
}

/** What the tablet's sign-up form sends (Decision 392). Blank fields are sent
 * as typed; the API treats them as not given. */
export type KioskSignUpInput = {
  kind: 'VISITOR' | 'MEMBER';
  firstName: string;
  surname: string;
  dateOfBirth: string;
  gender: '' | 'FEMALE' | 'MALE';
  phone: string;
  email: string;
  heardFrom: string;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelationship: string;
};

/** Decision 392 (handover F5): a sign-up waiting for staff approval. */
export function useKioskSignUp() {
  return useMutation({
    mutationFn: (input: KioskSignUpInput) =>
      unwrap(kioskClient.POST('/v1/front-desk/kiosk/sign-ups', { body: { ...input, gender: input.gender || null } })),
  });
}

/** Decision 393: the tablet's pack recharge calls (see PackRechargeApi). */
export function useKioskPackRecharges(): PackRechargeApi {
  return {
    create: (body) => unwrap(kioskClient.POST('/v1/front-desk/kiosk/pack-recharges', { body })),
    status: (id) => unwrap(kioskClient.GET('/v1/front-desk/kiosk/pack-recharges/{id}', { params: { path: { id } } })),
    complete: (id) => unwrap(kioskClient.POST('/v1/front-desk/kiosk/pack-recharges/{id}/complete', { params: { path: { id } } })),
  };
}

export function useKioskCheckIn() {
  const queryClient = useQueryClient();
  return useDeskCheckIn(
    (body) => unwrap(kioskClient.POST('/v1/front-desk/kiosk/check-ins', { body })),
    () => queryClient.invalidateQueries({ queryKey: ['kiosk'] }),
  );
}

export function useKioskUnlock() {
  return useMutation({ mutationFn: (staffCode: string) => unwrap(kioskClient.POST('/v1/front-desk/kiosk/unlock', { body: { staffCode } })) });
}

/** A staff member's own code lets a locked tablet carry on (Decision 417). */
export function useKioskResume() {
  return useMutation({ mutationFn: (staffCode: string) => unwrap(kioskClient.POST('/v1/front-desk/kiosk/resume', { body: { staffCode } })) });
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export function useStartKiosk(schoolId: string | null) {
  return useMutation({
    mutationFn: (branchId: string | null) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/front-desk/sessions', { params: { path: { schoolId: schoolId! } }, body: { branchId } })),
  });
}

/** The tablets in front-desk mode now, at the Branches the caller works at. */
export function useKioskSessions(schoolId: string | null) {
  return useQuery({
    queryKey: ['frontDeskSessions', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/front-desk/sessions', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
    refetchInterval: 60_000,
  });
}

export function useEndKioskSession(schoolId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/front-desk/sessions/{id}/end', { params: { path: { schoolId: schoolId!, id } } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['frontDeskSessions', schoolId] }),
  });
}

/** The caller's own code for leaving a tablet (Decision 320 item 3). */
export function useMyKioskCode(schoolId: string | null) {
  return useQuery({
    queryKey: ['myKioskCode', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/front-desk/my-code', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

export function useNewKioskCode(schoolId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(apiClient.POST('/v1/schools/{schoolId}/front-desk/my-code', { params: { path: { schoolId: schoolId! } } })),
    onSuccess: (data) => queryClient.setQueryData(['myKioskCode', schoolId], data),
  });
}
