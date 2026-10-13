import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

/** No pagination in this UI yet — same established convention as
 * useBranches/useDisciplines (see their own header comments). Decision 226
 * — always fetches `includeArchived: true`, same "fetch everything, filter/
 * toggle client-side" convention useBranches already established. */
export function useInstructors(schoolId: string | null) {
  return useQuery({
    queryKey: ['instructors', schoolId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/schools/{schoolId}/instructors', { params: { path: { schoolId: schoolId! }, query: { includeArchived: true } } })),
    enabled: !!schoolId,
    // FOUND ON REVIEW (Phase 17): Classes/Timetable both call this same hook
    // to populate an Instructor dropdown — see useBranches' own comment for
    // the identical reasoning (navigating between these screens shouldn't
    // re-fetch reference data that rarely changes; a real create/update still
    // invalidates this query key directly).
    staleTime: 60_000,
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
 * workaround. No pagination in this UI yet, same convention as useInstructors. */
export function useInstructorClasses(id: string | null) {
  return useQuery({
    queryKey: ['instructors', 'detail', id, 'classes'],
    queryFn: () => unwrap(apiClient.GET('/v1/instructors/{id}/classes', { params: { path: { id: id! } } })),
    enabled: !!id,
  });
}

/** Candidate pool for InstructorFormModal's picker (Decision 115) — Users already
 * holding an active INSTRUCTOR RoleGrant at this School. Unpaginated, matching the
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

export function useCreateInstructor(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInstructorInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/instructors', { params: { path: { schoolId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instructors', schoolId] }),
  });
}

export function useUpdateInstructor(schoolId: string, instructorId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateInstructorInput) =>
      unwrap(apiClient.PATCH('/v1/instructors/{id}', { params: { path: { id: instructorId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instructors', schoolId] }),
  });
}

/** Decision 226 — School Owner/Manager only, idempotent, blocked (409) by an
 * upcoming Class or active TimetableSlot assignment. Never touches the
 * underlying User or their INSTRUCTOR RoleGrant. */
export function useArchiveInstructor(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (instructorId: string) => unwrap(apiClient.POST('/v1/instructors/{id}/archive', { params: { path: { id: instructorId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instructors', schoolId] }),
  });
}

export function useUnarchiveInstructor(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (instructorId: string) => unwrap(apiClient.POST('/v1/instructors/{id}/unarchive', { params: { path: { id: instructorId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instructors', schoolId] }),
  });
}

/** GET-equivalent self-read isn't a separate endpoint — PATCH /instructors/me/profile
 * (Decision 1/217) both completes and returns every Instructor row the
 * caller holds, which is also all `CompleteInstructorProfilePage` needs to
 * show. No separate query hook for reading it; the mutation's own result is
 * enough for this one-shot completion screen. */
export function useCompleteMyInstructorProfile() {
  return useMutation({
    mutationFn: (body: CompleteInstructorProfileInput) => unwrap(apiClient.PATCH('/v1/instructors/me/profile', { body })),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instructors', schoolId] }),
  });
}
