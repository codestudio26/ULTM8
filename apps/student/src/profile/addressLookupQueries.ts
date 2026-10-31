import { useQuery } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type AddressSuggestion = components['schemas']['AddressSuggestionDto'];
export type AddressDetails = components['schemas']['AddressDetailsResponseDto'];

/**
 * Google Places street lookup (Decision 212) through the API's own proxy, so
 * the Google key never ships in the app. `enabled` is false until the server
 * has a key; the profile screen then shows only the plain address field.
 */
export function useAddressLookupStatus() {
  return useQuery({
    queryKey: ['address-lookup', 'status'],
    queryFn: () => unwrap(apiClient.GET('/v1/address-lookup/status', {})),
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export async function fetchAddressSuggestions(query: { q: string; sessionToken: string; language?: string }): Promise<AddressSuggestion[]> {
  const res = await unwrap(apiClient.GET('/v1/address-lookup/autocomplete', { params: { query } }));
  return res.suggestions;
}

export function fetchAddressDetails(query: { placeId: string; sessionToken: string; language?: string }): Promise<AddressDetails> {
  return unwrap(apiClient.GET('/v1/address-lookup/details', { params: { query } }));
}

/** One Google "session" per search, ended by the pick. Any letters/digits/-/_ up to 36 characters. */
export function newSessionToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}
