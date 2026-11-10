/**
 * RN-appropriate secure token storage (Decision 113 / kickoff doc "two real decisions").
 * `@ultm8/auth`'s `sessionStorageTokenStore` uses `sessionStorage`, a browser-only API
 * not available in React Native, so it can't be reused here — this mirrors its
 * `TokenStore` shape (same get/set/clear contract every screen already expects) but
 * backs it with `expo-secure-store`, the platform Keychain/Keystore, instead of a
 * DOM storage API. `AsyncStorage` was deliberately not used: it's plain, unencrypted
 * storage, a real risk for a JWT even short-lived (15-minute TTL — apps/api's
 * JWT_ACCESS_TTL default — which is exactly why a refresh token is also stored here
 * now, see AuthContext's `refreshSession`/`login`/`logout`).
 *
 * Unlike sessionStorage, SecureStore's API is async — every call site that reads the
 * token must account for that (see AuthContext's loading state), not just swap the
 * import.
 *
 * FOUND ON REVIEW, before this ever shipped: `expo-secure-store` has NO web
 * implementation at all — `node_modules/expo-secure-store/src/ExpoSecureStore.web.ts`
 * is a literal `export default {}`, so every call throws on web. This was originally
 * masked by a bare try/catch (indistinguishable from a rare real Keychain failure on a
 * real device), which a manual web-preview test caught: a session never survived a
 * page reload on web, with no visible error anywhere. The mobile target (iOS/Android,
 * this app's actual shipped platform per Decision 113) is unaffected — Keychain/Keystore
 * both work normally. `isAvailableAsync()` now makes the web gap an explicit, one-time
 * warning instead of a silent no-op indistinguishable from "everything's fine."
 *
 * CLOSED (Decision 450 item 5, a demo finding): on web the store now keeps both tokens in the
 * browser's `sessionStorage`, exactly as the School Portal does (`@ultm8/auth`'s
 * `sessionStorageTokenStore`, whose header comment gives the reasoning: tab-scoped,
 * cleared when the tab closes, never localStorage), under the same keys. So a reload
 * keeps the session: the stored access token is used, or the stored refresh token
 * renews it (AuthContext's launch path, the portal's own refresh flow). Same posture
 * as the portal, so no new security trade-off: readable by script on the origin like
 * any web token (the portal's XSS note applies), and gone with the tab, so a new tab
 * or a restarted browser signs in again. iOS/Android are unchanged: Keychain/Keystore
 * via expo-secure-store, never web storage (`webSessionBackend` is used only when
 * `Platform.OS === 'web'`).
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'ultm8.accessToken';
const REFRESH_STORAGE_KEY = 'ultm8.refreshToken';

export interface AsyncTokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string): Promise<void>;
}

let warnedUnavailable = false;

async function warnIfUnavailable(): Promise<void> {
  if (warnedUnavailable) return;
  if (!(await SecureStore.isAvailableAsync())) {
    warnedUnavailable = true;
    console.warn(
      '[secureTokenStore] expo-secure-store has no implementation on this platform ' +
        '(expected on web — it only backs iOS Keychain/Android Keystore). Sessions will ' +
        'not persist across reloads here; this is a known gap, not a crash.',
    );
  }
}

/** Web only: the browser's sessionStorage, as the School Portal keeps its tokens
 * (see the header comment). A storage that is missing or refused (private
 * browsing, storage switched off) reads as "logged out" rather than crashing, as
 * the portal's store does. Exported for its tests. */
export function createWebSessionTokenStore(storage: () => Storage | undefined = () => (typeof window === 'undefined' ? undefined : window.sessionStorage)): AsyncTokenStore {
  const read = (key: string): string | null => {
    try {
      return storage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const write = (key: string, value: string): void => {
    try {
      storage()?.setItem(key, value);
    } catch {
      // A failed write just means the session won't survive a reload.
    }
  };
  return {
    get: async () => read(STORAGE_KEY),
    set: async (token) => write(STORAGE_KEY, token),
    clear: async () => {
      try {
        // Both keys, always together (see secureTokenStore.clear() below).
        storage()?.removeItem(STORAGE_KEY);
        storage()?.removeItem(REFRESH_STORAGE_KEY);
      } catch {
        /* noop */
      }
    },
    getRefreshToken: async () => read(REFRESH_STORAGE_KEY),
    setRefreshToken: async (token) => write(REFRESH_STORAGE_KEY, token),
  };
}

const nativeSecureTokenStore: AsyncTokenStore = {
  async get() {
    try {
      await warnIfUnavailable();
      return await SecureStore.getItemAsync(STORAGE_KEY);
    } catch {
      // Keychain/Keystore unavailable — degrade to "logged out" rather than crash.
      return null;
    }
  },
  async set(token: string) {
    try {
      await warnIfUnavailable();
      await SecureStore.setItemAsync(STORAGE_KEY, token);
    } catch {
      // A failed write just means the session won't persist past this launch; it
      // shouldn't crash the login flow itself.
    }
  },
  async clear() {
    try {
      // Both keys, always together — there is no confirmed scenario where this app
      // should hold one without the other (a bare accessToken with its refreshToken
      // gone can never renew itself; a bare refreshToken with no accessToken is just
      // dead weight a stale install would otherwise carry around indefinitely).
      await Promise.all([SecureStore.deleteItemAsync(STORAGE_KEY), SecureStore.deleteItemAsync(REFRESH_STORAGE_KEY)]);
    } catch {
      /* noop — nothing to clear if storage isn't available */
    }
  },
  async getRefreshToken() {
    try {
      await warnIfUnavailable();
      return await SecureStore.getItemAsync(REFRESH_STORAGE_KEY);
    } catch {
      return null;
    }
  },
  async setRefreshToken(token: string) {
    try {
      await warnIfUnavailable();
      await SecureStore.setItemAsync(REFRESH_STORAGE_KEY, token);
    } catch {
      /* noop — same "don't crash login over a failed persist" reasoning as set() above */
    }
  },
};

/** iOS/Android: Keychain/Keystore (expo-secure-store). Web: sessionStorage, as
 * the School Portal (see the header comment). */
export const secureTokenStore: AsyncTokenStore = Platform.OS === 'web' ? createWebSessionTokenStore() : nativeSecureTokenStore;
