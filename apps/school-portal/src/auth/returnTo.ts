/**
 * Where to go after signing in, kept across sign-up → verify → log in (the
 * coach invite link, Decision 183). Only same-app paths are kept. Storage can
 * be unavailable (private mode); then sign-in just goes home.
 */
const KEY = 'ultm8.returnTo';

export function rememberReturnTo(path: string) {
  try {
    if (path.startsWith('/') && !path.startsWith('//')) sessionStorage.setItem(KEY, path);
  } catch {
    /* storage unavailable */
  }
}

export function takeReturnTo(): string | null {
  try {
    const path = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return path && path.startsWith('/') && !path.startsWith('//') ? path : null;
  } catch {
    return null;
  }
}
