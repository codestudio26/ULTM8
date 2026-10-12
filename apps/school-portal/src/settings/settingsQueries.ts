import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type LanguageOption = components['schemas']['CodeNameResponseDto'];
export type CurrencyOption = components['schemas']['CodeNameResponseDto'];

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

/** The confirmed platform-wide currency list (ISO 4217 codes) — same
 * "rarely changes" staleTime convention as useLanguages. Backs the
 * Default currency / Currency override pickers on School/Franchise/Branch
 * forms, replacing a plain free-text input for the same already-confirmed
 * 6-currency list `GET /settings/currencies` already serves. */
export function useCurrencies() {
  return useQuery({
    queryKey: ['settings', 'currencies'],
    queryFn: () => unwrap(apiClient.GET('/v1/settings/currencies', {})),
    staleTime: 60 * 60_000,
  });
}
