/**
 * RN-appropriate secure token storage (Decision 113 / kickoff doc "two real decisions").
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
 * this app's actual shipped platform per Decision 113) is unaffected — Keychain/Keystore
 * both work normally. `isAvailableAsync()` now makes the web gap an explicit, one-time
 * warning instead of a silent no-op indistinguishable from "everything's fine."
 */
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'ultm8.accessToken';

// A plain boolean marker, NOT the token itself — AsyncStorage stays unencrypted-only
// for a boolean "cleanup pending" flag, consistent with this file's own documented
// reason for never putting the real JWT there. See finalizePendingLogout()'s own
// comment for what this closes.
const LOGOUT_PENDING_KEY = 'ultm8.logoutPending';

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
    // Mark the delete as pending BEFORE attempting it: if the app is killed between
    // the SecureStore call and this function returning (logout is fire-and-forget
    // from most call sites — a nav reset follows immediately), a half-finished delete
    // would otherwise leave no trace to retry on the next cold start.
    try {
      await AsyncStorage.setItem(LOGOUT_PENDING_KEY, '1');
    } catch {
      /* noop — if even this fails, fall through and still attempt the real delete */
    }
    try {
      await SecureStore.deleteItemAsync(STORAGE_KEY);
      await AsyncStorage.removeItem(LOGOUT_PENDING_KEY);
    } catch {
      // Leave LOGOUT_PENDING_KEY set — finalizePendingLogout() retries on next launch.
    }
  },
};

/**
 * Retries a logout's SecureStore delete that didn't finish last run (app killed
 * mid-clear, or a transient Keychain/Keystore failure). Call once per cold start,
 * before anything reads secureTokenStore — see AuthContext's init effect. Idempotent:
 * deleteItemAsync on an already-absent key is a no-op, and a missing flag makes this
 * whole function a no-op too, so calling it when nothing's pending is always safe.
 */
export async function finalizePendingLogout(): Promise<void> {
  let pending: string | null;
  try {
    pending = await AsyncStorage.getItem(LOGOUT_PENDING_KEY);
  } catch {
    return;
  }
  if (!pending) return;
  try {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
    await AsyncStorage.removeItem(LOGOUT_PENDING_KEY);
  } catch {
    // Still couldn't clear it — leave the flag set, try again next cold start.
  }
}
