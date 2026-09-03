/**
 * Shared token-handling utilities for the 3 frontend apps (Spec §4.2 — NOT shared
 * identity; Platform Admin's realm stays separate, §4.4). Phase 3 is the first
 * consumer (apps/school-portal); apps/platform-admin and apps/student aren't built yet.
 *
 * ============================================================================
 * THE JWT-STORAGE DECISION — flagged for the Architect/product owner, not settled
 * ============================================================================
 *
 * Nothing in Spec 55, the domain-rules/nestjs-module/tenant-isolation skills, or the
 * decision log settles how the access token should be held client-side. This is a real
 * security tradeoff, not a styling choice, so it's reasoned through explicitly here
 * rather than picked silently — same treatment Decision 72 gave the passcode-lockout
 * stopgap: build against the best available reasoning, but don't treat it as final.
 *
 * The two usual options trade one exposure for another:
 *   - JS-readable storage (localStorage/sessionStorage/in-memory): vulnerable to XSS
 *     (any injected script can read and exfiltrate the token) but NOT to CSRF, since
 *     nothing attaches it automatically — a cross-site request can't make the browser
 *     send it without JS that's already running same-origin.
 *   - An httpOnly cookie: invisible to JS, so a garden-variety XSS payload can't read
 *     and exfiltrate the token directly (though sophisticated-enough XSS can still
 *     *drive* authenticated requests through it) — but cookies are attached by the
 *     browser automatically, which is exactly the CSRF exposure, requiring real
 *     defenses (SameSite, a CSRF token, double-submit cookie, etc.) to close.
 *
 * That second option isn't actually available yet, independent of preference: apps/api's
 * JwtStrategy (apps/api/src/auth/strategies/jwt.strategy.ts) is configured with
 * `ExtractJwt.fromAuthHeaderAsBearerToken()` — it reads the token from the
 * `Authorization` header ONLY. There is no cookie-parsing, no cookie-based extractor,
 * and no CSRF middleware anywhere in apps/api. Switching to httpOnly-cookie delivery
 * would mean changing how AuthModule issues and apps/api reads the token, and adding
 * CSRF protection that doesn't exist today — a backend change, and exactly the kind of
 * decision that needs sign-off before building against it, not something to redesign
 * silently from the frontend side of a "school-portal only" phase.
 *
 * Given that constraint, the decision for Phase 3 is **sessionStorage**, not
 * localStorage or a bare in-memory variable:
 *   - Not localStorage: a token in localStorage persists indefinitely across browser
 *     restarts, on shared/public machines, and is readable by any script that runs on
 *     the origin at any point in the future, not just during the session that logged
 *     in — the largest passive exposure window of the three options.
 *   - Not in-memory-only: survives normal in-app navigation fine (React Router doesn't
 *     reload the page), but is lost on every actual browser refresh or new tab. Given
 *     apps/api's AuthModule (Phase 1) has no refresh-token endpoint at all yet — login()
 *     returns only `{ accessToken }`, no refresh token, despite Spec §8.3 describing one
 *     — that would mean a full re-login on every page refresh, which is a real UX cost
 *     worth flagging on its own (see below), not one to also stack a lost-session-on-
 *     refresh problem on top of.
 *   - sessionStorage: still XSS-readable like localStorage (this is NOT XSS-proof —
 *     don't treat it as one), but scoped to the tab and cleared on tab close, so it
 *     doesn't accumulate as a standing artifact the way localStorage does. And because
 *     the access token itself expires in 15 minutes regardless of where it's stored
 *     (Spec §8.3), a stolen token's useful window is capped by the token's own TTL
 *     either way — sessionStorage's advantage over localStorage here is hygiene
 *     (smaller footprint, doesn't outlive the tab), not a change in what a successful
 *     XSS can do while the tab is open.
 *
 * SEPARATELY FLAGGED, not fixed here: apps/api's login() returns no refresh token, so
 * every session in this build ends at the 15-minute access-token TTL with a forced
 * re-login — no silent renewal exists yet. That's a backend gap (Spec §8.3's own
 * refresh-token design was never implemented in Phase 1), not a frontend one; noted
 * here because it's the direct reason sessionStorage was chosen over pure in-memory
 * storage, not because this package can fix it.
 */

const STORAGE_KEY = 'ultm8.accessToken';

export interface TokenStore {
  get(): string | null;
  set(token: string): void;
  clear(): void;
}

/**
 * The chosen implementation — swappable behind the TokenStore interface so a future,
 * confirmed change (in-memory, or an httpOnly cookie once apps/api supports one) is a
 * one-line change at the call site, not a rewrite.
 */
export const sessionStorageTokenStore: TokenStore = {
  get() {
    try {
      return sessionStorage.getItem(STORAGE_KEY);
    } catch {
      // Private-browsing / storage-disabled edge cases: fail to "no token" rather than
      // throwing, so the app degrades to "logged out" instead of crashing.
      return null;
    }
  },
  set(token: string) {
    try {
      sessionStorage.setItem(STORAGE_KEY, token);
    } catch {
      // Same rationale as get() — a failed write just means the session won't
      // persist; it shouldn't crash the login flow itself.
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop — nothing to clear if storage isn't available */
    }
  },
};

/**
 * Minimal decode of the JWT payload for client-side use (e.g. reading `grants` to
 * decide what nav to show) — NOT a signature verification. The client must never trust
 * this for an authorization decision; apps/api re-checks every grant server-side on
 * every request regardless of what the token claims (see
 * apps/api/src/tenants/tenant-authorization.service.ts's fresh-DB-check pattern this
 * mirrors on the frontend: don't trust the cached claim, treat it as a display hint).
 */
export function decodeJwtPayload<T = Record<string, unknown>>(token: string): T | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
