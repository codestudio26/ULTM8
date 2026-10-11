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
 * flow — unlike WaiverSignature's dedicated `signature-upload-url` endpoint,
 * nothing resolves "pick a photo" to a URL for this field yet, so a UI for it
 * would mean asking someone to paste a URL, which isn't a real feature). Both
 * are real, confirmed gaps, not guessed around here.
 *
 * `UpdateUserDto`'s optional fields (gender/nationality/address/username/
 * language/currency) are typed `string | undefined`, never `| null` —
 * `undefined` (an omitted key) is Prisma's own "leave this field alone"
 * signal (`users.service.ts`'s `updateMe`: `data: { ... }` with undefined
 * values spread straight through), and the generated client's type for this
 * DTO has no `null` variant to send instead. So once a Student sets one of
 * these, there is no type-safe call this client can make to blank it back to
 * empty — ProfileScreen sends `undefined` for an empty field, which leaves
 * the previous value in place rather than clearing it. A real, confirmed
 * contract gap (the DTO's own type, not a client shortcut), not worked
 * around with an unchecked cast. */
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
 * of free text — domain-rules §1 confirms exactly 4 languages and 6 currencies,
 * so this is the actual list, not an invented one. */
export function useLanguages() {
  return useQuery({ queryKey: ['settings-languages'], queryFn: () => unwrap(apiClient.GET('/v1/settings/languages')) });
}

export function useCurrencies() {
  return useQuery({ queryKey: ['settings-currencies'], queryFn: () => unwrap(apiClient.GET('/v1/settings/currencies')) });
}
