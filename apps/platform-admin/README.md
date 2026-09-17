# apps/platform-admin

Internal-only web app for Platform Admin staff — a genuinely separate deployment and
identity realm from `apps/school-portal` (Spec 55 §4.2/§4.4, `ultm8-tenant-isolation`
§3/§6). Never merged into `apps/school-portal`; must ship with its own subdomain in
production.

## Status: Phase 36, Slice 3 — credential rotation

Cognito-backed sign-in, the AdminUser roster (invite / list / revoke), look-up-by-id screens for School/Franchise with each one's PaymentAccount configuration, and now the first tenant-data WRITE this app exposes: initiating a Stripe Connect credential rotation.

**Built in Slice 1 (Phase 32):**
- Sign-in via AWS Cognito's own Hosted UI, Authorization Code grant + PKCE — no in-app credential form, and no client secret needed (PKCE is exactly the mechanism that lets a public browser SPA use the Authorization Code flow safely; see `src/auth/pkce.ts`'s own header comment for why an earlier Implicit-grant draft was wrong and got caught on review before this shipped). `POST /platform-admin/auth/exchange` only ever needs the resulting Cognito ID token. See `.env.example` for the three `VITE_COGNITO_*` variables this needs — real AWS infrastructure this codebase cannot provision itself; the login screen degrades to a clear "not configured" message when they're unset, same convention `apps/api`'s own unconfigured-external-dependency services already use.
- `POST /platform-admin/auth/exchange` → ULTM8's own Platform Admin JWT, stored via `@ultm8/auth`'s `platformAdminSessionStorageTokenStore` — a **separate** sessionStorage key from the tenant realm's own store, so a browser tab signed into both realms never has one token silently overwrite the other. See that package's own header comment.
- `GET/POST /platform-admin/admin-users`, `DELETE /platform-admin/admin-users/:id` — invite, list, and revoke, all FULL_ADMIN-only server-side (this app's nav isn't role-gated client-side; the backend is the real authorization boundary, same convention `apps/school-portal` already follows).

**Built in Slice 2 (Phase 33):**
- `GET /platform-admin/schools/:id` and `/franchises/:id` — look-up-by-id screens (`Schools`, `Franchises` in the nav). No cross-tenant "list all Schools/Franchises" endpoint exists (each is deliberately findOne-by-id only, see `PlatformAdminSchoolsService`'s own header comment), so both screens take a known id rather than browsing a list — same shape `apps/school-portal`'s own `StaffPage` already established for "look up one known user's role grants."
- `GET /platform-admin/schools/:schoolId/payment-account` and `/franchises/:franchiseId/payment-account` — rendered as a nested section under each lookup once the School/Franchise itself resolves. `BILLING_PAYMENTS_OPS`/`FULL_ADMIN` only server-side; a `SUPPORT` caller sees this section's own 403 state, not a silently empty one. A 404 here is a normal "no payment account configured yet" state, not an error banner.

**Built in Slice 3 (Phase 36):**
- `POST /platform-admin/payment-accounts/:id/rotate-credential` — a "Rotate credential" button on each `STRIPE`-provider PaymentAccount section (`src/paymentAccounts/PaymentAccountDetails.tsx`, shared between the School and Franchise lookup screens). Success surfaces the fresh Stripe onboarding link as a plain URL to relay to the tenant — Platform Admin cannot complete the flow on the tenant's own behalf, since Stripe Connect onboarding collects the tenant's own business/banking details. No client-side pre-validation of whether onboarding already completed; the server's own error message (a `CASH`/`BANK_TRANSFER` account, or one that never started onboarding) surfaces directly.

**Built in Slice 4 (Phase 48):**
- `POST /platform-admin/impersonation-sessions` (`src/impersonation/ImpersonationPage.tsx`) — a `userId`/`schoolId` form (look-up-by-known-id only, same as the Schools/Franchises screens; the endpoint itself has no way to search by email/name) that starts a Support-tier, read-only, School-scoped impersonation session (Phase 43/46/47, Decision 102 + Spec 55 Decision 39) and surfaces the resulting access token, expiry, and impersonated User id directly. Does **not** hand the token to `apps/school-portal` automatically — no cross-app hand-off mechanism exists anywhere in this monorepo, and building one is new scope beyond what Decision 102 confirmed; flagged for Architect/product review, same as `PaymentAccountDetails`' own precedent for surfacing a sensitive artifact rather than acting on it.

**Not built yet, each its own later slice** (mirrors `PlatformAdminModule`'s own module-header comment on the backend side):
- Any other tenant-data write UI (editing another tenant's records generally) — blocked on its own separate backend design work (Decision 105: not built, pending a named use case).
- A real "home" dashboard — still lands directly on Admin Users; there's nothing yet to summarize on a landing page.

## Local development

```
cp .env.example .env.local   # fill in VITE_COGNITO_* if you have a real Cognito Pool to point at
npm run dev --workspace @ultm8/platform-admin
```

Runs on port 5174 (school-portal uses 5173) so both apps can run side-by-side locally.

Without a real Cognito Pool configured, the login screen still renders and clearly says so — there is no way to complete a real sign-in locally without one; the honest UI degradation and the FULL_ADMIN-gated screens behind it are what CI verifies (`tsc --noEmit` / `vite build`), not a live Cognito round-trip.
