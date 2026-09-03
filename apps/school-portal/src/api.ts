import { createApiClient } from '@ultm8/api-client';
import { sessionStorageTokenStore } from '@ultm8/auth';

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

/** The one apps/api client instance for the whole app — always reads the current
 * token fresh from the store (see @ultm8/auth's header comment for the storage
 * decision), never caches it, so a login/logout is reflected on the very next call. */
export const apiClient = createApiClient({
  baseUrl,
  getAccessToken: () => sessionStorageTokenStore.get(),
});
