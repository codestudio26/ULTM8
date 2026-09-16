/**
 * Typed SDK generated from apps/api's live OpenAPI spec (ultm8-nestjs-module §3 — "the
 * one source of truth for request/response shapes"). `src/generated/schema.d.ts` is
 * produced by `npm run generate` (openapi-typescript) against `openapi.json`, a
 * snapshot of a real, running apps/api's `/v1/docs-json` — never hand-written. To
 * refresh after an apps/api contract change: boot apps/api, `curl
 * http://localhost:3000/v1/docs-json -o packages/api-client/openapi.json`, then
 * `npm run generate -w packages/api-client`. `openapi.json` is checked in so the
 * package builds reproducibly without a live server on every install.
 *
 * This file is the thin, hand-written part: an openapi-fetch client (itself fully
 * driven by the generated `paths` types, not hand-rolled per-endpoint fetch calls —
 * that's the point of generating from the spec) plus the two pieces of behavior every
 * one of Phase 3's screens needs and that don't belong duplicated in each: attaching
 * the bearer token, and unwrapping the platform's standardized `{error:{code,message}}`
 * envelope (Decision 22) into a typed, throwable ApiError instead of a raw Response.
 */
import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './generated/schema';

export type { paths } from './generated/schema';
export type { components } from './generated/schema';

/** The platform-wide error envelope every non-2xx response uses (Decision 22,
 * ultm8-nestjs-module §2). Thrown by the client below rather than left for every call
 * site to independently re-parse a Response body. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface ApiClientOptions {
  /** apps/api's base URL, e.g. https://api.ultm8.app or http://localhost:3000 — the
   * /v1 prefix is part of every generated path already, don't include it here. */
  baseUrl: string;
  /** Called on every request to get the current access token, if any. Deliberately a
   * callback, not a stored value — this package owns request/response typing only, not
   * where or how the token is persisted (that decision, and its tradeoffs, live in
   * packages/auth — see its README). Returning undefined/null omits the header
   * entirely, matching AuthModule's public (pre-login) endpoints. */
  getAccessToken?: () => string | null | undefined;
}

/**
 * Creates a typed client for apps/api. Every method is generated from the OpenAPI
 * schema (client.GET('/v1/schools'), client.POST('/v1/schools'), etc.) — request
 * bodies, path/query params, and response shapes are all inferred from `paths`, so a
 * change to a DTO in apps/api and a re-generate is what keeps this correct, not manual
 * upkeep here.
 */
export function createApiClient(options: ApiClientOptions) {
  const client = createClient<paths>({ baseUrl: options.baseUrl });

  const authMiddleware: Middleware = {
    onRequest({ request }) {
      const token = options.getAccessToken?.();
      if (token) {
        request.headers.set('Authorization', `Bearer ${token}`);
      }
      return request;
    },
  };
  client.use(authMiddleware);

  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

/**
 * Unwraps a `{data, error, response}` result from an openapi-fetch call into either
 * the data or a thrown ApiError — every screen calls its API through this rather than
 * re-checking `error`/`response.status` by hand each time. Takes the openapi-fetch
 * call's return value directly (a Promise), not an already-awaited result — so call
 * sites read as `await unwrap(client.POST('/v1/schools', { body: dto }))`, one await,
 * not two.
 *
 * Branches on `response.ok` (real HTTP status), not on whether openapi-fetch happened
 * to populate `error` — found on review (apps/student's Track B work, Slice 2):
 * openapi-fetch's own fetch wrapper returns `{ error: undefined, response }` for BOTH
 * a genuine success with an empty body (e.g. `204 No Content`) AND a non-2xx response
 * whose body happens to be empty or has `Content-Length: 0` (a proxy/gateway error, a
 * dropped connection) — `error !== undefined` alone can't tell those apart, so the
 * previous version of this function would have silently reported the latter as a
 * success. `apps/api` already has at least one real `204` endpoint merged
 * (`DELETE /notifications/device-tokens/:id`) and this codebase's own decision log
 * (Decision 94) treats "only one real consumer so far" as insufficient reason to leave
 * a shared-infrastructure bug in place once a second one exists — so this is fixed
 * here, not worked around per call site.
 */
export async function unwrap<T>(
  resultPromise: Promise<{
    data?: T;
    error?: unknown;
    response: Response;
  }>,
): Promise<T> {
  const result = await resultPromise;
  if (!result.response.ok) {
    const body = result.error as { error?: { code?: string; message?: string } } | undefined;
    throw new ApiError(
      result.response.status,
      body?.error?.code ?? 'UNKNOWN_ERROR',
      body?.error?.message ?? `Request failed with status ${result.response.status}`,
    );
  }
  // A real success with nothing to return (204) has no `data` — only flag a missing
  // body as a problem when the status implied one should have been there.
  if (result.data === undefined && result.response.status !== 204) {
    throw new ApiError(result.response.status, 'EMPTY_RESPONSE', 'Request succeeded but returned no data');
  }
  return result.data as T;
}
