import React, { useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { AddressLookupProvider } from '@ultm8/ui';
import { apiClient } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nProvider';
import { createAddressLookupProvider, type AddressLookupApi } from './addressLookup';

const api: AddressLookupApi = {
  autocomplete: (query) => unwrap(apiClient.GET('/v1/address-lookup/autocomplete', { params: { query } })),
  details: (query) => unwrap(apiClient.GET('/v1/address-lookup/details', { params: { query } })),
};

/**
 * Turns on "Search address" in every address form once the API says Google
 * Places is set up (`GET /v1/address-lookup/status`). Signed-in only, since
 * the lookup is; before sign-in (registration) and while it is switched off,
 * the forms keep their plain fields.
 */
export function AddressLookupBridge({ children }: { children: ReactNode }) {
  const signedIn = Boolean(useAuth().claims);
  const { locale } = useI18n();
  const { data } = useQuery({
    queryKey: ['address-lookup', 'status'],
    queryFn: () => unwrap(apiClient.GET('/v1/address-lookup/status', {})),
    enabled: signedIn,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const enabled = signedIn && data?.enabled === true;
  const provider = useMemo(() => (enabled ? createAddressLookupProvider(api, locale) : null), [enabled, locale]);
  return <AddressLookupProvider provider={provider}>{children}</AddressLookupProvider>;
}
