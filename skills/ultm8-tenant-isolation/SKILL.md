---
name: ultm8-tenant-isolation
description: Multi-tenant isolation mechanics for ULTM8 — Franchise → School → Branch RLS enforcement, which entities are Branch-scoped vs School-wide, Platform Admin's separate identity realm, break-glass access, and the CI isolation gate. Load before writing or reviewing any query, endpoint, migration, or job that touches tenant-scoped data or crosses a tenant boundary.
---

# ULTM8 Tenant Isolation

**Derived from:** `deep-review/ULTM8-Dev-Handover-v55/ULTM8_Technical_Specification_55.docx` Section 4 (Platform Admin Isolation Architecture) in full, cross-checked against `skills/ultm8-domain-rules/SKILL.md` §2, §3, §7, §15, and `docs/decisions/POST-SPEC-55-DECISION-LOG.md` (Decision 76).
**Maintained by:** the Architect agent only, per the same convention as `ultm8-domain-rules`. If this skill and Spec 55 ever disagree, the spec wins — flag the mismatch rather than trusting whichever one you read first.
**Status:** living reference. Re-verify against the spec every time it's updated; do not assume this file is current.

> **Golden rule:** every rule below is tagged `[CONFIRMED]`, `[OBSERVED IN DESIGNS]`, `[UI BEHAVIOUR]`, or `[UNRESOLVED]`, exactly as in `ultm8-domain-rules`. Only `[CONFIRMED]` items may be treated as settled. If a task requires something tagged `[UNRESOLVED]`, stop and escalate — do not fill the gap with a plausible guess.

**Scope note:** this skill covers isolation *mechanics* — RLS, identity realms, break-glass, the CI gate. The business-level restatement of "one School's data is never visible to another" lives in `ultm8-domain-rules` §15; don't duplicate the mechanics there or the business framing here. API/module structure lives in `ultm8-nestjs-module`.

---

## 1. Tenancy hierarchy

- **[CONFIRMED]** Hierarchy is Franchise → School → Branch. A Franchise MAY own many Schools; a School's link to a Franchise is optional (nullable) — an independent, non-franchised School is a first-class case. A School MAY have many Branches. (§1.2, §6.2; `ultm8-domain-rules` §2)

## 2. Row-Level Security — what's keyed on what

- **[CONFIRMED]** PostgreSQL Row-Level Security policies key every tenant-scoped table on `franchise_id`/`school_id`. A query missing a tenant filter returns nothing, rather than silently returning another tenant's rows — the database enforces the boundary, not just the application layer. (§4.3)
- **[CONFIRMED]** RLS additionally keys on `branch_id` for exactly four entities genuinely tied to one physical location: `TimetableSlot`, `Class`, `Instructor`, and `Booking`. `Booking` carries a denormalized `branch_id` (copied from `Class`) specifically to support Branch Staff RLS without a join. (§4.3)
- **[CONFIRMED]** `Student` and `Membership` stay School-scoped, not Branch-scoped — a Student may train across multiple Branches under one Membership, so Branch-level RLS would be incorrect for these two entities. (§4.3)
- **[CONFIRMED]** School Owner/Manager gets an explicit "sees all Branches under this School" grant — the same pattern Platform Admin's own cross-tenant bypass uses one level up. (§4.3)
- **[CONFIRMED]** `Branch`'s field set mirrors `School`'s — name, address, contact phone, timezone, currency override, branding — beyond the already-confirmed `id`/`school_id`. (Decision 76, `docs/decisions/POST-SPEC-55-DECISION-LOG.md`)
- **[UNRESOLVED]** No Branch settings screen has ever been designed — Decision 76 confirms the field *list*, but there's no field-level UI to build against yet. Needs a design pass before this ships end-to-end. (Decision 76; §6.1, §12.2)
- **[CONFIRMED]** `FORCE ROW LEVEL SECURITY` is set on every tenant-scoped table, not just `ENABLE ROW LEVEL SECURITY` — without it, the migration-owner/table-owner connection silently bypasses RLS entirely, which defeats the point for any job or tooling that happens to run as that role. Implemented and verified as part of the Phase 1 walking skeleton (`apps/api/prisma/migrations`).
- **[CONFIRMED]** The application queries through a dedicated, non-superuser `ultm8_app` Postgres role — never the migration-owner role — so RLS is actually enforced in normal operation, not just theoretically available. A separate, SELECT-only `ultm8_auth` role exists for the one legitimate pre-authentication case: looking a user up by email/phone before any tenant context is established (RLS can't scope a query to a tenant that isn't known yet). `ultm8_auth` is deliberately narrow — read-only, scoped to exactly this lookup — not a general isolation bypass. Implemented as part of the Phase 1 walking skeleton.

## 3. Platform Admin — a separate identity realm, not a role

- **[CONFIRMED]** Platform Admin staff authenticate against a distinct identity realm/audience (a separate Auth0/Keycloak/Cognito pool, or at minimum a separate JWT issuer and audience) — never a `role: admin` column on the same `User` table customers use. This realm requires SSO against the company's own identity provider plus mandatory 2FA. (§4.4)
- **[CONFIRMED]** Platform Admin staff are never rows in the tenant `User` table — they live in a wholly separate `AdminUser` identity, never joined against tenant `User` records. (§4.4; `ultm8-domain-rules` §3)
- **[CONFIRMED]** Within that realm, Platform Admin is split into three least-privilege sub-roles, not one all-powerful bucket:
  - **Support (read-only)** — account-level status metadata across tenants only (name, subscription plan, payment status) for triage, plus a time-boxed, audited, tenant-scoped impersonation session; never a Stripe Connected Account id, a secrets-manager reference, or any tenant's data outside an active impersonation session.
  - **Billing/Payments Ops** — can view `PaymentAccount` configuration status and initiate a Stripe Connect credential rotation, but never sees a decrypted secret.
  - **Full Platform Admin** — the only tier that can assign sub-roles to other staff and invoke the break-glass bypass procedure.
  Access for any tier is revoked immediately on offboarding, not just blocked on future logins. (§4.4)
