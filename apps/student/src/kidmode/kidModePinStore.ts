/**
 * Decision 123 — the Kid Mode PIN is a device-local handoff gate, never sent to
 * the backend and never the security boundary itself (that's the scoped
 * Kid-Mode token — see kidModeClient.ts's own header comment). Same
 * `expo-secure-store`-backed shape as secureTokenStore.ts, including its own
 * "no web implementation, degrade rather than crash" handling — on web this
 * PIN simply won't persist across a reload, a known, already-accepted gap for
 * this app's interactive-test target, not a new one introduced here.
 */
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'ultm8.kidModePin';

export async function getKidModePin(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function setKidModePin(pin: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, pin);
  } catch {
    // A failed write just means the PIN won't persist past this launch — the
    // next entry attempt will prompt to set one again, same degrade-gracefully
    // discipline secureTokenStore.ts already established.
  }
}
