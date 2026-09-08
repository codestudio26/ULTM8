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
