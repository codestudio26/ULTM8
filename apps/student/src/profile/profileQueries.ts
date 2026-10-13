import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type UserProfile = components['schemas']['UserResponseDto'];
export type UpdateProfileInput = components['schemas']['UpdateUserDto'];
export type CodeName = components['schemas']['CodeNameResponseDto'];

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
 * care, not a bare PATCH field — deferred, not an oversight) and `profilePhotoUrl`
 * (UpdateUserDto takes a plain URL string, `@IsUrl()`-validated, not an upload
 * flow — nothing resolves "pick a photo" to a URL for this field in this
 * screen). Both are real, confirmed gaps, not guessed around here.
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
