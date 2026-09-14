# apps/platform-admin

Internal-only web app for Platform Admin staff — a genuinely separate deployment and
identity realm from `apps/school-portal` (Spec 55 §4.2/§4.4, `ultm8-tenant-isolation`
§3/§6). Never merged into `apps/school-portal`; must ship with its own subdomain in
production.

## Status: Phase 32, Slice 1 — walking skeleton

Cognito-backed sign-in and the AdminUser roster (invite / list / revoke). PlatformAdminModule's backend now has a broad enough surface — a full AdminUser lifecycle plus School/Franchise/PaymentAccount cross-tenant reads — that a first real screen is worth building; Admin Users was picked because it exercises the module's full write surface (create + revoke), not just a read.

**Built this slice:**
- Sign-in via AWS Cognito's own Hosted UI, Authorization Code grant + PKCE — no in-app credential form, and no client secret needed (PKCE is exactly the mechanism that lets a public browser SPA use the Authorization Code flow safely; see `src/auth/pkce.ts`'s own header comment for why an earlier Implicit-grant draft was wrong and got caught on review before this shipped). `POST /platform-admin/auth/exchange` only ever needs the resulting Cognito ID token. See `.env.example` for the three `VITE_COGNITO_*` variables this needs — real AWS infrastructure this codebase cannot provision itself; the login screen degrades to a clear "not configured" message when they're unset, same convention `apps/api`'s own unconfigured-external-dependency services already use.
- `POST /platform-admin/auth/exchange` → ULTM8's own Platform Admin JWT, stored via `@ultm8/auth`'s `platformAdminSessionStorageTokenStore` — a **separate** sessionStorage key from the tenant realm's own store, so a browser tab signed into both realms never has one token silently overwrite the other. See that package's own header comment.
- `GET/POST /platform-admin/admin-users`, `DELETE /platform-admin/admin-users/:id` — invite, list, and revoke, all FULL_ADMIN-only server-side (this app's nav isn't role-gated client-side; the backend is the real authorization boundary, same convention `apps/school-portal` already follows).

**Not built yet, each its own later slice** (mirrors `PlatformAdminModule`'s own module-header comment on the backend side):
- School / Franchise / PaymentAccount detail screens — the backend read endpoints exist (`GET /platform-admin/schools/:id`, `/franchises/:id`, `.../payment-account`), no UI yet.
- Any tenant-data write UI (editing another tenant's records, Stripe Connect credential rotation, impersonation) — each blocked on the same backend design work `PlatformAdminModule`'s own header comment already flags, not built here first.
- A real "home" dashboard — Slice 1 lands directly on Admin Users; there's nothing yet to summarize on a landing page.

## Local development

```
cp .env.example .env.local   # fill in VITE_COGNITO_* if you have a real Cognito Pool to point at
npm run dev --workspace @ultm8/platform-admin
```

Runs on port 5174 (school-portal uses 5173) so both apps can run side-by-side locally.

Without a real Cognito Pool configured, the login screen still renders and clearly says so — there is no way to complete a real sign-in locally without one; the honest UI degradation and the FULL_ADMIN-gated screens behind it are what CI verifies (`tsc --noEmit` / `vite build`), not a live Cognito round-trip.
