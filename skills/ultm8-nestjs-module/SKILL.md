---
name: ultm8-nestjs-module
description: API/module conventions for the ULTM8 NestJS backend — REST architecture, versioning and error/pagination conventions, DTO validation, the OpenAPI contract, ORM choice, and the module breakdown. Load before scaffolding, reviewing, or extending any NestJS module, controller, DTO, or the API surface itself.
---

# ULTM8 NestJS Module Conventions

**Derived from:** `deep-review/ULTM8-Dev-Handover-v55/ULTM8_Technical_Specification_55.docx` Sections 1.2, 3, 4.2, 7, 11.6, and 12.1, cross-checked against `docs/decisions/POST-SPEC-55-DECISION-LOG.md` (Decisions 70 and 71).
**Maintained by:** the Architect agent only, per the same convention as `ultm8-domain-rules`. If this skill and Spec 55 (or the decision log) ever disagree, the spec/decision log wins — flag the mismatch rather than trusting whichever one you read first.
**Status:** living reference. Re-verify against the spec and the decision log every time either is updated; do not assume this file is current.

> **Golden rule:** every rule below is tagged `[CONFIRMED]`, `[OBSERVED IN DESIGNS]`, `[UI BEHAVIOUR]`, or `[UNRESOLVED]`, exactly as in `ultm8-domain-rules`. Only `[CONFIRMED]` items may be treated as settled. If a task requires something tagged `[UNRESOLVED]`, stop and escalate — do not fill the gap with a plausible guess.

**Scope note:** this skill covers API/module *structure* only — NestJS conventions, the OpenAPI contract, module boundaries. Business/domain rules (what a Booking requires, how grading works, membership types, etc.) live in `ultm8-domain-rules`; don't duplicate them here, and don't look here for them. Tenant isolation mechanics live in `ultm8-tenant-isolation`.

---

## 1. API architecture

- **[CONFIRMED]** ULTM8 is built as a Modular REST API. GraphQL is explicitly excluded from ULTM8's API architecture. (Decision 70, `docs/decisions/POST-SPEC-55-DECISION-LOG.md`, approved by the product owner 1 Sep 2026)
- **[CONFIRMED]** This resolves what Spec 55 §12.2 itself still lists verbatim as open ("API style — REST vs GraphQL is not specified... confirm before implementation starts") — Decision 70 is the authoritative amendment per `CLAUDE.md`'s source-of-truth hierarchy; the original spec text is left unedited on purpose. (Decision 70; Spec §12.2)
- **[CONFIRMED]** A single NestJS backend (`apps/api`) serves three separately-deployed frontends — React School Portal, React Platform Admin, React Native Student — all sharing this one API surface. (§3, §4.2)

## 2. Platform-wide API conventions (Decision 22)

- **[CONFIRMED]** A `/v1` URI prefix applies from the first deploy, so a future breaking change has somewhere to go without an undocumented flag day. (§7, Decision 22)
- **[CONFIRMED]** Every non-2xx response uses a standardized `{error: {code, message}}` envelope. (§7, Decision 22)
- **[CONFIRMED]** Every list endpoint uses cursor-based pagination (`?cursor=&limit=`), not offset/page pagination. (§7, Decision 22)
- **[CONFIRMED]** These conventions were resolved as *API conventions* in Pass 8 (Decision 22) — a narrower resolution than the REST-vs-GraphQL question itself, which Decision 70 later resolved separately. Don't conflate the two decisions. (§7, §12.1 Decision 22; Decision 70)

## 3. Validation, contract, and typed client

- **[CONFIRMED]** DTO validation on every endpoint uses `class-validator`. (§1.2, §11.5)
- **[CONFIRMED]** Swagger/OpenAPI is the API contract. (§1.2)
- **[CONFIRMED]** `packages/api-client` is a typed SDK generated directly from the NestJS OpenAPI spec — the one source of truth for request/response shapes, consumed by all three frontend apps. (§4.2)
- **[CONFIRMED]** `class-validator` DTO validation is stated explicitly as the platform's injection-protection baseline on every NestJS endpoint. (§11.5)

## 4. ORM and migrations

