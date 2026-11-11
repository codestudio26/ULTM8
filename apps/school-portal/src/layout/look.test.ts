import { describe, expect, it } from '@jest/globals';
import { LOOK_STORAGE_KEY, initLook, lookFromSearch, readNewLook, writeNewLook, type LookStorage } from './look';

function memoryStorage(initial: Record<string, string> = {}): LookStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

const throwing: LookStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('the "Try the new look" switch', () => {
  it('is off unless this browser switched it on', () => {
    expect(readNewLook(memoryStorage())).toBe(false);
    expect(readNewLook(memoryStorage({ [LOOK_STORAGE_KEY]: 'redesign' }))).toBe(true);
    expect(readNewLook(memoryStorage({ [LOOK_STORAGE_KEY]: 'something-else' }))).toBe(false);
    expect(readNewLook(null)).toBe(false);
  });

  it('remembers on, and forgets the key when switched off', () => {
    const s = memoryStorage();
    writeNewLook(true, s);
    expect(s.data[LOOK_STORAGE_KEY]).toBe('redesign');
    writeNewLook(false, s);
    expect(LOOK_STORAGE_KEY in s.data).toBe(false);
  });

  it('never throws when the browser blocks storage, and stays off', () => {
    expect(readNewLook(throwing)).toBe(false);
    expect(() => writeNewLook(true, throwing)).not.toThrow();
    expect(initLook('', throwing)).toBe(false);
  });

  it('reads ?look=redesign and ?look=classic, ignoring anything else', () => {
    expect(lookFromSearch('?look=redesign')).toBe(true);
    expect(lookFromSearch('?a=1&look=classic')).toBe(false);
    expect(lookFromSearch('?look=dark')).toBeNull();
    expect(lookFromSearch('')).toBeNull();
  });

  it('lets the address win over the stored choice, and remembers it', () => {
    const s = memoryStorage({ [LOOK_STORAGE_KEY]: 'redesign' });
    expect(initLook('?look=classic', s)).toBe(false);
    expect(LOOK_STORAGE_KEY in s.data).toBe(false);
    expect(initLook('?look=redesign', s)).toBe(true);
    expect(initLook('', s)).toBe(true);
  });
});
