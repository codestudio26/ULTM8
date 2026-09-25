import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type LanguageOption = components['schemas']['CodeNameResponseDto'];

/** The confirmed platform-wide language list (BCP-47 codes) behind the
 * app-shell header's language control — not tenant-scoped, so no schoolId
 * dependency. Rarely changes, same staleTime convention as useBranches. */
export function useLanguages() {
  return useQuery({
    queryKey: ['settings', 'languages'],
    queryFn: () => unwrap(apiClient.GET('/v1/settings/languages', {})),
    staleTime: 60 * 60_000,
  });
}
