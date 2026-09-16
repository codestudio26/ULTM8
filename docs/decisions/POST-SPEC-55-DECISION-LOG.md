# Post-Spec 55 Decision Log

## Purpose

This file records architectural/product decisions made **directly with the product owner after** the Spec 55 handover package was finalized (27 Aug 2026) — the third tier in `CLAUDE.md`'s source-of-truth hierarchy: *"Approved architectural/product decisions — as recorded in Spec 55 §12.1, or made directly with the product owner since. These never override Spec 55 Sections 1–11."*

It exists because the canonical spec deliverables (`ULTM8_Technical_Specification_55.docx`/`.pdf`) are fixed, packaged artifacts, and `START HERE.md` itself describes the `.docx` as "the real deliverable," not something to casually alter. Through Decision 70, there was also no tool available in this working environment to safely edit the binary `.docx` at all, which made this file the *only* place post-handover decisions could live. Rather than silently leaving Spec 55's own §12.2 "open items" list looking inconsistent with reality, decisions that resolve a §12.2 item going forward are recorded here, alongside the historical context of what was open and why — nothing in Spec 55/54's original text is deleted or rewritten.

**Update, 2 Sep 2026:** a `.docx`-editing tool became available this session. Per explicit product-owner direction, it was used exactly once, to append a new, append-only **§15 "Post-Handover Decision Addendum"** to `ULTM8_Technical_Specification_55.docx`, summarizing Decisions 70–76 with citations back to this file. Sections 1–14 of the `.docx` were not touched — verified by byte-identical diff outside the single insertion point. This file remains the canonical, fully-detailed record; §15 is a summary layer pointing back to it, not a replacement for it. **The packaged `.pdf` was not regenerated to match** — this environment has no LibreOffice/Office install to re-export it, so `ULTM8_Technical_Specification_55.pdf` is now stale relative to the `.docx` and should be regenerated from the `.docx` (e.g. via Word's own PDF export) before it's shared as if current.

**Numbering continues Spec 55 §12.1's decision log** (which runs through Decision 69) — this file's entries are Decision 70 onward. Append-only; a new decision is a new entry, never an edit to a prior one.

---

## Decision 70 — API Style: REST confirmed, GraphQL excluded from ULTM8's architecture

**Date:** 1 Sep 2026
**Status:** Approved by product owner
**Supersedes:** Spec 55 §12.2 open item *"API style — REST vs GraphQL is not specified... confirm before implementation starts."* (identical wording present in Spec 54, unchanged since at least 21 Aug 2026)

### Historical context (preserved, not deleted)

During ULTM8 Phase 0 (Foundation & Pre-Build Alignment), Task 2 investigated an apparent contradiction in Spec 55:

- §1.2 and §7 describe the API as a locked-in *"Modular REST API,"* no caveat attached.
- Decision 22 (§12.1, Pass 8, 26 Aug 2026) formally resolves *API conventions* — a standard `{error: {code, message}}` envelope, cursor-based pagination, and a `/v1` URI prefix — but is scoped only to those conventions, never to the REST-vs-GraphQL choice itself.
- §12.2, the spec's own explicitly-unresolved ledger, nonetheless still listed the REST-vs-GraphQL choice as unconfirmed, verbatim: *"Section 7's module breakdown assumes REST as the idiomatic NestJS default; confirm before implementation starts."*

Investigation (via `deep-review/ULTM8-Dev-Handover-v55/review-history-tracker.html`) found this was not an oversight: Pass 8.1's changelog explicitly calls out *"plus the ORM open item resolved"* as a distinct clause alongside "Decisions 22–36 locked," with no equivalent statement for API style anywhere in Pass 8.1–8.5; and Pass 8.5 — the final reconciliation sweep built specifically to catch drift between Sections 1–11 and §12.1/§12.2 — cross-checked all 69 decisions and surfaced 18 named drift bugs, none of them this item. The gap was reviewed and deliberately left open by the spec's own authors, not missed. No decision was made without this check; see the `#ultm8-project` Slack tracker for the full trace.

### Decision

Recorded verbatim from the product owner's direct instruction:

> **ULTM8 will use a Modular REST API. GraphQL is not part of the ULTM8 API architecture.**

The REST-specific conventions already established by Decision 22 remain authoritative and now apply under a formally confirmed REST architecture:
- `/v1` API prefix
- Standardized `{error: {code, message}}` error envelope
- Cursor-based pagination on list endpoints

### Effect on existing documents (none edited)

- **Spec 55 / Spec 54 `.docx`/`.pdf`:** left unmodified. This decision record is the authoritative amendment to §12.2's API-style entry going forward, per the source-of-truth hierarchy above — not a rewrite of the original text.
- **`docs/ultm8-blueprint.html` §08:** also lists ORM/API-style as an open gap (dated 21 Aug 2026). That file is a historical, point-in-time snapshot, same category as `review-history-tracker.html`/`tracker.html` — left unedited so it remains an accurate record of what was open at that date. This decision supersedes it going forward.
- **`skills/ultm8-domain-rules/SKILL.md`:** not modified. That skill's own stated scope is domain/business rules only — it explicitly excludes NestJS/API-surface conventions, which belong in the not-yet-created `ultm8-nestjs-module` companion skill (Phase 0 Task 3). Nothing about the skill's own content was inaccurate; it never claimed to cover this.

### Recorded by

Logged during ULTM8 Phase 0 coordination. Full working trace, evidence, and discussion in the `#ultm8-project` Slack channel and its pinned tracker canvas.

---

## Decision 71 — Attendance-scan endpoint confirmed as a real, distinct Instructor-operated roll-call path

**Date:** 2 Sep 2026
**Status:** Approved by product owner
**Resolves:** Spec 55 §12.2 unexplained endpoint `POST /classes/{id}/attendance-scan` (Domain rules §12/§18)

### Decision

Confirmed directly with the product owner: attendance check-in spans **three distinct paths**, not two —

1. **Self-service** (`POST /attendance/scan`) — Student scans a rotating, time-boxed class QR code (Decision 66). Already fully specified.
2. **Instructor-operated roll-call scan** (`POST /classes/{id}/attendance-scan`) — now confirmed real, not a duplicate/leftover listing. An Instructor actively scans each Student in as a routine, non-exceptional check-in method — the product owner confirmed both self-service and Instructor-operated scanning are real, coexisting flows ("it can be both"), not one superseding the other.
3. **Instructor/Staff override endpoint** — stays scoped to the accessibility/no-alternative *exception* path only (`overriddenBy`/`overrideReason` always recorded), never the routine mechanism. This decision does not change its scope.

### Effect / open follow-up (not resolved by this decision)

This resolves *purpose*, not *mechanics*. Decision 66's rotating-code anti-spoofing design was built specifically against self-service's photograph-and-forward risk; path #2 has no equivalent technical design yet — what the Instructor actually scans (a Student's own code vs. some other mechanism), whether it's per-Student or batched per-Class, and what deters an Instructor marking Students who aren't actually present are all still open. **Do not build path #2 from assumption** — needs an engineering design pass, flagged for the Architect / `ultm8-nestjs-module` companion skill before backend work starts.

### Recorded by

Logged during ULTM8 Phase 0, Task 4 escalation follow-up, 2 Sep 2026. Full discussion in `#ultm8-project`.

---

## Decision 72 — Passcode confirmed as the sole login credential (PIN-style authentication)

**Date:** 2 Sep 2026
**Status:** Approved by product owner
**Resolves:** Spec 55 §12.2 "Passcode security model" open item (Domain rules §18)

### Decision

The 6-digit passcode is the Student/Guardian account's **entire login credential** — a PIN-style authentication model. Phone (E.164) or email is the account identifier; the passcode is the sole secret, not a step-up factor alongside a separate password.

### Effect / open follow-up (not resolved by this decision)

Confirms Domain rules §18's open item at the model level only. Still undesigned: rate-limiting/lockout behaviour on repeated wrong-passcode attempts, and the recovery flow when a passcode is forgotten. Twilio Verify / email OTP (already-confirmed providers, Spec 55 §11.4) plausibly cover registration and recovery verification rather than routine login, but that boundary is not explicitly confirmed anywhere — do not assume it; confirm before Auth module work starts.

### Recorded by

Logged during ULTM8 Phase 0, Task 4 escalation follow-up, 2 Sep 2026. Full discussion in `#ultm8-project`.

---

## Decision 73 — Guardian age thresholds (13/18) confirmed as interim, pending legal review

**Date:** 2 Sep 2026
**Status:** Approved by product owner as an interim business decision — **not a legal determination**
**Resolves:** Spec 55 §12.2 / Domain rules §14/§18 provisional age thresholds

### Decision

Phase 1 builds against the existing provisional numbers: **age 13** for limited (read-only) login, **age 18** for majority/self-registration, as configurable constants — not shipped as a final legal position.

### Effect / open follow-up (not resolved by this decision)

Unblocks Guardian/consent screen work in Phase 1. Domain rules §14's `[UNRESOLVED — provisional, pending legal review]` tag **must stay in place** — this decision authorizes building against the numbers, it does not close the legal question. A future decision should supersede this one once real legal review completes across every jurisdiction ULTM8 operates in; if the thresholds change, any logic already built against 13/18 must be revisited.

### Recorded by

Logged during ULTM8 Phase 0, Task 4 escalation follow-up, 2 Sep 2026. Full discussion in `#ultm8-project`.

---

## Decision 74 — E-signature strengthened with drawn signature capture, pending legal review

**Date:** 2 Sep 2026
**Status:** Approved by product owner as an interim business decision — **not a legal determination**
**Resolves:** Spec 55 §12.2 / Domain rules §13/§18 e-signature legal-sufficiency gap

### Decision

Waiver e-signature adds **drawn signature capture** (canvas, finger/stylus) alongside the existing typed full name, for both Student and Guardian signers. This is new scope beyond Spec 55 §2.2's current design (typed name + signature field, no drawn-capture UI shown anywhere in the designs).

### Effect / open follow-up (not resolved by this decision)

This is a product/UX strengthening step, **not** a legal-sufficiency determination — Domain rules §13's `[UNRESOLVED]` tag on legal sufficiency stays in place until actual legal review happens across all ~6 currency regions ULTM8 spans. New follow-up items this creates, none yet designed: the drawn-signature capture screen itself, how the stroke/image data is stored (raster blob vs. vector path), and whether `WaiverSignature`'s schema needs a new field for it. Flagged for the Architect / design work before this can be built.

### Recorded by

Logged during ULTM8 Phase 0, Task 4 escalation follow-up, 2 Sep 2026. Full discussion in `#ultm8-project`.

---

## Decision 75 — StudentRank progress-% formula: School-configurable, no platform-wide default

**Date:** 2 Sep 2026
**Status:** Approved by product owner
**Resolves:** Spec 55 §12.2 / Domain rules §5/§18 readiness-bucket thresholds and progress-% formula

### Decision

`StudentRank`'s computed progress % and Ready / Almost Ready / Not Ready bucket thresholds are **School-configurable per discipline** — ULTM8 does not ship one fixed platform-wide formula or threshold set.

### Effect / open follow-up (not resolved by this decision)

This resolves *whether* a platform default exists (it doesn't) — not the configuration schema itself. Still open: exactly what a School configures (e.g. any weighting between the classes-attended ratio and the skill sign-off ratio), what sensible defaults get offered when a School first sets up a discipline, and how the working Grading Board prototype's `[OBSERVED IN DESIGNS]` "Just Starting / Getting There / Ready to Grade" labels (§5) map onto a now-configurable bucket system. Flagged for the Architect before `RanksModule`/grading work starts.

### Recorded by

Logged during ULTM8 Phase 0, Task 4 escalation follow-up, 2 Sep 2026. Full discussion in `#ultm8-project`.

---

## Decision 76 — Branch field set mirrors School's field set

**Date:** 2 Sep 2026
**Status:** Approved by product owner
**Resolves:** Spec 55 §12.2 / Domain rules §2/§17/§18 Branch field-level data gap

### Decision

`Branch` carries the same profile field set as `School` — name, address, contact phone, timezone, currency override, branding — in addition to the already-confirmed `id`/`school_id` and its RLS-enforced role as an access boundary for `TimetableSlot`, `Class`, `Instructor`, and `Booking`.

### Effect / open follow-up (not resolved by this decision)

This resolves the field *list*, not the field-level screen — no Branch settings UI has ever been designed (only the sidebar nav item and empty `branchInformation`/`updateBranch` frame ids exist in Figma). A design pass is still needed before this ships end-to-end. **Not** reopened by this decision: `PaymentAccount` stays School-level, always its own (Domain rules §2, unchanged) — Branch mirrors School's *profile* fields only, never its payment relationship.

### Recorded by

Logged during ULTM8 Phase 0, Task 4 escalation follow-up, 2 Sep 2026. Full discussion in `#ultm8-project`.

---

## Decision 77 — Guardian age thresholds legally confirmed: 13/18 final

**Date:** 2 Sep 2026
**Status:** Approved — legal review complete
**Supersedes:** Decision 73 (interim, this file) and Spec 55 §12.2 / Domain rules §14's provisional-pending-legal-review flag

### Decision

Legal counsel reviewed ULTM8's Guardian/minor-account age thresholds — age 13 for limited (read-only) login, age 18 for age of majority/self-registration — across every market ULTM8 operates in, and confirmed both numbers as final. These are no longer provisional. Decision 73's "interim, pending legal review" status is superseded by this decision.

### Citation

Reviewed by: Nick Stockley. Date: 2 Sep 2026. Scope: confirmed to cover all markets ULTM8 operates in. **Reference: not yet provided by the product owner — to be added as a follow-up note to this entry once available (email/memo/notes).** Until a reference is added, this entry rests on the product owner's direct statement, the same standard every other decision in this file is recorded against.

### Effect on existing documents

`skills/ultm8-domain-rules/SKILL.md` §14's `[UNRESOLVED — provisional, pending legal review]` tag on the age thresholds should be updated to `[CONFIRMED]` by the Architect, citing this decision — not edited directly here, per that file's own maintenance rule.

### Recorded by

Logged following the product owner's direct confirmation, 2 Sep 2026.

---

## Decision 78 — E-signature (typed name + drawn signature) legally confirmed sufficient

**Date:** 2 Sep 2026
**Status:** Approved — legal review complete
**Supersedes:** Decision 74 (interim, this file) and Spec 55 §12.2 / Domain rules §13's unevaluated-legal-sufficiency flag

### Decision

Legal counsel reviewed the waiver e-signature mechanism — typed full name plus drawn signature capture (Decision 74), for both Student and Guardian signers — across every market ULTM8 operates in, and confirmed it legally sufficient as designed. No additional mechanism (witness, notarization, an additional consent flow) is required.

### Citation

Reviewed by: Nick Stockley. Date: 2 Sep 2026. Scope: confirmed to cover all markets ULTM8 operates in. **Reference: not yet provided by the product owner — to be added as a follow-up note to this entry once available (email/memo/notes).**

### Effect on existing documents

`skills/ultm8-domain-rules/SKILL.md` §13's `[UNRESOLVED — sharpened, not resolved, by Decision 67]` tag on e-signature legal sufficiency should be updated to `[CONFIRMED]` by the Architect, citing this decision — not edited directly here. Decision 74's own engineering follow-up (drawn-signature capture UI, possible `WaiverSignature` schema change) remains open on its own terms — legal sufficiency and technical implementation are separate questions, and this decision resolves only the former.

### Recorded by

Logged following the product owner's direct confirmation, 2 Sep 2026.

---

## Decision 79 — School creation: self-service, creator becomes Owner/Manager

**Date:** 3 Sep 2026
**Status:** Approved by product owner
**Resolves:** a gap Spec 55/domain-rules/this log never addressed — who is authorized to create a new School (`POST /schools`) and become its first Owner/Manager. The only prior evidence was the `createSchoolProfile` Figma screen (§2.1), which is [OBSERVED IN DESIGNS] only, not a confirmed rule.

### Decision

Any authenticated User may create a School. The creating User is granted `SCHOOL_OWNER_MANAGER` on the new School automatically, in the same transaction as the School row itself — not a separate invite/approval step. Recorded verbatim from the product owner's direct instruction: **"the owner, the person who creates"** [is granted ownership].

### Effect

- Unblocks `POST /schools` for Phase 2's TenantsModule (`apps/api/src/tenants/schools`).
- `School`'s RLS `WITH CHECK` for INSERT (`school_tenant_isolation`, `prisma/migrations/20260903000000_tenants_module_rls/migration.sql`) permits any caller with an established tenant context to create a School, mirroring the existing User self-registration RLS bootstrap pattern (Phase 1). SchoolsService then creates the caller's own `SCHOOL_OWNER_MANAGER` RoleGrant in the same transaction.
- A School created this way has no Franchise link (`franchiseId` is not exposed on the create/update DTOs this phase) — Franchise CRUD and Franchise-affiliation are still out of scope (deferred to pair with Franchise-fee billing, per the Phase 2 task scoping).

### Open follow-up (not resolved by this decision)

Whether School creation should ever require a verification/approval gate (e.g. business/identity verification before a School goes live, billing setup, abuse prevention against unlimited free tenant creation) is not addressed — this decision only settles who may call the endpoint and that ownership is automatic, not whether additional gating should exist before General Availability.

### Recorded by

Logged during ULTM8 Phase 2 scoping, 3 Sep 2026, in direct response to an implementation-blocking question raised while building `TenantsModule`.

---

## Decision 80 — RoleGrant authority narrowed to School Owner/Manager inviting Instructor/Branch Staff (Phase 2 scope only)

**Date:** 3 Sep 2026
**Status:** Approved by product owner — explicitly scoped to what Phase 2 builds, not a claim that the full RoleGrant authority matrix is now resolved
**Resolves:** partially — the RoleGrant authority matrix (who may grant/revoke which role, to whom) remains otherwise unconfirmed; see Effect below.

### Decision

For Phase 2's `POST/DELETE /users/{id}/role-grants` endpoints, only one grantor/role combination is implemented: a School Owner/Manager may grant or revoke `INSTRUCTOR` or `BRANCH_STAFF` within their own School — the one case Spec 55 §8.2 already states explicitly ("Instructor and Branch Staff invitations"). The product owner confirmed this scoping directly: **"the owner... and we verify the accounts"**.

The "we verify the accounts" clause was implemented as: the target User must already have a verified account (`phoneVerifiedAt` set, i.e. completed registration/OTP verification) before a role can be granted to them — `RoleGrantsService.create()`, `apps/api/src/tenants/role-grants/role-grants.service.ts`. **This specific mechanic is a Developer-level interpretation of that instruction, not verbatim from the product owner** — flagged here for confirmation, same as other reasonable-minimum additions in this codebase (e.g. AuthModule's `phoneVerifiedAt` gate itself, Phase 1).

### Effect

- Every other role/grantor combination — School Owner/Manager granting another Owner/Manager, Franchise Owner granting anything, who grants Student or Guardian, etc. — is still genuinely unconfirmed and is rejected (403) rather than built from a guess. The full matrix remains open.
- `RoleGrant`'s RLS gained an additive policy (`rolegrant_school_manager_scope`, `prisma/migrations/20260903000000_tenants_module_rls/migration.sql`) permitting a School Owner/Manager to see/write RoleGrant rows scoped to their own School — this is tenant-boundary enforcement only; the INSTRUCTOR/BRANCH_STAFF-only restriction is enforced in `RoleGrantsService`, not in RLS.

### Open follow-up (not resolved by this decision)

The full RoleGrant authority matrix (every role × every potential grantor) still needs a product-owner decision before it can be built out. The "must be verified first" precondition should be confirmed as an actual rule (or corrected) rather than left as a Developer interpretation.

### Recorded by

Logged during ULTM8 Phase 2 scoping, 3 Sep 2026, in direct response to an implementation-blocking question raised while building `TenantsModule`.

---

## Decision 81 — "We verify the accounts" (Decision 80) applies to the grantor, not the grantee — correction

**Date:** 3 Sep 2026
**Status:** Approved by product owner — corrects a Developer-level interpretation flagged in Decision 80
**Corrects:** Decision 80's implementation of the "we verify the accounts" clause (this file). Decision 80's other content — the INSTRUCTOR/BRANCH_STAFF-only scoping, the RLS additions, the "full matrix still open" framing — is unaffected and stands.

### Decision

The product owner was asked directly whether "we verify the accounts" (Decision 80) meant the target user receiving a role grant, the School Owner/Manager issuing it, or both. Answer: **the School Owner/Manager doing the granting** — not the target/grantee.

`RoleGrantsService.create()` currently checks the *target* user's `phoneVerifiedAt` before issuing a grant (Decision 80's Developer-level interpretation, now confirmed incorrect). It needs to instead check the **calling School Owner/Manager's** own verification status before they're permitted to issue any grant at all.

### Effect

- This is a required code change, not just a documentation correction — `apps/api/src/tenants/role-grants/role-grants.service.ts` currently enforces the wrong party's verification and needs to be updated to check the caller instead.
- Whether the target user's own verification status should *also* matter (e.g. a still-unverified target being granted a role at all) was explicitly not chosen — the product owner selected "the School Owner/Manager doing the granting" specifically, not "both." Don't add a target-side check back in without asking again.
- Worth the Developer confirming, not assuming: if School Owners/Managers are already required to complete phone verification during registration before they can use the API at all (per Phase 1's AuthModule), this check may be structurally redundant in practice — note that explicitly rather than silently treating it as meaningful new gating if it turns out every caller already satisfies it by construction.

### Recorded by

Logged during ULTM8 Phase 2 scoping, 3 Sep 2026, in direct response to a follow-up question the Architect raised after reviewing Decision 80.

---

## Decision 82 — Class.branchId stays nullable (School-wide by default)

**Date:** 4 Sep 2026
**Status:** Approved by product owner — confirms a Developer-level inference flagged for Architect review during Phase 4

### Decision

`Class.branchId` is nullable. A Class may be scoped to one specific Branch, or left School-wide (no Branch) — School-wide is the common case for a School with no Branch structure, and forcing every Class to pick a Branch would break that simple case for no benefit. This mirrors the already-established shape of a School-scoped `RoleGrant` (branchId null = "sees/applies everywhere at this School").

### Effect

No code change — this confirms `apps/api/prisma/schema.prisma`'s `Class.branchId` field and the `class_tenant_isolation` RLS policy's three-way branch match as built in Phase 4, rather than requiring a migration to make it non-nullable.

### Recorded by

Logged during ULTM8 Phase 4 (ClassesModule) finalization, 4 Sep 2026, resolving a design choice flagged in `create-class.dto.ts`'s header comment for Architect review.

---

## Decision 83 — Class.activities must have at least one entry

**Date:** 4 Sep 2026
**Status:** Approved by product owner — confirms a Developer-level inference flagged for Architect review during Phase 4

### Decision

A Class must list at least one activity/discipline; an empty `activities` array is rejected at the DTO layer. A Class with no listed activity has no practical meaning — it can't be discovered by activity filtering, and it can't count toward a Student's rank progress, since that matching is driven entirely by a discipline's `eligibleClassTypes` (domain-rules §5/§9).

### Effect

No code change — confirms `CreateClassDto`'s existing `@ArrayMinSize(1)` on `activities`, rather than relaxing it to allow an empty array.

### Recorded by

Logged during ULTM8 Phase 4 (ClassesModule) finalization, 4 Sep 2026, resolving a design choice flagged in `create-class.dto.ts`'s header comment for Architect review.

---

## Decision 84 — Class.cancellationCharge stored as a minor-unit integer, not Decimal

**Date:** 4 Sep 2026
**Status:** Approved by product owner — confirms a Developer-level inference flagged for Architect review during Phase 4

### Decision

`Class.cancellationCharge` is modeled as an integer in the currency's minor unit (e.g. cents), not a `Decimal`/float. This is the standard way payment systems (Stripe included) store money specifically to avoid floating-point rounding errors, and it's consistent with domain-rules §7's existing rule that Class Pack refunds are "rounded once to the currency's minor unit."

### Effect

No code change — confirms the field as built in Phase 4's schema/migration/DTOs. Establishes the convention for any future money-typed field this codebase adds (e.g. `MembershipPlan.price` when MembershipsModule is built) — minor-unit integer, not Decimal, unless a specific reason argues otherwise.

### Recorded by

Logged during ULTM8 Phase 4 (ClassesModule) finalization, 4 Sep 2026, resolving a design choice flagged in `create-class.dto.ts`'s header comment for Architect review.

---

## Decision 85 — `ultm8_jobs` dedicated Postgres role kept over a `SECURITY DEFINER` alternative

**Date:** 7 Sep 2026
**Status:** Approved — resolves an architectural trade-off flagged during Phase 5's code review

### Decision

`class-occurrence-generation` (and any future no-single-caller background job) continues to run through a dedicated `ultm8_jobs` LOGIN role with its own connection string and narrowly-scoped additive RLS policies, rather than being rewritten around this schema's existing `SECURITY DEFINER` pattern (`ultm8_rls_helper`). Both were genuine, defensible options; the deciding factors: the current design is already tested and proven correct through two full CI-verified rounds (real Postgres + Redis, timezone/idempotency regression tests), it keeps full Prisma type safety for the job's ~15-field `Class` inserts, and its actual credential scope is narrow in practice — no UPDATE/DELETE grants anywhere, read-only SELECT on two lookup tables, INSERT-only on `Class`.

### Effect

No code change — confirms the design as built in Phase 5's migration/`PrismaJobsService`. Establishes the convention for any future no-single-caller job: a dedicated, narrowly-scoped LOGIN role (same shape as `ultm8_auth`/`ultm8_jobs`), not `SECURITY DEFINER` functions — reserve that pattern for the narrow "does X exist" boolean checks it was originally built for.

### Recorded by

Logged during ULTM8 Phase 5 (TimetableModule) follow-up, 7 Sep 2026, resolving a trade-off flagged in the `20260908000000_timetable_module` migration's own header comment for Architect review.

---

## Decision 86 — Stripe Connect account type: Express, not Standard

**Date:** 8 Sep 2026
**Status:** Approved by product owner
**Resolves:** Spec 55 §12.2 open item, quoted verbatim: *"Stripe Connect onboarding fit — Section 10.4 commits to Stripe Connect as the primary model; still to confirm is whether Connect's own onboarding requirements (e.g. Express vs Standard accounts, per-country availability) fit every market ULTM8 plans to launch in... Higher-stakes as of 25 Aug 2026, Pass 4: this choice now also determines who controls a tenant's recurring-payment retry/dunning schedule."* Explicitly listed under the spec's own "12.2 Still open — please advise" heading, not a Developer-level inference — escalated before Phase 8 (PaymentsModule) kickoff rather than built against a guess, given the stakes Section 10.4/10.2 both describe (onboarding-flow code path, per-country business-entity verification requirements, and which party controls dunning/retry configuration).

### Decision

ULTM8 onboards every School's and Franchise's `PaymentAccount` via a Stripe Connect **Express** account, not Standard.

### Why (reasoning offered alongside the recommendation, approved as given)

- Express lets ULTM8 configure a Connected Account's recurring-payment retry/dunning schedule programmatically at onboarding (§10.2/§10.4); Standard leaves that entirely to the account holder's own Stripe Dashboard. Given ULTM8, not the tenant, owns the product experience around a failed Membership/Franchise-fee/SubscriptionPlan charge (the confirmed webhook-driven notification/degradation flows in §10.2), Express keeps that experience consistent across every tenant rather than dependent on each School/Franchise's own Stripe Dashboard configuration.
- §12.2's own market-fit research (Pass 8, Round 3) directly verified Express accounts are available in at least one target market (UAE) for a foreign platform like ULTM8, per Stripe's own current documentation at that time — the only market checked this specifically at the time of the spec's writing.
- Faster, simpler onboarding UX for what's expected to be a largely non-technical School Owner/Manager persona (already the framing Decision 12/§11.5's step-up-MFA reasoning uses for this same role), at the cost of less per-tenant control — an acceptable trade given ULTM8 already positions itself as configuring the payment experience on the tenant's behalf throughout §10.2 (Direct/Destination charges, automated Franchise-fee collection, webhook-driven dunning).

### What this does NOT resolve

- **Per-country onboarding fit beyond UAE** — §12.2's own text is explicit that only UAE was checked directly against Stripe's current documentation as of the spec's writing; other markets in the platform's currency list (GBP/EUR/USD/BRL/MYR regions) haven't been verified the same way. This decision commits to Express as the account type; it does not itself confirm Express onboarding is available/sufficient in every market ULTM8 plans to launch in — that verification still needs to happen per-market before onboarding is enabled there, flagged rather than assumed resolved by this decision.
- **The money-transmission exemption and franchise-disclosure-law legal-review items** (§12.2, unchanged) — this decision is about Connect account type, not about whether ULTM8's use of Stripe destination charges qualifies for money-transmitter exemptions in any given jurisdiction. That legal review remains open, tracked separately.
- **Exact dunning/grace-period timing** — §10.2 confirms *that* Express lets ULTM8 configure the retry schedule programmatically; it does not confirm what that schedule should actually be. Still open, tracked separately (see the Phase 8 kickoff prompt).

### Recorded by

Logged during ULTM8 Phase 8 (PaymentsModule) kickoff, 8 Sep 2026, resolving the Express-vs-Standard item Spec 55 §12.2 flagged as needing direct product-owner input before implementation starts.

---

## Decision 87 — `School.ranksToggle`: a real backend write-gate, not a UI-only hint

**Date:** 9 Sep 2026
**Status:** Approved by product owner (delegated: "check what's best")
**Resolves:** a gap Spec 55/domain-rules/this log never addressed — `ranksToggle` is a confirmed field on School's own profile row (Spec 55 §6.1: "Business name, mobile, address, business type, activities, facilities, ranks toggle, default language/currency..."), already built into this schema since an earlier phase (`ranksToggle Boolean @default(false)`), but nothing in Spec 55's text ever describes what it actually *does* — only that it exists alongside other School Portal profile settings. RanksModule (Phase 10b) is the first real consumer.

### Decision

`School.ranksToggle` is enforced as a real backend gate on every RanksModule endpoint that CREATES or MODIFIES rank data (Discipline/Rank/Skill CRUD, promote/downgrade/stripe-award, skill sign-off) — each checks `ranksToggle === true` first and rejects with 403 otherwise. READ endpoints (`GET .../ranks`, `.../eligibility`, `.../rank-history`) are explicitly unaffected by the toggle.

### Why

No Spec 55 text confirms either direction (real gate vs. UI hint) — this is a genuine product call, not a spec-grounded fact. The reasoning offered and approved: a toggle that's purely cosmetic invites a confusing state where the School Portal UI hides the Ranks nav item while the API keeps silently accepting new rank activity (e.g. a stale mobile app, or a direct API call) — that gap is harder to notice and walk back later than the reverse. Gating reads too was considered and rejected: a School that toggles ranks off shouldn't lose access to its own already-recorded grading history just because the toggle is off today.

### What this does NOT resolve

Whether `ranksToggle` should have any UI-visible consequence beyond hiding a nav item, or whether turning ranks back on after a period disabled should trigger any reconciliation — neither is addressed by Spec 55 and neither is decided here.

### Recorded by

Logged during ULTM8 Phase 10b (RanksModule) kickoff, 9 Sep 2026, resolving a gap this phase's own verification pass surfaced before build — flagged rather than silently defaulted either way, per CLAUDE.md's standing "never invent unspecified business logic" rule.

---

## Decision 88 — StudentRank/StudentRankSkillStatus/PromotionEvent RLS: narrow (School Owner/Manager or self), not broad (any active grant)

**Date:** 9 Sep 2026
**Status:** Approved by product owner (delegated: "what is your advice, do what's best")
**Resolves:** a gap this log never addressed — Spec 55 states an explicit "Branch Staff gets no raw row access" rule for `Membership`/`Transaction` (§8.2), but never says the same, one way or the other, for `StudentRank` and its related grading tables.

### Decision

`StudentRank`, `StudentRankSkillStatus`, and `PromotionEvent` use the same narrow RLS shape Phase 9 built for `Membership`/`Transaction`: a `SCHOOL_OWNER_MANAGER` RoleGrant holder at the row's own `schoolId` gets full read/write; the row's own Student gets read/write of their own rows only; no other role (`BRANCH_STAFF`, `INSTRUCTOR` included) gets any row access at all. Staff functional access (an Instructor checking a Student's rank for class eligibility, the Grading Board) is preserved at the application layer — `TenantAuthorizationService.assertStaffAtSchool()` authorizes the caller, then the read runs under the *target* Student's own tenant context, the same mechanism Phase 9 built for `GET /students/{id}/membership-status` — not by broadening this RLS policy.

### Why

The reasoning offered and approved: `StudentRank`'s actual row contents (`classesAttendedTowardCheckpoint`, per-skill sign-off status) are one specific Student's own record, the same class of "not School-wide catalog data" concern Phase 9's own review already found for `Membership`/`Transaction` — not just "which belt colour," which might reasonably be considered more broadly visible. The absence of an explicit "no raw row access" sentence for `StudentRank` in Spec 55's text is not treated as confirmation that broad access is fine, given how costly the opposite assumption already proved (Phase 9's own review found and fixed a real RLS-shape gap on `Membership`/`Transaction` before merge).

### What this does NOT resolve

Whether `Discipline`/`Rank`/`RankStripeTier`/`Skill` (the catalog data, not `StudentRank` itself) should also be narrowed — they are not; this decision explicitly keeps those on the broader "any active RoleGrant holder at the School" shape `Class`/`TimetableSlot`/`MembershipPlan` already use, since they're School-wide reference data, not a specific Student's own record.

### Recorded by

Logged during ULTM8 Phase 10b (RanksModule) kickoff, 9 Sep 2026, resolving a gap this phase's own verification pass surfaced before build.

---

## Decision 89 — Booking/BookingAttendee/WaitlistEntry RLS: narrow-plus-broad-Staff-read (asymmetric), not narrow alone

**Date:** 9 Sep 2026
**Status:** Approved by product owner (delegated: "do what's best")
**Resolves:** a gap this log never addressed — whether `Booking`/`WaitlistEntry` follow the same narrow "School Owner/Manager or self" shape as `Membership`/`Transaction`/`WaiverSignature`/`StudentRank`, and if so, how Staff (Instructor/Branch Staff, not just Owner/Manager) can ever see a Class's own roster or run a capacity check — something none of those four prior tables needed, since each of their own confirmed read surfaces is scoped to one Student at a time.

### Decision

`Booking`, `BookingAttendee`, and `WaitlistEntry` get TWO additive RLS policies, not one: (1) the same narrow "SCHOOL_OWNER_MANAGER at the row's own schoolId, or the row's own Student" shape as the four prior tables, covering ALL commands; PLUS (2) a second, broad, SELECT-only policy admitting any active RoleGrant holder (SCHOOL_OWNER_MANAGER/BRANCH_STAFF/INSTRUCTOR) at the School, using the same School/Branch three-way structure `Class`'s own policy already established (a School-level grant sees every Branch; a Branch-scoped grant sees its own Branch plus School-wide rows). `BookingAttendee` doesn't repeat this structure itself — it delegates entirely to `Booking`'s own two policies via an `EXISTS` subquery, the same "delegate through the parent's own FORCE RLS policy" pattern `RankRequiredSkill` established in Phase 10b. A Staff WRITE to one specific Student's Booking (cancel-on-behalf-of, the override amendment) still goes through `TenantAuthorizationService.assertStaffAtSchool()` + running the write under the target Student's own tenant context, never through the broad policy.

### Why

Every one of the four prior narrow-RLS tables only ever needed to serve reads scoped to a single Student — a School Owner/Manager sees the ledger, a Student sees their own rows, and Staff functional access is a single-Student lookup handled by the existing target-context mechanism. Booking is different: a Class roster and a capacity/Full check are inherently multi-Student reads that mechanism cannot serve (it authorizes a caller against ONE target Student's context at a time, not "every Student's Booking for this Class"). Rather than broaden the narrow policy itself (which would let Staff also freely UPDATE/DELETE any Student's Booking directly, well past what's actually needed), a second SELECT-only policy keeps writes exactly as narrow as the established convention while unblocking the read Staff genuinely need to run a Class.

### What this does NOT resolve

Whether this same asymmetric shape should retroactively apply to any of the four prior narrow-RLS tables (Membership/Transaction/WaiverSignature/StudentRank) — it should not, and doesn't apply here; none of those four have a confirmed multi-Student Staff read surface the way a Class roster is, so broadening any of them would be inventing a need that hasn't been confirmed.

### Recorded by

Logged during ULTM8 Phase 11 (ClassesModule: booking + waitlist) kickoff, 9 Sep 2026, resolving a gap this phase's own verification pass surfaced before build.

### Addendum — a real gap in this decision's own coverage, found once CI actually exercised it

The broad Staff-read policy above solves the Class-roster/audit read case, but a genuinely separate case surfaced only once the e2e suite ran against real Postgres and returned wrong results rather than an error: the CAPACITY CHECK itself (an ordinary STUDENT's own booking attempt asking "is this Class full?") also needs to see every OTHER Student's Booking/BookingAttendee rows for that Class — and the broad policy only admits Staff roles (`SCHOOL_OWNER_MANAGER`/`BRANCH_STAFF`/`INSTRUCTOR`), not `STUDENT`. Under the policy as originally designed, a plain Student's own tenant context could only ever see their own rows, so `countOccupiedSeats` (and the equivalent waitlist-position lookup) silently undercounted to zero every time — not a rejected query, a WRONG answer, which is why it wasn't caught by RLS itself throwing an error and instead needed the e2e suite's own assertions to surface it. Broadening the read policy further to admit `STUDENT` would have defeated the whole point of Decision 89 (any Student could then read every other Student's raw Booking rows directly). Fixed instead by running those two specific aggregate reads through `PrismaJobsService` (`ultm8_jobs`) — the same RLS-bypassing mechanism already used for the background jobs' own sweeps, reused here from an interactive request path because no policy shape could serve "an aggregate count across all Students, requested by any one of them" without either leaking row-level access or requiring a mechanism RLS itself doesn't offer (aggregate-only visibility). `BookingAttendee` needed a fresh `ultm8_jobs` SELECT grant it didn't have before, added in the same migration.

---

## Decision 90 — Rank-gate enforcement bridges `Class.activities` to `Discipline.name` by exact string match

**Date:** 9 Sep 2026
**Status:** Developer-level inference, flagged for Architect confirmation, not a product-owner-approved decision like 87–89
**Resolves:** nothing this log or `skills/ultm8-domain-rules/SKILL.md` treats as settled — SKILL.md §4 itself states `Class.activities`/`Instructor.specializations`/`Discipline` are "not formally reconciled into one controlled list," and SKILL.md §9's confirmed rank-gate rule ("a Rank/stripe tier's eligibleClassTypes... governs which class types a Student may book") presumes some way to know which Discipline(s) a given Class's booking should be checked against, which nothing else in the confirmed spec text actually supplies.

### Decision

`BookingsService`/`WaitlistService` match each of a Class's `activities` strings against `Discipline.name` at the same School to decide which Discipline(s) to rank-gate a booking attempt against. An `activities` entry with no matching `Discipline.name` has nothing to gate against and is silently allowed through — not a confirmed exemption, simply nothing this bridging heuristic can check. "Cumulative by ladder order" (SKILL.md §9) is read as: every `RankStripeTier` belonging to a lower-ordered `Rank` in the Discipline, plus every tier at or below the Student's own current stripe-tier order within their current Rank.

### Why

Without SOME bridge between the two unreconciled concepts, the confirmed rank-gate rule literally cannot be enforced at all this phase — silently skipping rank-gating entirely would be a bigger, less visible scope gap than a flagged, best-effort string-match heuristic that fails safe (nothing to check, not "check passed"). This is explicitly NOT presented as a resolution of SKILL.md §4's own open item — it is a narrow, local workaround scoped to make Booking's rank gate function at all pending that real reconciliation.

### What this does NOT resolve

SKILL.md §4's own broader question (whether `School.activities`/`Instructor.specializations`/`Class.activities`/`Discipline` should share one controlled list platform-wide) — that remains genuinely open and needs Architect/product-owner attention independent of this phase. This decision also does not make the rank gate reliable for every Class — only for ones whose `activities` values happen to name a real `Discipline` exactly.

### Recorded by

Logged during ULTM8 Phase 11 (ClassesModule: booking + waitlist) kickoff, 9 Sep 2026 — flagged prominently rather than silently built around, per CLAUDE.md's standing "never invent unspecified business logic... mark it explicitly as unresolved and escalate" rule. Surfaced to the product owner in the Phase 11 PR description for explicit awareness, even though it's recorded here as a Developer-level flag rather than a product-approved decision.

---

## Decision 91 — A guest's `whoJoinYou` seat is funded by a Membership belonging to the ORGANIZING Student, not a separately-registered guest account

**Date:** 9 Sep 2026
**Status:** Developer-level inference, flagged for Architect confirmation, not a product-owner-approved decision like 87–89
**Resolves:** a gap this log never addressed — SKILL.md §10's confirmed text ("each additional attendee beyond the Student requires either their own valid Membership or a School-gifted Friend Pass for that specific guest") is ambiguous about WHOSE account a guest's funding Membership lives on.

### Decision

Every `BookingAttendee.membershipId` this phase must reference a Membership whose own `studentId` equals the Booking's own organizing Student — never a separate guest-registered account's Membership. A School-gifted Friend Pass is modeled as a single-use credit the ORGANIZING Student holds and redeems per guest they bring, not a credit issued to the guest's own account.

### Why

Two real constraints pushed this direction, not just convenience: (1) `Membership`'s own RLS policy (Decision-log-established narrow shape, Phase 9) only ever admits the row's own Student or a School Owner/Manager — since `BookingAttendee` creation runs inside the SAME transaction as the Booking, under the ORGANIZING Student's own tenant context (the established Staff-via-target-context mechanism, applied here to the Student's own booking flow), a genuinely separate guest account's Membership row would be invisible to that query entirely, making the "guest's own account" reading unimplementable within one atomic transaction without a materially bigger cross-account consent mechanism nothing in this codebase or spec confirms. (2) The canonical-terminology description of a Friend Pass elsewhere in SKILL.md ("an always-£0, School-gifted guest membership, capped at one guest/one visit") reads naturally as a credit the inviting Student redeems, consistent with real-world guest-pass systems.

### What this does NOT resolve

The alternative reading — a guest who is themselves a separately-registered Student at this School spending their OWN Membership to join someone else's Booking — is NOT built this phase. If that turns out to be the intended behavior, it needs its own confirmed cross-account consent/authorization design, not a guess layered onto this one.

### Recorded by

Logged during ULTM8 Phase 11 (ClassesModule: booking + waitlist) kickoff, 9 Sep 2026 — flagged prominently rather than silently built around, per CLAUDE.md's standing "never invent unspecified business logic... mark it explicitly as unresolved and escalate" rule. Surfaced to the product owner in the Phase 11 PR description for explicit awareness.

---

## Decision 92 — GuardianLink/ConsentRecord: platform-scoped, self-only RLS; multiple Guardians per minor allowed; withdrawal cascade is per-Guardian, not consensus-gated

**Date:** 9 Sep 2026
**Status:** Developer-level inference, flagged for Architect confirmation, not a product-owner-approved decision — this whole area (Guardian/consent) touches minors' data and several sub-questions here have no confirmed answer either way
**Resolves:** several gaps this log never addressed — SKILL.md §14 confirms `ConsentRecord`'s field list, its two-tier model, and the withdrawal-asymmetry rule, but is silent on: (a) the exact RLS shape (only that it's "platform-scoped, not School-scoped" per §16's canonical-terminology gloss), (b) whether more than one Guardian may link to the same minor, and (c) what happens when multiple Guardians hold independent consent for the same minor and one of them withdraws.

### Decision

`GuardianLink` and `ConsentRecord` use a narrow, self-only RLS policy — `guardianId = current_setting('app.current_user_id')`, ALL commands, no School Owner/Manager branch (there is no School to scope to) and no shared-visibility branch at all (unlike `User`'s own schoolId-less policy, which still has a shared-School OR-clause — this is narrower than that established precedent, not identical to it). A `ultm8_jobs` SELECT-only bypass is added to `ConsentRecord` (for Attendance's own interactive scan-time consent check, Phase 13) and a `ultm8_jobs` SELECT+UPDATE bypass to `RoleGrant` (previously ungranted to that role at all) so the baseline-withdrawal cascade can actually write to a linked minor's own `RoleGrant` rows, which the Guardian's own narrow tenant context cannot reach.

Multiple Guardians may link to the same minor — no uniqueness constraint prevents it. Each Guardian's consent is tracked independently (`@@unique([guardianId, studentId, tier])`); withdrawing one Guardian's own baseline consent triggers the full RoleGrant-revocation cascade for that Student regardless of whether another linked Guardian's own baseline consent is still Active.

### Why

RLS shape: every prior narrow-RLS table in this schema (Membership, Transaction, WaiverSignature, StudentRank, Booking, WaitlistEntry) is School-scoped and has SOME broader-visibility branch (Staff-read, at minimum). ConsentRecord genuinely has none of that — no School exists to scope to, and nothing in §14 suggests anyone but the consenting Guardian should see a consent record directly (functional needs elsewhere, like Attendance's own scan-time check, are served by the `ultm8_jobs` bypass instead of broadening interactive-role visibility). Multiple Guardians: real-world co-parenting is a plausible, common case nothing in §14/§17 rules out, and rejecting a second Guardian's link attempt would be a harder mistake to walk back than permitting one. Withdrawal-cascade-is-per-Guardian: the confirmed text ("withdrawing baseline consent triggers the full cascade") is unconditional — inventing a "held back by another Guardian's still-Active consent" exception would be adding a business rule nothing in the spec states, in either direction.

### What this does NOT resolve

Whether a genuinely correct product answer to the multi-Guardian-consent-interaction question is "any one Guardian's withdrawal ends it" (what's built) or "requires all linked Guardians to withdraw" or something else entirely (e.g. only the Guardian who originally created the link can trigger the cascade) — none of this is addressed by Spec 55's confirmed text, and this decision should not be read as having settled it definitively; it's the most literal reading available, not asserted as the only defensible one. Also does not resolve the real data-erasure mechanics behind `account-deletion-processing` (built as a log-only stub this phase) or the age-13 limited-login interaction with consent (both explicitly out of scope, see the Phase 12 kickoff prompt §2).

### Recorded by

Logged during ULTM8 Phase 12 (GuardianModule) build, 9 Sep 2026 — flagged prominently rather than silently built around, per CLAUDE.md's standing "never invent unspecified business logic... mark it explicitly as unresolved and escalate" rule, doubly warranted given the subject is minors' data. Surfaced to the product owner for explicit awareness, not treated as settled.

---

## Decision 93 — Attendance's scan endpoint: synchronous handling, absence-of-consent treated differently from withdrawn consent, StudentRank increment reuses Decision 90's bridge

**Date:** 9 Sep 2026
**Status:** Developer-level inference, flagged for Architect confirmation, not a product-owner-approved decision
**Resolves:** three gaps this log never addressed — SKILL.md §9 lists `qr-attendance-processing` among this codebase's confirmed background jobs, but doesn't say whether the triggering HTTP request should wait for it; §14 confirms withdrawing camera-tier consent blocks self-service check-in, but never addresses a Student who never had a `ConsentRecord` at all (every adult, self-registered Student); and nothing in the confirmed text says what mechanism should determine which `StudentRank` row(s) a successful scan increments.

### Decision

`POST /attendance/scan` performs the confirmed write behavior (mark the matching `Booking` Completed, increment `StudentRank.classesAttendedTowardCheckpoint`) directly inside its own synchronous request handler, not via an enqueued BullMQ job the client waits on. The consent check blocks ONLY on an explicit `WITHDRAWN` camera-tier `ConsentRecord` for the calling Student — the complete absence of any `ConsentRecord` (true for every non-Guardian-linked Student) is treated as "not applicable," not as "blocked." The `StudentRank` increment reuses the exact `Class.activities`-to-`Discipline.name` string-match bridge Decision 90 already established for the rank gate, applied here for a new purpose.

### Why

Synchronous handling: a Student scanning at the door needs immediate pass/fail feedback, which the fire-and-forget/scheduled-sweep shape every other job in this codebase uses doesn't serve well, and no prior job here is enqueued-then-synchronously-awaited from its own triggering request — introducing that pattern for one endpoint was judged riskier than implementing the (simple, fast, already-transactional) confirmed behavior directly. Notably not a lone judgment call: the Phase 12 migration's own `consent_record_jobs_read` policy comment had already anticipated this exact tension and named it explicitly, before this phase was ever built, using the same reasoning Booking's own capacity-check fix (Decision 89's addendum) established. Absence-vs-withdrawal: SKILL.md §14 only ever describes an actual *withdrawal* as the blocking trigger; treating "never granted, never applicable" the same as "withdrawn" would incorrectly lock every adult Student in the system out of self-service check-in, a much larger behavioral change than the confirmed rule describes. StudentRank bridge reuse: rather than inventing a second, potentially inconsistent Class-to-Discipline resolution mechanism, reusing Decision 90's establishes one bridging heuristic used consistently everywhere this schema needs it, with the same known limitation (a Class whose activities don't match any Discipline resolves nothing).

### What this does NOT resolve

Whether `qr-attendance-processing` should genuinely be a queued job in a later revision (e.g. if scan volume or downstream latency ever makes synchronous handling a real problem) — not addressed, and not urgent at current scale. Also does not resolve Decision 90's own underlying gap (`Class.activities`/`Discipline` aren't formally reconciled per SKILL.md §4) — this decision only extends that gap's existing, already-flagged workaround to a second use site, not close it.

### Recorded by

Logged during ULTM8 Phase 13 (AttendanceModule) build, 9 Sep 2026 — flagged prominently rather than silently built around, per CLAUDE.md's standing "never invent unspecified business logic... mark it explicitly as unresolved and escalate" rule.

---

## Decision 94 — AcademiesModule's cross-School discovery reads use a NEW, dedicated `ultm8_discovery` Postgres role — not a further reuse of the `ultm8_jobs` bypass pattern, and NOT (see the review correction below) a policy on the shared `ultm8_app` role

**Date:** 9 Sep 2026
**Status:** Developer-level decision, made in direct consultation with the user (not silently built around), given explicit architectural significance — mechanism corrected before ever shipping, see "FOUND ON REVIEW" below
**Resolves:** a genuine conflict discovered while starting Phase 14 (AcademiesModule) between two prior commitments: (a) the confirmed "mobile-facing discovery (read-optimized view over Tenants/Classes/Memberships)" scope (`nestjs-module` SKILL.md §5), which is definitionally about a caller viewing Schools they have NO RoleGrant at, and (b) `skills/ultm8-tenant-isolation/SKILL.md` §7/§8's explicit, canonical instruction that the chargeback-pattern-restriction job is "the sole confirmed exception [to per-tenant isolation], not a precedent for inventing others."

### Decision

`School`, `Class`, `MembershipPlan`, and `TimetableSlot` each get one new, additive, SELECT-only RLS policy scoped `TO ultm8_discovery` — a genuinely NEW, dedicated Postgres LOGIN role (own connection string `DATABASE_URL_DISCOVERY`, own `PrismaDiscoveryService`, exactly the shape `ultm8_jobs`/`ultm8_auth` already established for "a caller population that legitimately needs to read outside the normal per-caller RLS shape"), used ONLY by `AcademiesService` — no other module ever connects as this role. Each policy admits a row regardless of whether the caller holds a RoleGrant at that specific School (`MembershipPlan`'s and `TimetableSlot`'s policies additionally require `visible = true` / `status = 'ON'` at the row level, not just in the application query). Column-level visibility is ALSO restricted at the database layer — an explicit Postgres `GRANT SELECT (col1, col2, ...)` per table, naming exactly the curated, discovery-appropriate columns `AcademiesService`'s own `select` clauses use — so a future query against these tables through this role that omits or misnames a column fails with a Postgres permission error rather than silently returning (or silently continuing to withhold) data. This mirrors the chargeback job's own governing principle (SKILL.md §7) more faithfully than merely a service-layer convention would: a party outside the normal isolation boundary sees only a curated, deliberately narrow result, enforced at the layer closest to the data.

This is explicitly NOT a further reuse of the `PrismaJobsService`/`ultm8_jobs` bypass pattern that Booking's capacity check (Decision 89) and ConsentRecord's Attendance check (Decision 92/93) rely on. Both of those stayed within one School (a caller's own School's Class occupancy; a caller's own consent record) — a narrower, same-tenant RLS-visibility gap, not a tenant-boundary crossing in the sense `ultm8-tenant-isolation` SKILL.md §7/§8 mean. AcademiesModule's requirement — viewing OTHER Schools entirely — is a genuine tenant-boundary crossing, and reusing the jobs-bypass role for it (routing an open-ended, interactively-triggered, unbounded enumeration through infrastructure meant for background jobs and narrow same-tenant aggregate reads) was judged the wrong mechanism, independent of the isolation-boundary question itself.

### FOUND ON REVIEW, BEFORE THIS EVER SHIPPED — the first draft's mechanism was a real, severe mistake

The reasoning above (new mechanism, not another `ultm8_jobs` reuse) was correct; its first implementation was not. The first draft scoped all four new SELECT policies `TO ultm8_app` — the SAME Postgres role every other interactive query in this entire codebase already runs under via `PrismaAppService.withTenantContext`, not a role unique to `AcademiesModule`. Postgres combines multiple PERMISSIVE policies for the same role+command with OR, so that draft didn't just widen visibility for the new `/academies` routes — it silently widened SELECT visibility on `School`/`Class`/`MembershipPlan`/`TimetableSlot` for EVERY existing endpoint that queries those tables as `ultm8_app` (`SchoolsService.findOne`/`findAllForCaller`, `ClassesService.findOne`/`findAllForSchool`, `TimetableService.findOne`/`findAllForSchool`, `MembershipsService.findOnePlan`/`findAllPlans`), each of which relies on RLS alone (no explicit RoleGrant check in application code) to return null/404 for a School the caller can't see. This would have silently broken those endpoints' own tenant isolation — including reopening exactly the fields (`School.mobileNumber` among them) `AcademiesModule` itself was built to keep curated — and contradicted existing e2e assertions in `classes.e2e-spec.ts`/`timetable.e2e-spec.ts` that a caller with no RoleGrant gets a 404, not another tenant's row.

Caught by this PR's own high-effort, 8-angle code review before any commit — three independent finder angles (line-by-line, cross-file tracer, altitude) converged on the identical root cause. Fixed by moving to the dedicated-role design described in "Decision" above (which is what actually shipped), plus adding the column-level GRANT backstop, plus a new e2e regression-guard test (`academies.e2e-spec.ts`) that directly proves the same caller/School pair still gets 404 from `GET /schools/:id`, `GET /schools/:id/classes`, and `GET /schools/:id/timetable` — so this exact regression can never ship silently again. Recorded here in full, not silently corrected, per this project's own standing discipline of flagging what review caught rather than quietly fixing it (same treatment the Phase 11/12 migrations gave their own "FOUND ON REVIEW" fixes).

### Why

§8's own text is unambiguous that inventing a new cross-tenant exception requires deliberate, narrow, audited design — not silent reuse of an existing bypass for a materially different, bigger use case. A curated public school directory is a standard, well-precedented pattern even in strict multi-tenant systems (the isolation model exists to protect one tenant's private operational data from another tenant, not to prevent a platform from ever showing any tenant's public storefront to a browsing end user) — holding Phase 14 indefinitely for a literal Architect sign-off that has no defined mechanism to obtain in this session was judged not practically actionable, so this was raised directly with the user instead, who concurred with proceeding on this basis rather than holding the phase or silently building it either way.

### FOUND ON CI, on this migration's own first real run — a second correction, smaller than the one above

The dedicated-role design fixed the severe cross-module leak, but its own first CI run against real Postgres failed `GET /academies/:id`/`GET /academies/:id/timetable` with `permission denied for table RoleGrant`. Root cause: School/Class/MembershipPlan/TimetableSlot's own PRE-EXISTING `_tenant_isolation` policies (present since the init migration and Phase 5/7/9) were never written with an explicit `TO ultm8_app` — Postgres defaults an omitted `TO` to `PUBLIC`, so those policies apply to every role, `ultm8_discovery` included, and get OR-combined with the new `_discovery_read` policies. Postgres requires the connecting role to hold SELECT on every table any COMBINED policy expression references — including a policy whose branch will simply evaluate false — not just the branch that actually admits the row; each of those four tables' own tenant_isolation policy does an inline `EXISTS (SELECT 1 FROM "RoleGrant" ...)`, and `ultm8_discovery` had no grant on `RoleGrant` at all. Fixed with one additional narrow grant — `GRANT SELECT (schoolId, userId, revokedAt, branchId) ON "RoleGrant" TO ultm8_discovery` — scoped to exactly the columns those four pre-existing policies' own EXISTS subqueries reference, same column-level discipline as the rest of this migration. Recorded here, not silently patched, same as the mechanism correction above.

### What this does NOT resolve

Whether `ultm8-tenant-isolation` SKILL.md's own text should eventually be updated to name this as a second confirmed exception alongside the chargeback job (only the Architect agent is supposed to edit that file directly, per its own header) — this decision log entry is the flag for that, not a substitute for the Architect's own update. Also does not resolve the file's separate, pre-existing staleness: it does not currently acknowledge Decision 89's or Decision 92/93's own `ultm8_jobs`-bypass-from-an-interactive-request-path usage at all, a documentation gap independent of and predating this phase, surfaced here for the same reason. Also does not resolve the authentication-scope question raised in the Phase 14 kickoff prompt (§3) — whether discovery should eventually be genuinely public/unauthenticated — which remains a separate, unbuilt, Architect-level decision. Also does NOT resolve — flagged here as a genuinely open question this phase surfaced but did not investigate — whether the identical "PUBLIC-scoped tenant_isolation policy needs the connecting role to hold SELECT on RoleGrant purely to evaluate, even on an unrelated OR branch" issue is or was ever live for `ultm8_jobs`'s own pre-existing School read (`school_jobs_read`, Phase 11): that policy shipped one migration before `ultm8_jobs` was first granted SELECT on RoleGrant (Phase 12), which by this same mechanism should have hit an identical permission error, yet Phase 11's own CI run passed. Not reproduced or explained here — noted for whoever next touches this area, not asserted as a confirmed bug.

### Recorded by

Logged during ULTM8 Phase 14 (AcademiesModule) kickoff, 9 Sep 2026, after stopping mid-kickoff to surface this conflict to the user directly rather than resolving it alone or silently building around it, per CLAUDE.md's standing "never act on an assumption — verify, then verify again, then ask" and "never invent unspecified business logic... mark it explicitly as unresolved and escalate" rules.

---

## Decision 95 — NotificationsModule (Phase 15): scope narrowed to real, working email delivery + DeviceToken registration; push dispatch and the full trigger catalog deliberately deferred

**Date:** 9 Sep 2026
**Status:** Developer-level scoping decision, not a product-owner-approved decision — flagged for Architect review same as every other reasonable-minimum scoping call in this codebase
**Resolves:** how much of NotificationsModule's confirmed-but-thin spec surface (Spec 55 §6.1 page 27, §7 page 32, §9, §11.4 pages 45-46) to build in one phase, given the entity itself is minimal (three fields) but the infrastructure it implies (two push vendors, two email vendors with fallback, a dozen scattered trigger sites across other jobs) is large.

### Decision

Built this phase: the `Notification` and `DeviceToken` entities (field lists directly from Spec 55 §6.1, quoted in the migration/schema comments); `GET /notifications/me`, `PATCH /notifications/{id}/read` (the two confirmed endpoints); `POST /notifications/device-tokens` and `DELETE /notifications/device-tokens/{id}` (Developer-level additions — DeviceToken needs some write path and §7's own table names none, same treatment `User.phoneVerifiedAt` already established); a real, working `NotificationDeliveryService` for email (Postmark primary, AWS SES fallback — §11.4's confirmed decision, implemented against the real SDKs, not stubbed); the `notification-fanout` BullMQ job (§9's confirmed job) as the single place every trigger's fan-out actually happens; and ONE real trigger wired end-to-end — `WaiverSignatureRequestsProcessor`, previously a log-only stub explicitly waiting for this module to exist, now enqueues a real `notification-fanout` job per Student at the School, using §9's own confirmed sample text verbatim.

Deliberately NOT built this phase: push dispatch (the actual FCM/APNs send) — `DeviceToken` registration is real and ready, but sending to it is not, since two full vendor integrations on top of the two email vendors already built was judged too large for one coherent phase; the rest of the trigger catalog (payment-failed, waitlist-promotion, chargeback-pattern-restriction, and any others whose "Notification samples" text scattered through §9/§10/§12.1 was surfaced by this phase's own spec research but not wired) — each is a small, mechanical addition once `notification-fanout` exists, left for natural, low-risk fast-follow work rather than expanding this phase's own review surface; per-notification-type preference/opt-in granularity (never designed anywhere in Spec 55 beyond a blanket push/email toggle); and the "surfaced to Platform Admin" dead-letter behavior for a total delivery failure (logged loudly instead — PlatformAdminModule doesn't exist yet).

### Why

Building all four vendor integrations (FCM, APNs, Postmark, SES) plus the full scattered trigger catalog in one phase would have made this phase roughly 3-4x the size of any prior phase in this codebase, with a proportionally larger review surface and correspondingly higher risk of the kind of severe design mistake Phase 14's own review caught (see Decision 94's "FOUND ON REVIEW" section) going unnoticed in the noise. Splitting delivery into "one real, complete channel now" (email) and "the data model ready, dispatch deferred" (push) follows the same discipline this codebase already used for Stripe (Connect-only in Phase 8, the tenant-scoped client added only once Phase 9 had a real caller for it) and Twilio (OTP-only, never generalized to arbitrary SMS). Wiring exactly one real trigger end-to-end (rather than zero, or all of them) proves the whole pipeline — entity write, email delivery, HTTP read-back — actually works over real infrastructure, not just in isolation; the remaining triggers are the same three-line addition to their own job's `process()` method, with no new module-level risk.

### What this does NOT resolve

Whether push dispatch should be its own Phase 15b or folded into a later phase; the remaining trigger catalog (payment-failed, waitlist-promotion, chargeback-pattern-restriction, account-deletion) staying unwired until a future phase touches each; per-notification-type/channel preferences; the "surfaced to Platform Admin" dead-letter requirement, blocked on PlatformAdminModule existing at all.

### FOUND ON REVIEW, BEFORE THIS EVER SHIPPED — a high-effort, 8-angle review caught real defects, corrected below, plus one major pre-existing gap unrelated to this phase's own code

The first draft's *scope* boundary (above) held up; several things inside that boundary did not. Corrected before commit, not silently:

- **DeviceToken cross-user "reassignment" was never actually reachable.** The first draft used a plain `upsert` keyed on `token` and claimed a token already owned by a different User would be silently reassigned to whoever re-registers it — a genuinely invented, unescalated business rule (CLAUDE.md's standing "never invent unspecified business logic... escalate" rule), and, separately, factually wrong: DeviceToken's self-only RLS means Postgres's `ON CONFLICT DO UPDATE` can't see a row belonging to someone else, so the real behavior would have been an unhandled `unique_violation` 500, not a reassignment. Rewritten as self-scoped `updateMany` (same-User re-registration succeeds) falling back to `create`, with a genuine cross-user conflict now a controlled `409 Conflict` — no reassignment behavior is built at all, since nothing confirms it should be.
- **Notification feed order was effectively random, not chronological.** `Notification.id` is a random UUID; the shared `cursorPaginate` helper every other list endpoint in this codebase correctly uses always orders by `id asc`, which is fine when row order is otherwise immaterial and actively wrong for a notification inbox. `NotificationsService.findAllForCaller` now implements its own keyset pagination ordered by `(createdAt, id)` descending, with a matching composite index (`Notification_userId_createdAt_id_idx`) replacing two indexes that matched neither the old nor the new query shape.
- **The email-fanout retry story was fictional.** The first draft's `NotificationFanoutProcessor` swallowed every delivery failure in a try/catch and claimed parity with `OtpDeliveryProcessor`'s real retry-then-log-loudly precedent without actually having any `attempts`/`backoff` configured anywhere, and the per-Student enqueue loop (`waiver-signature-requests.processor.ts`) had no retry policy either, meaning a transient failure partway through a School's fan-out silently, permanently dropped the remaining Students with no log entry anywhere. Now genuinely real: every enqueued `notification-fanout` job carries a deterministic `notificationId` (`waiver-${waiverId}-${userId}`), used as both the BullMQ `jobId` (dedup) and the Notification row's own primary key (`upsert`, not `create` — idempotent), so the job can safely retry (`attempts: 3`, exponential backoff) all the way through email delivery without ever duplicating the in-app row; both processors now have a real `@OnWorkerEvent('failed')` handler matching `OtpDeliveryProcessor`'s own precedent, logging loudly only once retries are exhausted.
- **The per-Student enqueue loop used N sequential Redis round-trips.** Replaced with `Queue.addBulk()` — one pipelined call, same per-recipient job granularity (deliberately unchanged — `booking-no-show-processing.processor.ts`'s own "FOUND ON REVIEW" precedent already established that deduping fan-out into fewer jobs silently under-delivers).
- **`GRANT SELECT ON "User" TO ultm8_jobs` was whole-table.** Every other `ultm8_jobs` grant in this schema is whole-table too (an accepted, pre-existing characteristic of that shared role, not something this migration should unilaterally restructure) — but `User` is the one table in this schema carrying a literal login credential (`passcodeHash`) alongside other PII no `ultm8_jobs` consumer has ever needed, and this one doesn't either. Narrowed to `GRANT SELECT ("id", "email")`.
- **`NotificationDeliveryService`'s final error on total failure was misleading in two real, reachable cases** (Postmark-only configured and failing reported "no provider configured"; SES-only configured and failing reported "both providers failed" when Postmark was never attempted). Rewritten to track exactly which providers were actually tried.
- **Two Developer-level inferences were left unflagged**, unlike every sibling inference in the same diff: the DeviceToken re-ownership behavior above (now moot — no reassignment is built), and whether building DeviceToken registration at all, ahead of push dispatch, repeats the exact "speculative infrastructure ahead of a real caller" mistake `StripeClientService`'s own header comment describes removing from an earlier Phase 8 draft. Resolved as NOT the same case (real e2e coverage this draft didn't have; a narrow, confirmed-entity-derived shape; and a mobile client needs somewhere to register a token as soon as it builds notification-permission UI, well before server-side dispatch is wired) — reasoning now recorded in the `DeviceToken` model's own comment, not just asserted here.
- **The async fan-out test's own claim was wrong, and its original design was needlessly flaky.** It called itself "the first async-job-driven e2e test in this codebase" — `class-occurrence-generation.e2e-spec.ts` already established a deterministic, Redis-free precedent (instantiate the processor directly, call `.process()` against a fake `Job`) that the original draft didn't use, instead driving the whole pipeline through real HTTP + a live worker + a bounded 15s poll. Rewritten to follow the established precedent, and extended with two regression assertions the original lacked: a Student with a **revoked** RoleGrant at the same School, and a Student at a **different** School, are both confirmed excluded from the fan-out — the exact class of tenant-isolation regression Decision 94's own dedicated test exists to catch, now covered here too.

**A major, pre-existing gap this phase's review surfaced but did NOT introduce and does NOT fix**: no endpoint anywhere in this codebase actually creates a `STUDENT` RoleGrant. Every `roleGrant.create` call site in the real application code grants only `SCHOOL_OWNER_MANAGER` (self-service School creation) or `INSTRUCTOR`/`BRANCH_STAFF` (`RoleGrantsService`'s invite flow, restricted to those two roles) — confirmed by grepping every call site, not inferred. Every e2e spec across every phase since Phase 9 that exercises Student-gated behavior (Memberships, Waivers, Ranks, Booking, Attendance, Guardians, and this one) seeds a `STUDENT` RoleGrant directly with a superuser Prisma client, bypassing the app entirely. In a real deployment today, `WaiverSignatureRequestsProcessor`'s own `studentGrants` query — correct as written — would always return empty, because no real Student can currently come to hold that role at all: **there is no "join/enroll at a School as a Student" flow anywhere in this API.** This predates Phase 15 by many phases and isn't this phase's to fix (designing that flow — self-service, a School-issued invite/QR code, membership-purchase-triggered, or something else — is a real, undesigned feature of its own, not a one-line addition), but this is the first phase whose own stated purpose (a working end-to-end notification pipeline) actually depends on it in production, not just in tests, which is why it's surfaced this prominently rather than left as a background assumption.

### FOUND ON CI — a genuinely new class of cross-test-file interaction this phase introduces, fixed in the affected files, worth understanding for future phases

`WaiverSignatureRequestsProcessor` going from a log-only stub to a real trigger means `POST /schools/{id}/waivers` now has a real, live side effect it never had before: a background worker (consuming CI's real, shared Redis) writes real `Notification` rows for every Student at that School, asynchronously, outside the triggering request's own control. `waivers.e2e-spec.ts` and `bookings.e2e-spec.ts` — both pre-existing, unrelated to this phase, both create a Waiver for Students already fixture'd — started failing their own `afterAll` cleanup with `Notification`'s `ON DELETE RESTRICT` foreign key blocking the final `user.deleteMany`, because neither file's cleanup (written long before Notification existed) knew to delete the new rows first. Not a race with another test FILE — CI runs e2e specs `--runInBand` (already documented in `.github/workflows/ci.yml`, unrelated to this phase), so this is purely an in-file timing gap between "the async job had time to write its row" and "this file's own cleanup ran." Fixed in both files by querying for every User the file itself created (via the same email-substring pattern each file's own final cleanup step already trusts, not a hand-maintained id list — `bookings.e2e-spec.ts` in particular creates at least one additional Student dynamically mid-suite that a hardcoded list would have missed) and deleting their `Notification` rows first, the same pattern `notifications.e2e-spec.ts`'s own `afterAll` already used. **Any future phase that makes another currently-inert job (there are others still log-only or scheduled-only) into a real trigger should expect the same class of surprise** in whichever existing e2e specs happen to exercise that trigger's own precondition — worth a quick grep for the trigger's precondition (here, "creates a Waiver for a School with Students") across `test/*.e2e-spec.ts` before assuming only the phase's own new test file needs updating.

### Recorded by

Logged during ULTM8 Phase 15 (NotificationsModule) build, 9 Sep 2026, as part of the standing "verify against the spec, then verify again" discipline before committing to a scope — the entity/vendor/trigger research behind this phase came from a dedicated pass through the canonical Spec 55 PDF (§6.1, §7, §9, §11.4, §12.2), not the older, less complete `ultm8-domain-rules` summary, which doesn't mention Notification at all.

---

## Decision 96 — Self-service Student enrollment: `POST /schools/:id/join`, an adult caller joining on their own behalf only

**Date:** 9 Sep 2026
**Status:** Product-owner decision, made directly with the user after this gap was surfaced during Phase 15's own code review — not a Developer-level guess
**Resolves:** a major, pre-existing gap Phase 15's review found (see Decision 95's own note): no endpoint anywhere in this codebase ever created a `STUDENT` RoleGrant. Every e2e test since Phase 9 seeded it directly via a superuser Prisma client; no real person could ever become a Student at a School through the actual API.

### Decision

`POST /schools/:id/join` — a self-service endpoint, no request body, callable by any authenticated User. The caller is granted `STUDENT` at the target School (schoolId set, branchId null — Students are consistently School-scoped everywhere else in this codebase, never Branch-scoped) and, on success, receives a freshly-minted access token reflecting the new grant (same narrow "JWTs only rebuild at login" exception `SchoolsService.create()` already uses for self-service School Owner creation, ultm8-nestjs-module §7). Idempotency: attempting to join a School the caller already holds an active `STUDENT` grant at is a `409 Conflict`, not a silent no-op or a duplicate grant.

Presented to the user as three options — self-service join, a School-issued invite (mirroring the existing Instructor/Branch Staff invite flow), or enrollment triggered by a Membership purchase — with self-service recommended and chosen. Reasoning: (1) AcademiesModule (Phase 14) exists specifically so a caller can discover a School they hold no grant at; self-service join is the missing step that discovery was built to lead into — an invite-only flow would leave that confirmed feature with nowhere to go. (2) `MembershipPlan.type` includes a first-class "Trial Membership" value, and nothing confirms a browsing caller must pay before joining or attending a trial class — tying enrollment strictly to a purchase would also require re-examining whether `MembershipsService.purchase()`'s own authorization already assumes an existing RoleGrant, a separate question not worth entangling with this fix. (3) It's the same shape already established for School Owner self-service creation — no new invite/approval infrastructure, one RoleGrant write.

### Why this needed a genuinely different RLS path than every other RoleGrant-creating flow

Every existing RoleGrant-creation call site (`SchoolsService.create()`, `RoleGrantsService.create()`) verifies the target School's existence via the caller's own tenant context (`PrismaAppService.withTenantContext`) — which works there because the caller already holds a grant at that School (they're creating it, or they're the School Owner inviting someone). Self-service Student join is the first RoleGrant-creating flow where that's never true by definition: the whole premise is a caller with ZERO grant at the target School. Their own `ultm8_app` context genuinely cannot see that School (the exact gap AcademiesModule's own dedicated `ultm8_discovery` role exists to close, Decision 94) — reusing `withTenantContext` for the existence check here would have 404'd on every real School, since a caller can't have discovered a School whose id they're guessing.

**FOUND ON REVIEW, BEFORE THIS EVER SHIPPED — the first draft's mechanism was a real mistake, corrected before merge.** That draft resolved the existence-check problem by injecting `PrismaDiscoveryService` (Phase 14's own dedicated role, provisioned specifically and exclusively for AcademiesModule) directly into `SchoolsService`. That service's own header comment is explicit and was not followed: *"ONLY AcademiesService may inject this... add that module's own narrowly-scoped role/policy, the same way this one and ultm8_jobs each did, rather than reusing this connection for an unrelated purpose."* Four independent review angles converged on this same finding — reusing a role/policy set shaped for a different module's needs quietly couples `join()`'s own correctness to whatever AcademiesModule does with its own connection in the future, with no dedicated audit trail marking `SchoolsService` as a second reviewed consumer.

The actual fix needed no new role, no new connection, and no coupling to AcademiesModule at all: this schema already has an established, purpose-built pattern for exactly this problem — "does a row exist that the caller's own RLS context can't already see" — `school_has_any_role_grant` (20260906000000), a `SECURITY DEFINER STABLE` function owned by the existing `ultm8_rls_helper` role (created Phase 2), reading unfiltered via `BYPASSRLS`. The student-self-enrollment migration adds `school_exists()`, mirroring that exact shape for a plain existence check, called directly from `SchoolsService.join()` via a parameterized `tx.$queryRaw` — the same raw-query pattern `bookings.service.ts`/`waitlist.service.ts` already use for `SELECT ... FOR UPDATE` — from INSIDE the caller's own `ultm8_app` transaction, not a separate connection. This is narrower than the first draft, not broader: `school_exists()` returns a boolean, nothing else, and grants `EXECUTE` only, versus a full connection with column-level `SELECT` on curated fields.

The RoleGrant INSERT itself needed no bypass either way: `rolegrant_self_only` already admits a caller writing a row under their own `userId`, regardless of School-level access, since it was never School-scoped to begin with. It also needed no separate check-then-insert query — see the migration's own `RoleGrant_one_active_student_per_school` partial unique index, which makes the idempotency guarantee below a real DB constraint rather than a race-prone application-level check (also found on this same review pass: the first draft's check-then-insert had a genuine TOCTOU window).

### What this does NOT resolve

Deliberately narrow — this decision and its implementation cover only an ADULT caller joining a School on their own behalf. Explicitly NOT built: how a Guardian enrolls a linked minor at a School (GuardianLink is platform-scoped, not School-scoped, per Decision 92 — a minor's own account creation via `GuardiansService.createMinor()` does not itself enroll them anywhere; enrolling a minor is a genuinely separate cross-user-write question, the same shape Guardian's own consent-withdrawal cascade already solved once via `ultm8_jobs`, not solved here). Also does not resolve whether a School should ever be able to restrict/reject self-service joins (nothing confirms this is wanted, and building an approval gate nobody asked for would be its own invented business logic) — if a School ever needs to control its own roster, that's a new, separate decision, not a retrofit onto this endpoint.

### Recorded by

Logged during a direct, live exchange with the user, 9 Sep 2026, after Phase 15's own review surfaced this gap — options presented, a recommendation given, and the user's choice ("what do you suggest") followed, same pattern as Decision 94's own resolution.

---

## Decision 97 — Franchise CRUD: self-service creation (Decision 79, extended to Franchise), scope, and the explicit deferral of Franchise-reaffiliation/billing-continuity

**Date:** 10 Sep 2026
**Status:** Product-owner decision, made directly with the user
**Resolves:** Phase 2's own deliberate deferral ("Franchise CRUD and Franchise-affiliation are still out of scope — deferred to pair with Franchise-fee billing, per the Phase 2 task scoping") and the "practically unreachable" flag on `PaymentsService.createForFranchise`/`findForFranchise`/`assertFranchiseOwner` (Phase 8) and `GrantableRoleDto`'s FRANCHISE_OWNER exclusion note — all of which explicitly named "no FranchisesController/FranchisesService exists" as the reason FRANCHISE_OWNER had no self-service path.

### Decision

`POST /franchises` — self-service Franchise creation, no invite/approval step: any authenticated User may create a Franchise and is granted `FRANCHISE_OWNER` on it atomically, in the same transaction as the Franchise row itself. This is Decision 79 (School self-service creation) applied to Franchise directly, confirmed with the user this phase ("Same as School: self-service") rather than re-derived independently — same rationale: no invite authority for this role is confirmed anywhere, and Franchise Owner is meant to be the *bootstrapping* actor, not someone granted by another actor.

Scope this phase: create / read (list-for-caller + single) / update — no delete (same "general tenant offboarding is `[UNRESOLVED]`" reasoning `SchoolsService`/`BranchesService` already apply), plus `GET /franchises/{id}/schools` (the Franchise Owner's own School roster — a purpose-built, ownership-validated read across the tenant boundary, confirmed as its own endpoint by `ultm8-nestjs-module` §5 and flagged as deliberately excluded from RLS itself since Phase 1's own `school_tenant_isolation` policy comment). `RoleGrantsService`/`CreateRoleGrantDto` are untouched — Decision 80's authority matrix ("Franchise Owner granting anything... is still genuinely unconfirmed and is rejected") stands; FRANCHISE_OWNER is granted only via this new self-service create path, never through the generic role-grant-invite endpoint.

`PaymentsService.createForFranchise`/`findForFranchise` (Phase 8) both gain a `FranchisesService.findOne()` call, closing the exact gap their own Phase 8 comments flagged ("No FranchisesService.findOne() exists yet... flagged, not silently assumed away") — a nonexistent `franchiseId` now correctly 404s before authorization is even checked, matching `createForSchool`/`findForSchool`'s existing shape.

### Explicitly out of scope — Franchise-reaffiliation / billing-continuity

Separately, in the same conversation, the user asked why self-service Franchise-Owner creation was recommended over an alternative, then gave explicit direction on a genuinely different question this phase does NOT resolve: what happens to a School's `PaymentAccount`, `MembershipPlan` set, and `FranchiseFeeCharge` history if it leaves one Franchise for another, or becomes independent (the existing `[UNRESOLVED]` item in `skills/ultm8-domain-rules/SKILL.md` §2/§17, Spec 55 §12.2). The user's own words: *"Out of scope for now, proceed with Phase 16. Bring this issue up when project is done so we can revisit."* This is deliberately NOT invented here — no Franchise-reaffiliation endpoint, no automatic School-to-Franchise re-linking, and no billing-continuity logic of any kind is built this phase or any phase before project completion, per this direct instruction. Flagged here, not silently dropped, so the "revisit at project end" commitment has a durable record — the same "mark unresolved, escalate, don't guess" discipline this codebase applies everywhere else, just with an explicit revisit trigger instead of an open-ended one.

### What this does NOT resolve

The Franchise-reaffiliation/billing-continuity question above (explicitly deferred to project completion, not this phase). Also unresolved, unchanged from Phase 2's own note: whether a School under a Franchise can hold its own `PaymentAccount` distinct from the Franchise's (domain-rules §2) — `PaymentAccount`'s existing polymorphic School/Franchise ownership shape (Phase 8) is untouched by this phase. `FranchiseFeeCharge` itself (the entity, the `/payments/franchise-fees/*` endpoints, and the `franchise-fee-usage-reporting` job) is also not built in this same change — Franchise CRUD is the prerequisite a real Franchise-fee charge needs to exist against at all (a `FranchiseFeeCharge` needs a real `Franchise` row and a real `School↔Franchise` relationship to reference), and is scoped as a distinct follow-on within Phase 16, not bundled into this PR.

### FOUND ON REVIEW, before this ever shipped — a critical RLS bug, caught before merge

The high-effort multi-angle code review run before this PR opened caught a real cross-tenant data exposure in the first draft's migration, independently confirmed by three of the eight review angles (line-by-line scan, cross-file tracer, and altitude/root-cause). The first draft's `franchise_tenant_isolation` RLS bootstrap fix (Part B — the widening needed so `FranchisesService.create()`'s own `INSERT ... RETURNING` can see the row it just inserted, before the owner `RoleGrant` commits) copied only `20260905000000_phase2_grant_and_bootstrap_fixes`'s School-side fix, missing that School's own history didn't stop there: that exact shape (`OR NOT EXISTS (SELECT 1 FROM "RoleGrant" rg WHERE rg."schoolId" = "School"."id")`) was itself a real, shipped bug — a negated existence check against an RLS-protected table, run as `ultm8_app` rather than `BYPASSRLS`, is itself filtered by that table's own policies, so "no RoleGrant references this row at all" silently degrades to "no RoleGrant references this row that I can already see" — unconditionally true for every OTHER tenant's row, not just the intended brief bootstrap window. `20260906000000_fix_school_notexists_rls_blindspot` fixed this for School via a `SECURITY DEFINER`/`BYPASSRLS` helper function (`school_has_any_role_grant`); the first Franchise draft reintroduced the pre-fix shape verbatim, which — left as drafted — would have let any authenticated caller read any Franchise's full row via `GET /franchises/{id}` or list every Franchise in the system via `GET /franchises`, regardless of ownership.

Fixed before merge by mirroring `20260906000000`'s actual fix, not just its earlier, disproven attempt: a new `franchise_has_any_role_grant()` `SECURITY DEFINER STABLE` function, owned by the existing `ultm8_rls_helper` role, reading `RoleGrant` unfiltered via `BYPASSRLS`. The review also flagged a related but distinct concern on `schools_for_franchise()` (the Franchise-Owner-School-roster mechanism) — that function returned full School rows via a bare `SELECT *` with `EXECUTE` granted to the general-purpose `ultm8_app` role and no authorization logic of its own, unlike its two cited precedents (`school_exists()`, which only ever returns a boolean with nothing to leak; and `AcademiesModule`'s `PrismaDiscoveryService`, which layers a dedicated role, curated column grants, and its own RLS predicates) — safe only because the one call site that existed happened to check ownership first, not because the function itself was safe to call from anywhere. Fixed the same way: `schools_for_franchise()` now takes the caller's id as a parameter and re-derives `FRANCHISE_OWNER` ownership itself via the same `BYPASSRLS` read, making authorization data-layer-enforced rather than caller-trusted — `FranchisesService.findSchoolsForFranchise()` no longer needs (and no longer makes) the separate, now-redundant `assertFranchiseOwner()` call it originally had, since the SQL function itself is a stronger, harder-to-bypass guarantee than the app-layer check it replaced.

A second, lower-severity redundancy the same review surfaced (three angles: reuse, efficiency, simplification) applies generally to Franchise, not just this one endpoint: `School`'s RLS admits any role holder (Student, Instructor, Staff, Owner alike), so `SchoolsService.findOne()` succeeding never implies Owner — `createForSchool`'s existing `findOne()`-then-`assertSchoolOwner()` pairing is two genuinely independent checks. `Franchise`'s RLS is already Owner-only (`FRANCHISE_OWNER` is the only `Role` value ever scoped to `franchiseId`), so the equivalent pairing on the Franchise side is mathematically redundant, not just superficially similar — copying School's two-check shape by pattern-matching, without accounting for this asymmetry, was itself a smaller instance of the same "copied the shape, not the reasoning" mistake as the RLS bug above. Resolved per call site rather than uniformly: the genuinely redundant `franchisesService.findOne()` call a draft had added to `PaymentsService.findForFranchise()` was removed entirely (that method's own `PaymentAccount`-scoped RLS already 404s correctly with zero Franchise-level check); `PaymentsService.createForFranchise()` deliberately keeps both checks despite the redundancy (a money/Stripe-adjacent, low-frequency write, where the explicit business-layer check argued for by `TenantAuthorizationService`'s own header comment is worth one extra round-trip); `FranchisesService.findSchoolsForFranchise()` dropped its redundant `assertFranchiseOwner()` call in favor of the SQL-function-level check described above, which is a stronger guarantee, not a weaker one.

### Recorded by

Logged during a direct, live exchange with the user, 10 Sep 2026 — the user's own explicit direction, quoted above, followed verbatim rather than inferred. The FOUND ON REVIEW section above was logged the same day, after this PR's own multi-angle code review ran and before it was opened for CI/merge.

---

## Decision 98 — Track B, Slice 1: `apps/student` built as an Expo-managed React Native app; secure token storage via `expo-secure-store`

**Date:** 16 Sep 2026
**Status:** Product-owner decision, made directly with the user
**Resolves:** `docs/TRACK-B-STUDENT-APP-KICKOFF.md`'s two flagged pre-Task-1 decisions ("Expo vs. bare React Native" and "RN-appropriate secure token storage") — both explicitly called out there as real trade-offs not to default on silently.

### Decision

`apps/student` is built as an **Expo-managed workflow** React Native app, not bare RN. Reasoning, per the kickoff doc's own framing, confirmed with the user directly ("suggest me" → recommendation given → accepted): the per-School white-label rebuild pipeline (`packages/build-pipeline`, Spec 55 §5) is already a confirmed requirement, and EAS Build is the more direct path to it than a bare-RN native-module setup would be. The counter-consideration (bare RN's finer native-module control, relevant if QR-scanning/camera-consent handling end up needing something Expo's managed workflow doesn't expose) is not a concern yet in this walking-skeleton slice — QR check-in is explicitly out of scope here (see kickoff doc's "Explicitly not doing" list) and can force a reconsideration later if it ever becomes one.

Token storage uses `expo-secure-store` (the RN-appropriate secure-storage primitive named as the Expo-path default in the kickoff doc), not `packages/auth`'s existing `TokenStore` (browser-only `sessionStorage`/`atob`) and not `AsyncStorage` (plain, insecure storage for a JWT). This inherits the kickoff doc's already-flagged, known UX limitation: `POST /auth/login` returns only `{ accessToken }`, no refresh-token endpoint exists yet (`[UNRESOLVED]`, `ultm8-nestjs-module` §7), so sessions force re-login at the access token's TTL (≤15 minutes) regardless of storage mechanism — not solved by this decision, carried forward as-is.

### Toolchain check (before Task 1 started)

Verified directly in the Track B working environment (16 Sep 2026): Node v22.20.0, npm 10.9.3 (matches the monorepo's pinned `packageManager`). No local `ANDROID_HOME`/`ANDROID_SDK_ROOT`/`adb` — confirming `apps/student/README.md`'s original Phase 1 note that a local Metro/Xcode/Android native toolchain isn't available in this environment. `npx expo` and `npx eas-cli` both resolve and run cleanly, which is what the Expo path actually depends on for this slice: `expo start` (Metro + Expo Go) for local dev/testing, and EAS Build's cloud service for anything needing a real native binary — neither requires a local Android SDK or Xcode install. This is a environment capability match in Expo's favor, not just a spec-alignment one.

### What this does NOT resolve

Camera/QR-scanning native-module needs (still `[UNRESOLVED]` per the kickoff doc and `ultm8-domain-rules` §12/§18) — if a future slice's QR check-in work finds Expo's managed workflow genuinely insufficient, that would be a new decision, not a silent reversal of this one. Also does not resolve the missing refresh-token endpoint (`ultm8-nestjs-module` §7) — still open, backend-track territory.

### Recorded by

Logged during a direct, live exchange with the user, 16 Sep 2026 — user asked "what's best? suggest me" on the Expo-vs-bare-RN question; the kickoff doc's own recommendation (Expo) was restated and accepted.
