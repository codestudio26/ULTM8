import { createApiClient } from '@ultm8/api-client';
import { platformAdminSessionStorageTokenStore } from '@ultm8/auth';

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

/** The one apps/api client instance for the whole app — always reads the current
 * token fresh from the store, never caches it, so a login/logout is reflected on
 * the very next call. Uses platformAdminSessionStorageTokenStore, NOT
 * sessionStorageTokenStore — see @ultm8/auth's own comment on why the two realms
 * must never share a storage key. */
export const apiClient = createApiClient({
  baseUrl,
  getAccessToken: () => platformAdminSessionStorageTokenStore.get(),
});
