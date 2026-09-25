import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type CurrentUserResponse = components['schemas']['UserResponseDto'];
export type UpdateCurrentUserInput = components['schemas']['UpdateUserDto'];

/** The caller's own profile — every authenticated User has one, School staff
 * included (GET /users/me has no schoolId in its route). This app's own
 * AuthContext only decodes the JWT's display-only claims (email + role
 * grants — see that file's own header comment on why they're never trusted
 * for authorization), which carry no display name; this is the real source
 * for the app-shell header's profile name/photo/language. */
export function useCurrentUser() {
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: () => unwrap(apiClient.GET('/v1/users/me', {})),
  });
}

export function useUpdateCurrentUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateCurrentUserInput) => unwrap(apiClient.PATCH('/v1/users/me', { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['currentUser'] }),
  });
}