- **[CONFIRMED]** Prisma is the chosen ORM — better NestJS ecosystem fit and more mature migration tooling than the alternative considered. (Decision 32, §11.6, §12.1)
- **[CONFIRMED]** Schema changes follow an additive-first, backward-compatible expand/contract convention within a release; destructive cleanup happens only in a later release — a stated house rule, since not every Postgres migration is cleanly reversible on a payments- and audit-log-bearing platform. (Decision 32, §11.6)
- **[CONFIRMED]** A bad deploy's standard revert path is redeploying the previous Fargate task-definition revision, not a database-level rollback. (Decision 32, §11.6)
- **[CONFIRMED]** Every RLS-scoped table gets a composite index leading with its tenant column plus the columns actually filtered/sorted on (status, date) — a migration convention, not new infrastructure. (Decision 30, §11.6; full RLS detail lives in `ultm8-tenant-isolation`)

## 5. Module breakdown

Proposed module structure — one module per bounded feature area. Endpoints listed are representative, not a final OpenAPI spec; treat this table as the starting contract Spec §7 itself describes it as. (§7)

| Module | Purpose | Representative endpoints |
|---|---|---|
| `AuthModule` | Login, registration, OTP, passcode reset, social login | `POST /auth/login`, `/auth/register`, `/auth/otp/send`, `/auth/otp/verify`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/social/{provider}` |
| `UsersModule` | Base user profile shared by all roles | `GET/PATCH /users/me`, `PATCH /users/me/{field}`, `DELETE /users/me` (self-service deletion, requires re-auth, Decision 44) |
| `TenantsModule` | Franchise/School/Branch CRUD; RoleGrant assignment/revocation; Franchise Owner roster read | CRUD `/franchises`, `/schools`, `/branches`; `POST/DELETE /users/{id}/role-grants`; `GET /franchises/{id}/schools` |
| `PaymentsModule` | PaymentAccount config + Stripe checkout/subscriptions/webhooks — no raw tenant secret keys handled | CRUD `/payment-accounts`, `POST /payments/connect/onboard`, `/payments/charge`, `/payments/subscribe`, `/payments/webhooks/stripe`, `GET /payments/methods`, `POST /payments/franchise-fees/charge`, `/payments/franchise-fees/report-usage`, `/payments/refund`, `POST /bookings/{id}/credit-restore`, `PATCH /transactions/{id}/confirm` (full payments detail lives in `ultm8-payments`) |
| `SubscriptionPlansModule` | Platform-level plans a Franchise/School subscribes to (Platform Admin authoring only) | `GET /plans`, `POST /plans/{id}/subscribe` |
| `InstructorsModule` | Instructor CRUD; grading/booking-override actions attributed to an authenticated Instructor identity | CRUD `/schools/{id}/instructors`, `POST /classes/{id}/attendance-scan` (Instructor-operated roll-call check-in — confirmed real per Decision 71, mechanics still need a design pass, see §7 below), `PATCH /bookings/{id}/override` |
| `TimetableModule` | Weekly recurring schedule | CRUD `/schools/{id}/timetable` |
| `ClassesModule` | Class CRUD + booking + waitlist | CRUD `/schools/{id}/classes`, `POST /classes/{id}/book`, `PATCH /bookings/{id}/cancel`, `/bookings/{id}/override`, `GET /bookings/me`, `POST /classes/{id}/waitlist`, `DELETE /waitlist/{id}`, `POST /waitlist/{id}/claim` |
| `MembershipsModule` | Membership plan CRUD + student purchase; Branch Staff status check | CRUD `/schools/{id}/membership-plans`, `POST /membership-plans/{id}/purchase`, `GET /memberships/me`, `GET /students/{id}/membership-status` |
| `TransactionsModule` | Ledger / invoice history | `GET /schools/{id}/transactions`, `GET /transactions/{id}/invoice` |
| `WaiversModule` | Waiver assignment + e-signature | CRUD `/schools/{id}/waivers`, `POST /waivers/{id}/sign`, `GET /waivers/me` |
| `RanksModule` | Belt/grading reference data + student progression | `GET /styles/{id}/ranks`, `POST/PATCH/DELETE /styles/{id}/ranks/{rankId}`, `GET /students/{id}/ranks`, `/students/{id}/eligibility`, `POST /students/{id}/ranks/{disciplineId}/promote`, `/downgrade`, `/stripe-award`, `POST /schools/{id}/ranks/bulk-promote`, `/bulk-stripe-award`, `PATCH /students/{id}/skills/{skillId}`, `GET /students/{id}/rank-history` |
| `CurriculumModule` | Lesson content linked to Skills (Decision 58) | `GET /skills/{id}/lessons`, `/lessons/{id}`, CRUD `/admin/curriculum/lessons` |
| `AttendanceModule` | QR check-in — marks the matching Booking Completed, drives `StudentRank.classesAttended`; checks camera-tier `ConsentRecord` status server-side before accepting a scan | `POST /attendance/scan` |
| `TranslationsModule` | i18n CMS (Platform Admin authoring only) | CRUD `/translations`, `GET /translations?locale=&screen=` |
| `AcademiesModule` | Mobile-facing discovery (read-optimized view over Tenants/Classes/Memberships) | `GET /academies`, `/academies/{id}`, `/academies/{id}/timetable` |
| `NotificationsModule` | In-app/push/email notifications | `GET /notifications/me`, `PATCH /notifications/{id}/read` |
| `SettingsModule` | Language, currency, legal content | `GET /settings/languages`, `/settings/currencies`, `/legal/{doc}` |
| `PlatformAdminModule` | Cross-tenant management, admin sub-role assignment; every endpoint requires the Platform Admin identity realm and writes to `AuditLogEntry` | `GET /admin/tenants`, `/admin/tenants/{id}`, `POST /admin/audit-log`, `GET /admin/audit-log` |
| `MobileAppPublishingModule` | `TenantAppConfig` CRUD, white-label build/submit pipeline, credential status-read | `GET/PATCH /admin/tenants/{id}/app-config`, `POST /admin/tenants/{id}/app-config/publish`, `GET .../status`, `POST .../unpublish` (dual-approval-gated; full detail in `ultm8-app-publishing`) |

- **[CONFIRMED]** Endpoints under `PlatformAdminModule` and `MobileAppPublishingModule`, and the admin-facing surfaces of `SubscriptionPlansModule` and `TranslationsModule`, are namespaced separately (`/admin/*`) and sit behind their own guard chain tied to the Platform Admin identity realm — never the tenant JWT guard used by every other module. Full isolation mechanics live in `ultm8-tenant-isolation`. (§7)

## 6. Monorepo layout

- **[CONFIRMED]** A single monorepo holds: `apps/school-portal`, `apps/platform-admin`, `apps/student` (React Native), `apps/api` (NestJS — every module above, shared by every client), `packages/ui` (shared components), `packages/api-client` (typed SDK, §3 above), `packages/auth` (shared token-handling utilities — not shared identity), `packages/build-pipeline` (white-label native build tooling — doesn't fit as a NestJS module). (§4.2)
- **[CONFIRMED]** Turborepo + npm workspaces is the actual tooling in use (not Nx, not pnpm) — pnpm wasn't available in the build environment, and npm workspaces backs Turborepo the same way pnpm would. Decided during Phase 1, noted here so the choice isn't silently re-litigated later.
- **[CONFIRMED]** As of the Phase 1 walking skeleton, `apps/api` is real — booted, hit over HTTP, `/v1/docs` serving Swagger, AuthModule fully wired. `apps/school-portal`, `apps/platform-admin`, and `apps/student`, plus all four `packages/*`, are intentional placeholder packages (`package.json` + a README stating scope and unimplemented status) — not forgotten work, just not yet started.

## 7. Unresolved — do not build against a guess

- **[UNRESOLVED]** `InstructorsModule`'s `POST /classes/{id}/attendance-scan` roll-call scan is now confirmed real (Decision 71, 2 Sep 2026, `docs/decisions/POST-SPEC-55-DECISION-LOG.md`) — but its actual mechanics are not designed: what the Instructor scans (a Student's own code vs. some other mechanism), whether it's per-Student or batched per-Class, and what deters an Instructor marking Students who aren't present are all still open. Do not build this endpoint from assumption — needs an engineering design pass from the Architect before backend work starts. (§5 `InstructorsModule` row above)

~~Previously listed here: whether `POST /classes/{id}/attendance-scan` was a duplicate/leftover of the self-service endpoint, or an intentional separate Instructor-initiated scan path. Resolved as the latter by Decision 71 — kept here only as a changelog note, not as an open item.~~

## 8. Rules for AI agents using this skill

Follow `ultm8-domain-rules` §20 in full — the tagging discipline, escalation rule, and citation requirement all apply here identically. In short: only `[CONFIRMED]` authorizes building against a rule; an `[UNRESOLVED]` item is a stop-and-escalate, never a guess; cite the `(§...)` reference in code comments/PRs so a reviewer can trace it back in one step; only the Architect agent edits this file directly.
