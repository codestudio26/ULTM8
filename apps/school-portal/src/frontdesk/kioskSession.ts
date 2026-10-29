import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, createApiClient, unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';
import { todayWindow, useDeskCheckIn } from './frontDeskQueries';

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
    retry: (count, err) => !isSessionEnded(err) && count < 2,
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

export function useKioskCard(studentId: string) {
  return useQuery({
    queryKey: ['kiosk', 'card', studentId],
    queryFn: () => unwrap(kioskClient.GET('/v1/front-desk/kiosk/students/{id}/card', { params: { path: { id: studentId }, query: todayWindow() } })),
  });
}

export function useKioskQrLookup() {
  return useMutation({ mutationFn: (studentToken: string) => unwrap(kioskClient.POST('/v1/front-desk/kiosk/qr-lookups', { body: { studentToken } })) });
}

/** A personal check-in code typed on the tablet (Decision 384). */
export function useKioskCodeLookup() {
  return useMutation({ mutationFn: (code: string) => unwrap(kioskClient.POST('/v1/front-desk/kiosk/code-lookups', { body: { code } })) });
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
