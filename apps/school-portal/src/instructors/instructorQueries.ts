import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type InstructorResponse = components['schemas']['InstructorResponseDto'];
export type CreateInstructorInput = components['schemas']['CreateInstructorDto'];
export type UpdateInstructorInput = components['schemas']['UpdateInstructorDto'];
export type EligibleInstructorUser = components['schemas']['EligibleInstructorUserDto'];
export type CreateInstructorManuallyInput = components['schemas']['CreateInstructorManuallyDto'];
export type CompleteInstructorProfileInput = components['schemas']['CompleteInstructorProfileDto'];
export type CertificationContentType = components['schemas']['RequestCertificationUploadUrlDto']['contentType'];
export type InstructorClassResponse = components['schemas']['InstructorClassResponseDto'];
export type TimetableSlotResponse = components['schemas']['TimetableSlotResponseDto'];

/** Decision 226 — always fetches `includeArchived: true`, same "fetch
 * everything, filter/toggle client-side" convention useBranches already
 * established. Every page, A to Z by name (Decision 311, I3): the server sends
 * at most 100 per page, in id order, and every picker and name lookup reads
 * this list. */
export function useInstructors(schoolId: string | null) {
  return useQuery({
    queryKey: ['instructors', schoolId],
    queryFn: async () => {
      const items: InstructorResponse[] = [];
      let cursor: string | undefined;
      do {
        const page = await unwrap(
          apiClient.GET('/v1/schools/{schoolId}/instructors', { params: { path: { schoolId: schoolId! }, query: { includeArchived: true, limit: 100, cursor } } }),
        );
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      items.sort((a, b) => instructorName(a).localeCompare(instructorName(b)));
      return { items, nextCursor: null };
    },
    enabled: !!schoolId,
    // FOUND ON REVIEW (Phase 17): Classes/Timetable both call this same hook
    // to populate an Instructor dropdown — see useBranches' own comment for
    // the identical reasoning (navigating between these screens shouldn't
    // re-fetch reference data that rarely changes; a real create/update still
    // invalidates this query key directly).
    staleTime: 60_000,
  });
}

export function instructorName(i: Pick<InstructorResponse, 'firstName' | 'surname'>): string {
  return `${i.firstName} ${i.surname}`.trim();
}

/** Options for an instructor picker (Classes, Timetable, Curriculum). Only
 * active, unarchived instructors can be newly chosen (Decision 311, I2); the
 * one a record already has stays listed, marked, so saving it again works. */
export function instructorSelectOptions(
  instructors: InstructorResponse[],
  labels: { archived: string; revoked: string },
  keepUserId?: string | null,
): { value: string; label: string }[] {
  return instructors
    .filter((i) => (i.status === 'ACTIVE' && !i.archivedAt) || i.userId === keepUserId)
    .map((i) => {
      const name = instructorName(i) || i.userId;
      const note = i.archivedAt ? labels.archived : i.status !== 'ACTIVE' ? labels.revoked : null;
      return { value: i.userId, label: note ? `${name} (${note})` : name };
    });
}

/** Single-Instructor fetch via the already-existing `GET /v1/instructors/{id}`
 * endpoint — previously unused by the frontend, which only ever read a profile
 * out of the already-fetched `useInstructors` list. Needed by
 * InstructorDetailPage to load directly from a URL/refresh. */
export function useInstructor(id: string | null) {
  return useQuery({
    queryKey: ['instructors', 'detail', id],
    queryFn: () => unwrap(apiClient.GET('/v1/instructors/{id}', { params: { path: { id: id! } } })),
    enabled: !!id,
  });
}

/** v1.2 backend backlog — Instructor Detail's "Instructor Class" grid, the
 * real replacement for the client-side filter-the-School's-Classes
 * workaround. Every page (Decision 311, I14); the detail page sorts and splits
 * them into upcoming and past. */
export function useInstructorClasses(id: string | null) {
  return useQuery({
    queryKey: ['instructors', 'detail', id, 'classes'],
    queryFn: async () => {
      const items: InstructorClassResponse[] = [];
      let cursor: string | undefined;
      do {
        const page = await unwrap(apiClient.GET('/v1/instructors/{id}/classes', { params: { path: { id: id! }, query: { limit: 100, cursor } } }));
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return { items, nextCursor: null };
    },
    enabled: !!id,
  });
}

/** Candidate pool for InstructorFormModal's picker (Decision 115) — Users
 * holding an active INSTRUCTOR RoleGrant at this School and no profile here yet,
 * with the branches their role covers (Decision 311). Unpaginated, matching the
 * backend endpoint. */
export function useEligibleInstructorUsers(schoolId: string | null) {
  return useQuery({
    queryKey: ['instructors', 'eligible-users', schoolId],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/instructors/eligible-users', {
          params: { path: { schoolId: schoolId! } },
        }),
      ),
    enabled: !!schoolId,
  });
}

