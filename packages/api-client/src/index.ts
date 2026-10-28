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
  /**
   * Called when a request comes back 401 — apps/api's access tokens are short-lived
   * (15 minutes, AuthModule's own JWT_ACCESS_TTL default) by design, so this is the
   * normal mid-session case, not an edge case. Return a fresh access token to retry
   * the failed request once with it; return/resolve null or undefined to give up, in
   * which case the original 401 is returned exactly as if this option weren't set.
   * MUST NOT throw/reject — a caller that can fail (e.g. the refresh token itself is
   * also expired) must catch that itself and resolve null, the same way
   * `getAccessToken` is never allowed to do anything but return a value.
   *
   * Called AT MOST ONCE per overlapping burst of 401s, however many requests failed
   * at once — every one of them awaits the SAME call and retries with whatever it
   * resolves to. This is not just an efficiency nicety: apps/api's refresh-token
   * rotation (AuthService.refresh()) treats a SECOND concurrent attempt to redeem the
   * same not-yet-rotated refresh token as reuse — a compromise signal that revokes
   * every session for that user as a precaution. A caller that invoked this once per
   * failed request, in parallel, would routinely trigger exactly that the first time
   * two requests ever raced a token expiry together, signing the person out
   * everywhere over nothing. The single-flight dedup below is the only thing standing
   * between "token expired, refreshed transparently" and "every device signed out" —
   * it is load-bearing, not a best-effort optimization.
   */
  onUnauthorized?: () => Promise<string | null | undefined>;
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

  // Opt-in — a caller that never passes `onUnauthorized` (apps/school-portal, as of
  // this writing) gets none of this registered and sees byte-for-byte the same
  // behavior as before it existed.
  if (options.onUnauthorized) {
    client.use(createRefreshMiddleware(options.onUnauthorized));
  }

  return client;
}

/**
 * The retry-on-401 middleware behind `ApiClientOptions.onUnauthorized` — see that
 * option's own doc comment for the single-flight requirement this exists to satisfy.
 */
function createRefreshMiddleware(onUnauthorized: () => Promise<string | null | undefined>): Middleware {
  // A Request's body can only ever be read once a real fetch has started sending it,
  // so by the time onResponse sees a 401 for e.g. a PATCH, `request.body` is already
  // consumed — retrying it needs a clone taken BEFORE that happens, in onRequest.
  // Keyed by openapi-fetch's own per-request `id` (stable across onRequest/onResponse/
  // onError for one logical call); removed on both paths below so a request that's
  // never retried doesn't keep its clone alive for the rest of the app's lifetime.
  const pendingClones = new Map<string, Request>();
  // The single-flight guard `onUnauthorized`'s own doc comment requires: every 401
  // that arrives while a refresh is already in flight awaits this SAME promise
  // instead of starting a second one.
  let refreshing: Promise<string | null | undefined> | null = null;

  function refreshOnce(): Promise<string | null | undefined> {
    if (!refreshing) {
      refreshing = onUnauthorized().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  return {
    onRequest({ request, id }) {
      pendingClones.set(id, request.clone());
      return request;
    },
    async onResponse({ response, id, options: clientOptions }) {
      const original = pendingClones.get(id);
      pendingClones.delete(id);
      if (response.status !== 401 || !original) return undefined;

      let newToken: string | null | undefined;
      try {
        newToken = await refreshOnce();
      } catch {
        // Belt-and-braces only — onUnauthorized's contract says it never throws.
        return undefined;
      }
      if (!newToken) return undefined;

      // A plain fetch() here, not another call through this same client — that would
      // re-enter this exact middleware chain for the retry. Going around it like this
      // means a retry that *also* 401s is never retried again: it never reaches this
      // onResponse a second time, so the original caller just gets that 401 back, the
      // same as if onUnauthorized had returned null.
      const retryRequest = new Request(original);
      retryRequest.headers.set('Authorization', `Bearer ${newToken}`);
      // Called unbound: `clientOptions.fetch(...)` ran the browser's fetch with
      // `this` = clientOptions, which Chrome rejects ("TypeError: Illegal
      // invocation"). Every retry after a token refresh therefore failed. Queries
      // hid it by retrying on their own; a save (PATCH/POST) just showed "Something
      // went wrong" — e.g. saving the School profile after 15 minutes on the page.
      const fetchRetry = clientOptions.fetch;
      return fetchRetry(retryRequest);
    },
    onError({ id }) {
      pendingClones.delete(id);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Rewrites an error's message before it reaches the screen — an app showing
 * another language sets this to translate the API's English messages. It may
 * return a promise, so a translation table that loads on demand is waited for
 * rather than missed. Left unset, messages pass through unchanged. */
export type ApiErrorMessageTranslator = (status: number, code: string, message: string) => string | Promise<string>;

let errorMessageTranslator: ApiErrorMessageTranslator | null = null;

export function setApiErrorMessageTranslator(fn: ApiErrorMessageTranslator | null): void {
  errorMessageTranslator = fn;
}

async function errorMessage(status: number, code: string, message: string): Promise<string> {
  return errorMessageTranslator ? await errorMessageTranslator(status, code, message) : message;
}

/** The translation `unwrap` gives an error's message, for a reason the API
 * sends inside a successful reply (e.g. the front desk's one-step check-in,
 * whose items each say why they couldn't be done). */
export function translateApiErrorMessage(status: number, code: string, message: string): Promise<string> {
  return errorMessage(status, code, message);
}

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
  let result: Awaited<typeof resultPromise>;
  try {
    result = await resultPromise;
  } catch (err) {
    // fetch() itself rejected: no answer came back at all (offline, the server
    // unreachable or still starting, or a gateway error the browser blocked for
    // having no CORS headers). Said as such, so a screen can tell this apart from
    // the server refusing the request — before, it surfaced as a bare TypeError
    // and every screen fell back to "Something went wrong".
    if (err instanceof TypeError) {
      throw new ApiError(0, 'NETWORK_ERROR', await errorMessage(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.'));
    }
    throw err;
  }
  if (!result.response.ok) {
    const body = result.error as { error?: { code?: string; message?: string } } | undefined;
    const code = body?.error?.code ?? 'UNKNOWN_ERROR';
    throw new ApiError(
      result.response.status,
      code,
      await errorMessage(result.response.status, code, body?.error?.message ?? `Request failed with status ${result.response.status}`),
    );
  }
  // A real success with nothing to return (204) has no `data` — only flag a missing
  // body as a problem when the status implied one should have been there.
  if (result.data === undefined && result.response.status !== 204) {
    throw new ApiError(result.response.status, 'EMPTY_RESPONSE', await errorMessage(result.response.status, 'EMPTY_RESPONSE', 'Request succeeded but returned no data'));
  }
  return result.data as T;
}
