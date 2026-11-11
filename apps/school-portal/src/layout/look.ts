/**
 * The "Try the new look" switch (new look rollout, PR 1: the app shell).
 *
 * The new look is turned on by `data-look="redesign"` on `<html>` (DESIGN.md,
 * closing note): every redesign style is scoped to that attribute, so with it
 * off the portal looks exactly as it always has. The choice is per browser,
 * kept in localStorage, and off by default. `?look=redesign` / `?look=classic`
 * in the address sets it too, which is handy for a demo link.
 *
 * Visual only: nothing here changes what anyone can see or do.
 */

export const LOOK_STORAGE_KEY = 'ultm8.look';
export const LOOK_ATTRIBUTE = 'data-look';
export const NEW_LOOK = 'redesign';

/** The minimum of `Storage` this module uses, so tests can pass a fake. */
export interface LookStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): LookStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    // Blocked site data, some private windows: the switch just stays off.
    return null;
  }
}

/** Whether this browser chose the new look. Off unless it was switched on. */
export function readNewLook(storage: LookStorage | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(LOOK_STORAGE_KEY) === NEW_LOOK;
  } catch {
    return false;
  }
}

/** Remember the choice. Off removes the key, so "off" is the same as never set. */
export function writeNewLook(on: boolean, storage: LookStorage | null = defaultStorage()): void {
  try {
    if (on) storage?.setItem(LOOK_STORAGE_KEY, NEW_LOOK);
    else storage?.removeItem(LOOK_STORAGE_KEY);
  } catch {
    // Nothing to do: the attribute below still changes for this page view.
  }
}

/** What `?look=` asks for: true (new), false (classic) or null (not given). */
export function lookFromSearch(search: string): boolean | null {
  let value: string | null = null;
  try {
    value = new URLSearchParams(search).get('look');
  } catch {
    return null;
  }
  if (value === NEW_LOOK) return true;
  if (value === 'classic') return false;
  return null;
}

/** Sets or removes `data-look="redesign"` on the given root (`<html>`). */
export function applyLook(on: boolean, root: { setAttribute(n: string, v: string): void; removeAttribute(n: string): void } | null = typeof document !== 'undefined' ? document.documentElement : null): void {
  if (!root) return;
  if (on) root.setAttribute(LOOK_ATTRIBUTE, NEW_LOOK);
  else root.removeAttribute(LOOK_ATTRIBUTE);
}

/**
 * Run once in main.tsx before React renders: a `?look=` in the address wins
 * (and is remembered), else the stored choice. Returns whether the new look
 * is on.
 */
export function initLook(search: string = typeof window !== 'undefined' ? window.location.search : '', storage: LookStorage | null = defaultStorage()): boolean {
  const fromUrl = lookFromSearch(search);
  if (fromUrl !== null) writeNewLook(fromUrl, storage);
  const on = fromUrl ?? readNewLook(storage);
  applyLook(on);
  return on;
}

type Listener = (on: boolean) => void;
const listeners = new Set<Listener>();

/** Turn the new look on or off from the profile menu: remembered, applied at
 * once, and every `useNewLook()` re-renders so the shell swaps. */
export function setNewLook(on: boolean): void {
  writeNewLook(on);
  applyLook(on);
  listeners.forEach((l) => l(on));
}

export function subscribeNewLook(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the page currently shows the new look (the attribute is the truth). */
export function isNewLookOn(): boolean {
  return typeof document !== 'undefined' && document.documentElement.getAttribute(LOOK_ATTRIBUTE) === NEW_LOOK;
}
