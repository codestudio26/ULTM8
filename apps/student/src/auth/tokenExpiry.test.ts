import { describe, expect, it } from '@jest/globals';
import { ACCESS_TOKEN_EXPIRY_BUFFER_MS, isAccessTokenExpiredOrNearExpiry } from './tokenExpiry';

function base64Url(input: string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A bare, unsigned-looking token good enough for decodeJwtPayload's own
 * payload-only decode — this file never verifies a signature, same as the
 * real client-side decode it tests against. */
function fakeToken(claims: Record<string, unknown>): string {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify(claims));
  return `${header}.${payload}.fake-signature`;
}

describe('isAccessTokenExpiredOrNearExpiry', () => {
  it('is false for a token that expires well beyond the buffer', () => {
    const token = fakeToken({ exp: Math.floor(Date.now() / 1000) + 15 * 60 });
    expect(isAccessTokenExpiredOrNearExpiry(token)).toBe(false);
  });

  it('is true for a token that already expired', () => {
    const token = fakeToken({ exp: Math.floor(Date.now() / 1000) - 60 });
    expect(isAccessTokenExpiredOrNearExpiry(token)).toBe(true);
  });

  it('is true for a token expiring within the buffer window, even though exp itself is still in the future', () => {
    const token = fakeToken({ exp: Math.floor((Date.now() + ACCESS_TOKEN_EXPIRY_BUFFER_MS / 2) / 1000) });
    expect(isAccessTokenExpiredOrNearExpiry(token)).toBe(true);
  });

  it('is false for a token expiring just outside the buffer window', () => {
    const token = fakeToken({ exp: Math.floor((Date.now() + ACCESS_TOKEN_EXPIRY_BUFFER_MS * 3) / 1000) });
    expect(isAccessTokenExpiredOrNearExpiry(token)).toBe(false);
  });

  it('is true (fail toward refreshing) when the token has no exp claim at all', () => {
    const token = fakeToken({ sub: 'u1' });
    expect(isAccessTokenExpiredOrNearExpiry(token)).toBe(true);
  });

  it('is true (fail toward refreshing) for an unparseable token', () => {
    expect(isAccessTokenExpiredOrNearExpiry('not-a-real-token')).toBe(true);
  });
});