- **[CONFIRMED]** Platform Admin's cross-tenant access is never a raw database credential handed to a human. Routine cross-tenant work goes entirely through the API, where it lands in the audit log (§4 below) like any other action. (§4.3)

## 4. Break-glass — the one deliberate ad-hoc-access path

- **[CONFIRMED]** A rare break-glass path covers genuine ad-hoc SQL needs: a short-lived, auto-expiring credential issued through the secrets manager, requiring a second engineer's approval and posting automatically to a monitored channel the moment it's checked out. That role's activity is independently captured at the database level via pgAudit (or equivalent) — closing the gap where direct SQL access would otherwise be invisible to both the audit log and the CI gate (§5 below), which only ever sees traffic through the application. (§4.3)
- **[CONFIRMED]** The break-glass credential is deliberately provisioned as a non-superuser, non-table-owner Postgres role, so the DB-level restrictions protecting the audit table itself can't be bypassed even during emergency access. (§4.3, §11.5)

## 5. CI gate and ownership validation

- **[CONFIRMED]** An automated cross-tenant isolation test suite runs on every pull request and is required to merge — it asserts that a token scoped to Tenant A can never read or write Tenant B's resources, across every endpoint. This is what turns a code-review habit into a build failure when a new endpoint forgets its tenant filter. (§4.8)
- **[CONFIRMED]** This CI gate is required to merge from *before onboarding any real school with a live payment credential* — moved up from General Availability specifically because real payment data must never exist with zero automated tenant-isolation testing. (§4.9)
- **[CONFIRMED]** Two purpose-built endpoints exist specifically to bypass table-level RLS for a narrow, legitimate cross-tenant read: the membership-status-check endpoint (Branch Staff) and the Franchise Owner School-roster read (`GET /franchises/{id}/schools`). Because the CI suite above tests RLS specifically, not bespoke-endpoint ownership, each of these independently validates its path-parameter target against the caller's own RoleGrant scope before returning a result, and a parallel CI check covers this endpoint family. `credit-restore` is unaffected since it already enforces the same Booking-level `branch_id` RLS as Branch Staff's other Booking access. (§11.5, resolved Pass 7)
- **[CONFIRMED]** Every RLS-scoped table gets a composite index leading with its tenant column plus the columns actually filtered/sorted on. (Decision 30, §11.6)

## 6. Network, deployment, and audit

- **[CONFIRMED]** Platform Admin is served from its own subdomain, never the same origin as School Portal or the customer-facing marketing surface; it gets its own WAF rules and the option of an IP allowlist or VPN requirement — controls that can't be cleanly applied to a domain paying customers also log into. Environment promotion (dev/staging/prod) is tracked independently of the customer-facing apps' release cadence. (§4.6)
- **[CONFIRMED]** Every Platform Admin action that touches tenant data — viewing/editing another tenant's records, viewing/rotating a payment credential, impersonating a tenant user — is written to an immutable audit log: who, when, what, on which tenant. (§4.7)
- **[CONFIRMED]** Audit-log immutability is enforced at the database layer: `UPDATE` and `DELETE` are revoked on the `AuditLogEntry` table for every role, including the break-glass credential. `AuditLogEntry` is range-partitioned by month on `created_at` from the start. Exact retention period is a compliance/legal input, left open. (§11.5, §11.6, §12.2)

## 7. The one deliberate cross-tenant exception

- **[CONFIRMED]** A platform-wide `chargeback-pattern-restriction` background job is a deliberate, narrow exception to per-tenant isolation: it counts a Student's **lost** Stripe disputes across **every School the Student holds a RoleGrant at**, not scoped to a single School. Once a confirmed threshold is exceeded, the Student is restricted to Cash/Bank Transfer payment methods only, across that same multi-School scope, and current Schools are notified via the existing notification-fanout mechanism. Critically, a School only ever sees the *resulting restriction* already applied to a Student it already has legitimate visibility into — **never another School's raw dispute data.** This is the one place the isolation model in this skill is intentionally crossed, and only in this one narrow, audited direction. **The specific threshold count is a business/implementation parameter not stated anywhere in the confirmed material — do not invent or infer a number.** (§9, §12.1 Decision 68; `ultm8-domain-rules` §7)

## 8. Rules for AI agents using this skill

Follow `ultm8-domain-rules` §20 in full — the tagging discipline, escalation rule, and citation requirement all apply here identically. In short: only `[CONFIRMED]` authorizes building against a rule; an `[UNRESOLVED]` item is a stop-and-escalate, never a guess; cite the `(§...)` reference in code comments/PRs so a reviewer can trace it back in one step; only the Architect agent edits this file directly. Never write a query, endpoint, or job that could cross a tenant boundary outside the isolation model above — the chargeback-pattern-restriction job (§7) is the sole confirmed exception, not a precedent for inventing others.
