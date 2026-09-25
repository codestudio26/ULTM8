import Constants from 'expo-constants';
import { createApiClient } from '@ultm8/api-client';
import { getCachedAccessToken } from './auth/tokenCache';

const baseUrl =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? 'http://localhost:3000';

/** The one apps/api client instance for the whole app — always reads the current
 * token fresh from the in-memory cache AuthContext maintains (see auth/tokenCache.ts
 * for why this can't read SecureStore directly here), so a login/logout is reflected
 * on the very next call. */
export const apiClient = createApiClient({
  baseUrl,
  getAccessToken: () => getCachedAccessToken(),
});
