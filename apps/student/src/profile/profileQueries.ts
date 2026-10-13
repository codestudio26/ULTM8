import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type UserProfile = components['schemas']['UserResponseDto'];
export type UpdateProfileInput = components['schemas']['UpdateUserDto'];
export type CodeName = components['schemas']['CodeNameResponseDto'];
export type ProfilePhotoContentType = components['schemas']['RequestPublicPhotoUploadUrlDto']['contentType'];

const PROFILE_QUERY_KEY = ['my-profile'];

/** GET /users/me — the caller's own full profile. No screen anywhere in this app
 * has ever read this endpoint before (verified: no reference to `users/me` or
 * `UserResponseDto` anywhere in apps/student/src on master) despite it being real
 * and already shipped — login/registration only ever decode the JWT's own claims
 * (id, grants), never the richer profile row this endpoint returns. */
export function useMyProfile() {
  return useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: () => unwrap(apiClient.GET('/v1/users/me')),
  });
}

/** PATCH /users/me — deliberately excludes `email`/`phone` (UpdateUserDto's own
 * header comment: both are unique login/OTP identifiers that need re-verification
 * care, not a bare PATCH field — deferred, not an oversight). `profilePhotoUrl`
 * is excluded from THIS mutation's own callers too — it's set exclusively via
 * `useUploadMyProfilePhoto` below, which calls this same endpoint itself once the
 * upload succeeds, rather than through ProfileScreen's plain form fields.
 *
 * `UpdateUserDto`'s username/gender/nationality/language/currency/address (and
 * weightCategory/kimonoSize/beltSize) are now typed `string | null`, not just
 * `string | undefined` — closing what used to be a real contract gap: each is
 * nullable on `User` itself and the backend already cleared it on an explicit
 * `null` (confirmed in `users.e2e-spec.ts`'s own round-trip test for
 * weightCategory/kimonoSize/beltSize), but the DTO's own type never admitted
 * `null`, so no generated client — this one included — could construct a
 * type-safe call to blank one of these back out. `ProfileScreen` now sends
 * `null`, not `undefined`, for the four plain-text fields it lets a Student
 * clear (username/gender/nationality/address) — see its own header comment for
 * why `language`/`currency` (picker-only fields with no "none" option in this
 * screen's UI) are deliberately left out of that change for now. */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateProfileInput) => unwrap(apiClient.PATCH('/v1/users/me', { body: dto })),
    onSuccess: (data) => queryClient.setQueryData(PROFILE_QUERY_KEY, data),
  });
}

/** Closes the `profilePhotoUrl` gap this file's own `useUpdateProfile` comment used
 * to flag as unbuilt — `POST /uploads/public-photo-url` is a shared presign
 * endpoint already live for Instructor/Branch/Franchise/Class photos too
 * (apps/school-portal's own `PhotoUploadField`); its `USER` entityType, called
 * with no `entityId`/`schoolId`, resolves to the caller's own row with no further
 * authorization gate (`UploadsService.authorizeAndResolveScope`'s own USER branch)
 * — that's the self-service path a Student uploading their OWN photo needs,
 * distinct from the Staff-on-behalf-of-a-Student branch of that same endpoint.
 *
 * Three-step composition — request a presigned PUT URL, PUT the picked image
 * there, then PATCH /users/me with the resulting public URL — mirrors
 * waiverQueries.ts's own `uploadDrawnSignature` + `useSignWaiver` shape exactly,
 * just against the public (not private/signed) bucket, so there's no separate
 * `objectKey`/"confirm" step: `publicUrl` is immediately the real, permanent
 * value to save (see `PublicPhotoUploadUrlResponseDto`'s own comment). */
export function useUploadMyProfilePhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ uri, contentType }: { uri: string; contentType: ProfilePhotoContentType }) => {
      const { uploadUrl, publicUrl } = await unwrap(
        apiClient.POST('/v1/uploads/public-photo-url', { body: { entityType: 'USER', contentType } }),
      );
      const blob = await (await fetch(uri)).blob();
      const putRes = await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': contentType } });
      if (!putRes.ok) {
        throw new Error(`Photo upload failed (HTTP ${putRes.status})`);
      }
      return unwrap(apiClient.PATCH('/v1/users/me', { body: { profilePhotoUrl: publicUrl } }));
    },
    onSuccess: (data) => queryClient.setQueryData(PROFILE_QUERY_KEY, data),
  });
}

/** GET /settings/languages / /settings/currencies — public (no JwtAuthGuard,
 * SettingsController's own header comment: a prospective registrant needs these
 * before they have a token), so no auth concern reusing them here. Drives real
 * confirmed-list selection for `language`/`currency` on the Profile screen instead
 * of free text — domain-rules §1 confirms 4 languages; currency is now every
 * currency Stripe supports (~135 ISO 4217 codes, product-owner-approved 11/12 Oct
 * 2026, up from the old hardcoded 6 — see `CHANGELOG.md` → Unreleased), so this is
 * the actual list, not an invented one. */
export function useLanguages() {
  return useQuery({ queryKey: ['settings-languages'], queryFn: () => unwrap(apiClient.GET('/v1/settings/languages')) });
}

export function useCurrencies() {
  return useQuery({ queryKey: ['settings-currencies'], queryFn: () => unwrap(apiClient.GET('/v1/settings/currencies')) });
}
