import type { AddressAutocompleteProvider, AddressSuggestion } from '@ultm8/ui';

/**
 * Google Places street lookup for every address form (Decision 212), through
 * the API's own proxy (`/v1/address-lookup/*`), so the Google key never
 * reaches the browser. The API says whether it is switched on
 * (`GET /v1/address-lookup/status`); while it isn't, no provider is given and
 * the forms show the plain fields exactly as before.
 */

export interface AddressLookupApi {
  autocomplete(query: { q: string; country?: string; sessionToken: string; language?: string }): Promise<{
    suggestions: Array<{ placeId: string; text: string; mainText: string; secondaryText: string }>;
  }>;
  details(query: { placeId: string; sessionToken: string; language?: string }): Promise<{
    postalAddress: { line1: string; line2: string; city: string; region: string; postalCode: string; country: string };
  }>;
}

function randomToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The provider `AddressFields` uses. One Google "session" runs from the first
 * search to the chosen result (Google bills that as one lookup), then a new
 * one starts for the next search.
 */
export function createAddressLookupProvider(api: AddressLookupApi, language: string | undefined, newToken: () => string = randomToken): AddressAutocompleteProvider {
  let sessionToken: string | null = null;
  const token = () => (sessionToken ??= newToken());
  return {
    async suggest(query: string, country: string): Promise<AddressSuggestion[]> {
      const res = await api.autocomplete({ q: query, country: country || undefined, sessionToken: token(), language });
      return res.suggestions.map((s) => ({ id: s.placeId, label: s.mainText || s.text, secondary: s.mainText ? s.secondaryText || undefined : undefined }));
    },
    async resolve(placeId: string) {
      try {
        const res = await api.details({ placeId, sessionToken: token(), language });
        return res.postalAddress;
      } finally {
        sessionToken = null;
      }
    },
  };
}
