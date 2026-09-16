/**
 * RN-appropriate secure token storage (Decision 98 / kickoff doc "two real decisions").
 * `@ultm8/auth`'s `sessionStorageTokenStore` uses `sessionStorage`, a browser-only API
 * not available in React Native, so it can't be reused here — this mirrors its
 * `TokenStore` shape (same get/set/clear contract every screen already expects) but
 * backs it with `expo-secure-store`, the platform Keychain/Keystore, instead of a
 * DOM storage API. `AsyncStorage` was deliberately not used: it's plain, unencrypted
 * storage, a real risk for a JWT even short-lived (15-minute TTL, no refresh token yet
 * — see AuthContext's header comment).
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
 * this app's actual shipped platform per Decision 98) is unaffected — Keychain/Keystore
 * both work normally. `isAvailableAsync()` now makes the web gap an explicit, one-time
 * warning instead of a silent no-op indistinguishable from "everything's fine."
 */
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'ultm8.accessToken';

export interface AsyncTokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
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

export const secureTokenStore: AsyncTokenStore = {
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
      await SecureStore.deleteItemAsync(STORAGE_KEY);
    } catch {
      /* noop — nothing to clear if storage isn't available */
    }
  },
};
