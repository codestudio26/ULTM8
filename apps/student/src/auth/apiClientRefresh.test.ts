import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ApiError, createApiClient, unwrap } from '@ultm8/api-client';

/** Exercises `createApiClient`'s `onUnauthorized` option (packages/api-client/src/
 * index.ts) directly against a mocked `global.fetch` — the one piece of this app's
 * session handling where getting the concurrency wrong has a severe, silent failure
 * mode (apps/api's refresh-token rotation treats a second concurrent redemption of
 * the same token as a compromise signal and signs the account out everywhere), so
 * it's worth a real, executable test rather than code-review alone. Runs under
 * apps/student's existing jest-expo harness — no new test infra for this, since
 * this logic is plain Fetch API usage with no RN-specific dependency. */

const USER: Record<string, unknown> = {
  id: 'u1',
  email: 'a@b.com',
  phone: '+15551234567',
  phoneVerifiedAt: null,
  firstName: 'A',
  surname: 'B',
  username: null,
  dateOfBirth: '2000-01-01',
  gender: null,
  nationality: null,
  language: null,
  currency: null,
  address: null,
  profilePhotoUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const UNAUTHORIZED_BODY = { error: { code: 'TOKEN_EXPIRED', message: 'Access token expired' } };

describe('createApiClient onUnauthorized', () => {
  let fetchMock: jest.Mock<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn() as jest.Mock<typeof fetch>;
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retries a failed GET once with the refreshed token and returns its result', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, UNAUTHORIZED_BODY));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, USER));
    const onUnauthorized = jest.fn(async () => 'new-token');

    const client = createApiClient({ baseUrl: 'http://test', getAccessToken: () => 'stale-token', onUnauthorized });
    const data = await unwrap(client.GET('/v1/users/me'));

    expect(data.email).toBe('a@b.com');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryCall = fetchMock.mock.calls[1]![0] as Request;
    expect(retryCall.headers.get('Authorization')).toBe('Bearer new-token');
  });

  it('preserves a PATCH request body on retry', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, UNAUTHORIZED_BODY));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ...USER, firstName: 'Changed' }));
    const onUnauthorized = jest.fn(async () => 'new-token');

    const client = createApiClient({ baseUrl: 'http://test', getAccessToken: () => 'stale-token', onUnauthorized });
    const data = await unwrap(client.PATCH('/v1/users/me', { body: { firstName: 'Changed' } }));

    expect(data.firstName).toBe('Changed');
    const retryCall = fetchMock.mock.calls[1]![0] as Request;
    const retryBody = await retryCall.clone().json();
    expect(retryBody).toEqual({ firstName: 'Changed' });
  });

  it('calls onUnauthorized exactly once for two 401s that overlap, not once per request', async () => {
    let resolveRefresh: ((token: string) => void) | undefined;
    const onUnauthorized = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, UNAUTHORIZED_BODY)) // request 1, first attempt
      .mockResolvedValueOnce(jsonResponse(401, UNAUTHORIZED_BODY)) // request 2, first attempt
      .mockResolvedValueOnce(jsonResponse(200, USER)) // request 1 retry
      .mockResolvedValueOnce(jsonResponse(200, USER)); // request 2 retry

    const client = createApiClient({ baseUrl: 'http://test', getAccessToken: () => 'stale-token', onUnauthorized });

    const call1 = unwrap(client.GET('/v1/users/me'));
    const call2 = unwrap(client.GET('/v1/users/me'));
    // Let both initial 401s land and both reach the single-flight guard before the
    // refresh resolves — this is the overlap the dedup exists for.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    resolveRefresh?.('new-token');

    await Promise.all([call1, call2]);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('returns the original 401 unchanged when onUnauthorized gives up', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, UNAUTHORIZED_BODY));
    const onUnauthorized = jest.fn(async () => null);

    const client = createApiClient({ baseUrl: 'http://test', getAccessToken: () => 'stale-token', onUnauthorized });

    await expect(unwrap(client.GET('/v1/users/me'))).rejects.toThrow(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a retried request that also 401s is never retried a second time', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, UNAUTHORIZED_BODY));
    fetchMock.mockResolvedValueOnce(jsonResponse(401, UNAUTHORIZED_BODY));
    const onUnauthorized = jest.fn(async () => 'new-token-that-is-also-bad');

    const client = createApiClient({ baseUrl: 'http://test', getAccessToken: () => 'stale-token', onUnauthorized });

    await expect(unwrap(client.GET('/v1/users/me'))).rejects.toThrow(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never installs retry behavior when onUnauthorized is not provided', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, UNAUTHORIZED_BODY));
    const client = createApiClient({ baseUrl: 'http://test', getAccessToken: () => 'stale-token' });

    await expect(unwrap(client.GET('/v1/users/me'))).rejects.toThrow(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
