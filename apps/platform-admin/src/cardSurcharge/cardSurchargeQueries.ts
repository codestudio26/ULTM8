import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type CardSurchargeCountry = components['schemas']['CardSurchargeCountryDto'];

/** GET /platform-admin/card-surcharge-countries (Decision 406) — any admin. */
export function useCardSurchargeCountries() {
  return useQuery({
    queryKey: ['card-surcharge-countries'],
    queryFn: () => unwrap(apiClient.GET('/v1/platform-admin/card-surcharge-countries')),
  });
}

/** POST — Billing/Payments Ops or Full Admin server-side; audit-logged. */
export function useAddCardSurchargeCountry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (countryCode: string) => unwrap(apiClient.POST('/v1/platform-admin/card-surcharge-countries', { body: { countryCode } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['card-surcharge-countries'] }),
  });
}

/** DELETE — same tiers; Schools there stop surcharging at once, and running
 * subscriptions there from their next renewal (Decision 419 item 3, a
 * background job). */
export function useRemoveCardSurchargeCountry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (countryCode: string) =>
      unwrap(apiClient.DELETE('/v1/platform-admin/card-surcharge-countries/{countryCode}', { params: { path: { countryCode } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['card-surcharge-countries'] }),
  });
}
