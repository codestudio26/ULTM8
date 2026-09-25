/**
 * `@ultm8/auth`'s `decodeJwtPayload` (packages/auth/src/index.ts) decodes the JWT
 * payload via the global `atob` — fine in a browser, but verified directly against this
 * app's actual installed runtime (react-native@0.86.3, expo@~57.0.23: grepped both
 * packages' full source trees for `atob`/`btoa` — neither defines or polyfills it, and
 * no polyfill package is installed) that `atob` is NOT a guaranteed global here. Calling
 * it would throw inside `decodeJwtPayload`'s own try/catch, which silently swallows the
 * error and returns `null` — so `claims` would always be `null` on a real device with no
 * visible failure. Rather than assume a global that isn't actually there, this is a
 * small, dependency-free base64url decoder scoped to apps/student.
 */
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);

  let output = '';
  for (let i = 0; i < padded.length; i += 4) {
    const chunk = padded.slice(i, i + 4);
    const bits =
      (BASE64_CHARS.indexOf(chunk[0]) << 18) |
      (BASE64_CHARS.indexOf(chunk[1]) << 12) |
      ((chunk[2] === '=' ? 0 : BASE64_CHARS.indexOf(chunk[2])) << 6) |
      (chunk[3] === '=' ? 0 : BASE64_CHARS.indexOf(chunk[3]));

    output += String.fromCharCode((bits >> 16) & 0xff);
    if (chunk[2] !== '=') output += String.fromCharCode((bits >> 8) & 0xff);
    if (chunk[3] !== '=') output += String.fromCharCode(bits & 0xff);
  }
  return output;
}

/** Same contract and same "display hint only, never trust for authorization" caveat as
 * `@ultm8/auth`'s `decodeJwtPayload` — apps/api re-checks every grant server-side on
 * every request regardless of what the token claims. */
export function decodeJwtPayload<T = Record<string, unknown>>(token: string): T | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    return JSON.parse(base64UrlDecode(payload)) as T;
  } catch {
    return null;
  }
}
