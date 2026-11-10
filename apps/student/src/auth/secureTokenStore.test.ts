import { describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-secure-store', () => {
  const items = new Map<string, string>();
  return {
    isAvailableAsync: jest.fn(async () => true),
    getItemAsync: jest.fn(async (k: string) => items.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void items.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void items.delete(k)),
  };
});

import * as SecureStore from 'expo-secure-store';
import { createWebSessionTokenStore, secureTokenStore } from './secureTokenStore';

/** A browser sessionStorage stand-in. */
function fakeStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (k: string) => items.get(k) ?? null,
    key: (i: number) => [...items.keys()][i] ?? null,
    removeItem: (k: string) => void items.delete(k),
    setItem: (k: string, v: string) => void items.set(k, v),
  };
}

describe('the web token store (Decision 450 item 5: the member app signed out on reload)', () => {
  it("keeps both tokens in sessionStorage under the School Portal's keys, so a reload finds them", async () => {
    const storage = fakeStorage();
    const store = createWebSessionTokenStore(() => storage);
    await store.set('access-1');
    await store.setRefreshToken('refresh-1');
    expect(storage.getItem('ultm8.accessToken')).toBe('access-1');
    expect(storage.getItem('ultm8.refreshToken')).toBe('refresh-1');
    // A reload: a fresh store over the same tab's storage.
    const reloaded = createWebSessionTokenStore(() => storage);
    expect(await reloaded.get()).toBe('access-1');
    expect(await reloaded.getRefreshToken()).toBe('refresh-1');
  });

  it('log out clears both together', async () => {
    const storage = fakeStorage();
    const store = createWebSessionTokenStore(() => storage);
    await store.set('a');
    await store.setRefreshToken('r');
    await store.clear();
    expect(await store.get()).toBeNull();
    expect(await store.getRefreshToken()).toBeNull();
    expect(storage.length).toBe(0);
  });

  it('storage missing or refused (private browsing): logged out, never a crash', async () => {
    const refusing = { ...fakeStorage(), getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } } as Storage;
    for (const store of [createWebSessionTokenStore(() => undefined), createWebSessionTokenStore(() => refusing)]) {
      await expect(store.set('a')).resolves.toBeUndefined();
      await expect(store.setRefreshToken('r')).resolves.toBeUndefined();
      expect(await store.get()).toBeNull();
      expect(await store.getRefreshToken()).toBeNull();
      await expect(store.clear()).resolves.toBeUndefined();
    }
  });
});

describe('iOS/Android keep the Keychain/Keystore store', () => {
  it('reads and writes through expo-secure-store, never web storage', async () => {
    await secureTokenStore.set('native-access');
    await secureTokenStore.setRefreshToken('native-refresh');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('ultm8.accessToken', 'native-access');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('ultm8.refreshToken', 'native-refresh');
    expect(await secureTokenStore.get()).toBe('native-access');
    await secureTokenStore.clear();
    expect(await secureTokenStore.getRefreshToken()).toBeNull();
  });
});

describe('on web the app uses the sessionStorage store', () => {
  it("Platform.OS 'web': tokens go to the tab's sessionStorage, not expo-secure-store", async () => {
    const storage = fakeStorage();
    const g = globalThis as { window?: unknown };
    const hadWindow = 'window' in g;
    const previous = g.window;
    g.window = { sessionStorage: storage };
    try {
      let webStore: typeof secureTokenStore | undefined;
      jest.isolateModules(() => {
        jest.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
        webStore = (require('./secureTokenStore') as { secureTokenStore: typeof secureTokenStore }).secureTokenStore;
      });
      jest.mocked(SecureStore.setItemAsync).mockClear();
      await webStore!.set('web-access');
      await webStore!.setRefreshToken('web-refresh');
      expect(storage.getItem('ultm8.accessToken')).toBe('web-access');
      expect(storage.getItem('ultm8.refreshToken')).toBe('web-refresh');
      expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    } finally {
      if (hadWindow) g.window = previous;
      else delete g.window;
    }
  });
});