/** The roster, the eligible-users picker and any open detail page. */
function invalidateInstructors(queryClient: QueryClient, schoolId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['instructors', schoolId] }),
    queryClient.invalidateQueries({ queryKey: ['instructors', 'eligible-users', schoolId] }),
    queryClient.invalidateQueries({ queryKey: ['instructors', 'detail'] }),
  ]);
}

export function useCreateInstructor(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInstructorInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/instructors', { params: { path: { schoolId } }, body })),
    onSuccess: () => invalidateInstructors(queryClient, schoolId),
  });
}

export function useUpdateInstructor(schoolId: string, instructorId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateInstructorInput) =>
      unwrap(apiClient.PATCH('/v1/instructors/{id}', { params: { path: { id: instructorId } }, body })),
    onSuccess: () => invalidateInstructors(queryClient, schoolId),
  });
}

/** Decision 226 — School Owner/Manager only, idempotent, blocked (409) by an
 * upcoming Class or active TimetableSlot assignment. Never touches the
 * underlying User or their INSTRUCTOR RoleGrant. */
export function useArchiveInstructor(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (instructorId: string) => unwrap(apiClient.POST('/v1/instructors/{id}/archive', { params: { path: { id: instructorId } } })),
    onSuccess: () => invalidateInstructors(queryClient, schoolId),
  });
}

export function useUnarchiveInstructor(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (instructorId: string) => unwrap(apiClient.POST('/v1/instructors/{id}/unarchive', { params: { path: { id: instructorId } } })),
    onSuccess: () => invalidateInstructors(queryClient, schoolId),
  });
}

/** GET /instructors/me/profile (Decision 312) — every Instructor row the
 * caller holds, so CompleteInstructorProfilePage starts from what's saved. */
export function useMyInstructorProfiles() {
  return useQuery({
    queryKey: ['instructors', 'me'],
    queryFn: () => unwrap(apiClient.GET('/v1/instructors/me/profile')),
  });
}

/** PATCH /instructors/me/profile (Decision 1/217) completes and returns
 * every Instructor row the caller holds; that result replaces the cached read. */
export function useCompleteMyInstructorProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CompleteInstructorProfileInput) => unwrap(apiClient.PATCH('/v1/instructors/me/profile', { body })),
    onSuccess: (data) => queryClient.setQueryData(['instructors', 'me'], data),
  });
}

/** GET /instructors/{id}/certification-url (Decision 312) — a fresh
 * 15-minute link each time, so fetched on click rather than cached. */
export function fetchInstructorCertificationUrl(instructorId: string) {
  return unwrap(apiClient.GET('/v1/instructors/{id}/certification-url', { params: { path: { id: instructorId } } }));
}

/** POST /instructors/{id}/reassign (Decision 312) — their upcoming Classes and
 * active Timetable slots go to another instructor, all or nothing. */
export function useReassignInstructor(schoolId: string, instructorId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (toUserId: string) =>
      unwrap(apiClient.POST('/v1/instructors/{id}/reassign', { params: { path: { id: instructorId } }, body: { toUserId } })),
    onSuccess: () =>
      Promise.all([
        invalidateInstructors(queryClient, schoolId),
        queryClient.invalidateQueries({ queryKey: ['classes', schoolId] }),
        queryClient.invalidateQueries({ queryKey: ['timetable', schoolId] }),
      ]),
  });
}

/** Every Timetable slot of the School, all pages, for the detail page's
 * "Weekly timetable" box. Under the ['timetable', schoolId] key, so a slot
 * edit anywhere refreshes it. */
export function useAllTimetableSlots(schoolId: string | null) {
  return useQuery({
    queryKey: ['timetable', schoolId, 'all'],
    queryFn: async () => {
      const items: TimetableSlotResponse[] = [];
      let cursor: string | undefined;
      do {
        const page = await unwrap(
          apiClient.GET('/v1/schools/{schoolId}/timetable', { params: { path: { schoolId: schoolId! }, query: { limit: 100, cursor } } }),
        );
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return items;
    },
    enabled: !!schoolId,
  });
}

/** POST /instructors/me/certification-upload-url (Decision 1/217/218) — mint
 * a presigned URL, then the caller PUTs the file directly to R2 (never
 * through this backend) before passing the returned key to
 * useCompleteMyInstructorProfile(). */
export function useRequestCertificationUploadUrl() {
  return useMutation({
    mutationFn: (contentType: CertificationContentType) =>
      unwrap(apiClient.POST('/v1/instructors/me/certification-upload-url', { body: { contentType } })),
  });
}

/** POST /schools/{schoolId}/instructors/add-manually (Decision 1/230/237) —
 * creates a real Instructor record immediately from just name+email; the
 * response's `emailSent` flag is non-blocking (same shape
 * useCreateCoachInvite's own CoachInvitePage already treats as a banner, not
 * an error). */
export function useCreateInstructorManually(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInstructorManuallyInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/instructors/add-manually', { params: { path: { schoolId } }, body })),
    onSuccess: () => invalidateInstructors(queryClient, schoolId),
  });
}
