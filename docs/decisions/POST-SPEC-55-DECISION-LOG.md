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

## Decision 98 — School→Franchise linking: a narrow, self-service, ONE-WAY-ONLY join (Phase 16b-i)

**Date:** 10 Sep 2026
**Status:** Product-owner decision on the linking mechanism, made directly with the user after a genuine blocker surfaced mid-research.
**Resolves:** while researching Phase 16b (`FranchiseFeeCharge`), grepped every write site in this codebase and confirmed `School.franchiseId` was **never written anywhere** outside a direct-seed test fixture — `CreateSchoolDto`/`UpdateSchoolDto` both deliberately exclude it (Decision 79's own School-creation design: "a self-service-created School is always independent"). `FranchiseFeeCharge` bills a School for its Franchise affiliation, so this is a genuine prerequisite gap, not a Phase-16b implementation detail — the same class of previously-invisible gap Decision 96 found and fixed for Student enrollment (no endpoint anywhere ever created a `STUDENT` RoleGrant, despite 6+ phases of Student-gated features being built and tested against fixture-seeded data).

### Why this needed the user's own sign-off rather than a unilateral "best decision" call

This gap sits directly adjacent to a topic the user had just explicitly reserved in the same conversation: Franchise-reaffiliation and billing-continuity on a School changing Franchise affiliation, deferred to project completion (Decision 97, the user's own words: *"Bring this issue up when project is done so we can revisit"*). Building ANY School↔Franchise linking mechanism risks reopening that exact question under a different name — "how does a School join a Franchise" immediately implies "what if it already has one, or wants to leave," unless the linking mechanism is scoped narrowly enough to never ask that question at all. Whether such a narrow scoping was actually possible — and safe — was a genuine judgment call about where the reserved topic's boundary actually sits, not a mechanical gap-fill; escalated rather than decided unilaterally, per the standing "verify, then verify again, then ask" rule.

Presented to the user as three options: (1) build a narrow, one-way-only join now, then build `FranchiseFeeCharge` against real relationships; (2) build `FranchiseFeeCharge` against fixture-seeded data only, deferring real linking entirely; (3) stop Phase 16 at the already-merged Franchise CRUD (16a) and leave fee billing for the project-end revisit. Recommended option 1 and explained why: option 2 repeats the exact anti-pattern Decision 96 had just found and fixed (a whole feature — here, a new billing entity plus Stripe metered-billing infrastructure plus a new background job — built and only ever exercisable via seeded fixtures, not real usage); option 3 needlessly defers a wanted feature over a question narrower than it first appears; and a **one-way-only** join (a School with no Franchise yet may self-service-join one; no leave/switch path exists at all) never triggers the reaffiliation question in the first place, because reaffiliation literally cannot happen through it — a strict, safe subset of "how Franchise affiliation works" that doesn't require answering, or even touching, the harder deferred question. The user chose option 1 directly ("Yes, go ahead with option 1").

### Decision

`POST /schools/:id/join-franchise` (`SchoolsService.joinFranchise`) — School Owner/Manager only (Spec §8.2), request body `{ franchiseId }`. The write is a single atomic conditional `updateMany` (`WHERE franchiseId IS NULL`) inside one transaction, checked via the returned row count — a School that already has a `franchiseId` gets `409 Conflict`, never a silent re-link. No new RoleGrant is created (this is a plain `School.franchiseId` field write, not a grant-issuing flow), and no Stripe subscription or `FranchiseFeeCharge` row is created here — this phase (16b-i) establishes only the relationship itself; the billing mechanics are Phase 16b-ii, built next against these real relationships.

**FOUND ON REVIEW, before this ever shipped:** the first draft also added a `franchise_exists()` `SECURITY DEFINER` function (mirroring `school_exists()`, Decision 96) as a separate pre-write existence check, in its own transaction. Two independent review angles caught that this was unnecessary AND a regression: `School.franchiseId` already carries a real foreign-key constraint to `Franchise.id`, and Postgres foreign-key checks always run outside row security by design — so the write already fails with a catchable FK-violation error if `franchiseId` doesn't reference a real row, with no separate check needed. Splitting the (unnecessary) check and the write across two transactions also reopened the exact TOCTOU-window class `join()` (the Student-side sibling this method mirrors) deliberately avoids by keeping its own existence check and write in one transaction. Fixed by removing `franchise_exists()` entirely — no new migration, no new grant, no new SECURITY DEFINER surface at all was actually needed for this phase — and catching Prisma's `P2003` (foreign-key violation) inside the single `updateMany` transaction instead.

A separate finding, applied but not structurally significant: `Franchise.flatFeeAmount`/`Franchise.perHeadcountRate` were added in a first draft, alongside the linking mechanism, as a Developer-level inferred fix for a second gap noticed in the same research pass (`Franchise.feeModel` is confirmed, Spec 55 §6.1; the actual dollar rate/amount is not named anywhere). Code review's conventions pass correctly pushed back: unlike routine Developer-level gap-fills (`MembershipPlan.expiryDurationDays` and similar), a Franchise billing rate carries real, undecided business-model weight (self-service Franchise-set rate vs. platform-negotiated; which currency — domain-rules §11.2's "Franchise-fee... billed in a single anchor currency (USD)" answers the currency half, but not who sets the number) closer in kind to the linking question above than to a mechanical field addition, and shouldn't have been decided unilaterally in the same pass. Reverted from this PR entirely (schema, DTOs, service, migration) — deferred to Phase 16b-ii's own kickoff, to be raised with the user then, with `FranchiseFeeCharge`'s actual billing mechanics concretely in front of them rather than asked in isolation here.

### What this does NOT resolve

Franchise-reaffiliation/billing-continuity (Decision 97, still deferred to project completion — this decision does not touch it, by design; see above). `FranchiseFeeCharge` itself, the `franchise-fee-usage-reporting` job, the actual Stripe metered-billing setup, and the Franchise fee-rate/amount fields (see above) are all Phase 16b-ii, not built in this same change. Whether a School should be able to leave a Franchise it mistakenly joined, or whether joining should require the Franchise's own consent/approval rather than being fully self-service, are both genuinely open — flagged, not decided, consistent with Decision 80's still-standing "Franchise Owner granting/approving anything is genuinely unconfirmed" note; this join path requires no Franchise-side action at all, deliberately mirroring the same fully-self-service shape Decision 96 already established for the Student↔School side.

### Recorded by

The linking-mechanism question (and the option-1 choice) was logged during a direct, live exchange with the user, 10 Sep 2026, after this gap surfaced mid-research — options presented, a recommendation given and explained, and the user's own choice ("Yes, go ahead with option 1") followed. The `franchise_exists()` removal and the fee-rate-fields reversal were both found during this PR's own pre-merge code review, the same day.

---

## Decision 99 — Franchise fee-rate authority: self-service (Franchise Owner sets their own rate), resolved directly with the user

**Date:** 10 Sep 2026
**Status:** Product-owner decision, made directly with the user, immediately following Decision 98's own deferral of this exact question.
**Resolves:** Decision 98's own "Franchise fee-rate fields" reversal explicitly deferred the rate-setting-authority question — "self-service Franchise-set rate vs. platform-negotiated" — to be raised at Phase 16b-ii's kickoff rather than decided unilaterally, since it carries real, undecided business-model weight unlike a routine Developer-level gap-fill.

### Decision

The Franchise Owner sets their own `flatFeeAmount`/`perHeadcountRate`, self-service, via the existing `PATCH /franchises/:id` (no dedicated endpoint) — the same shape a School already uses to set its own `MembershipPlan.price`, and consistent with `Franchise.feeModel` (Flat vs. Per-Headcount) already being confirmed as "configurable per Franchise" (Spec 55 §6.1). No platform/Platform-Admin approval step, no School-side consent or notification — a Franchise Owner may set or change their rate at any time via the ordinary Franchise-profile-edit endpoint.

Presented to the user directly: self-service (matching the precedent above, and the only option not fully blocked by `PlatformAdminModule` not existing yet) vs. platform-negotiated (would require Platform Admin tooling that doesn't exist and is itself blocked on the still-open SSO vendor decision, Decision-log's own §4 open-items list). The user chose self-service directly: *"Yes, go ahead with self-service."*

### What this does NOT resolve

Changing the rate **after franchise-fee billing has already started** for at least one member School is a genuinely separate mechanical question this decision does not answer — Stripe Prices are immutable once created (a real technical constraint, not a business one), so a rate change after the first standing Subscription exists needs its own real mechanism (create a replacement Price, migrate every affected Subscription's line item to it) that was not designed or built in this phase. `FranchisesService.update()` (this phase) blocks a `flatFeeAmount`/`perHeadcountRate` change once any School under that Franchise already has a standing franchise-fee Subscription, rather than silently accepting a change that would leave Stripe billing at the old rate while the local ledger recorded the new one — a genuine gap this review surfaced, closed with a safe rejection rather than a guessed reconciliation mechanism. Building the real rate-migration flow is deferred, not decided against — flagged for whenever a Franchise Owner actually needs to change an active rate.

Also unresolved, unchanged: whether a School should be notified when its Franchise's rate changes, and School-side consent to a rate change — neither exists in this phase, and Decision 80's still-standing "Franchise Owner granting/approving anything beyond its own resources is genuinely unconfirmed" note doesn't directly answer this either, since setting one's own rate is a Franchise acting on its own resource, not granting something to another party.

### Recorded by

Logged during a direct, live exchange with the user, 10 Sep 2026, immediately following Decision 98 — the question was asked plainly ("who sets a Franchise's actual fee rate/amount"), a recommendation given (self-service) and explained, and the user's own choice ("Yes, go ahead with self-service") followed. **FOUND ON REVIEW, before this ever merged:** this exact decision was cited by number throughout the Phase 16b-ii code and migration (schema.prisma, the DTOs, the migration file, a test comment) before this entry was actually written — a real process gap, not a business-logic error: the underlying decision was genuinely made with the user in this same conversation, but the append-only log entry recording it was never created until this review pass caught the dangling citation. Written now, after the fact, to close that gap — the decision itself was not invented, only its paper trail was late.

---

## Decision 100 — SSO/identity-provider for Platform Admin: AWS Cognito, resolved directly with the user

**Date:** 11-12 Sep 2026
**Status:** Product-owner decision, made directly with the user, resolving the one vendor decision this decision-log's own §4-equivalent open-items list (the ULTM8 Roadmap artifact) had been carrying since Franchise-fee billing shipped (Decision 99's own "still-open SSO vendor decision" reference).
**Resolves:** `PlatformAdminModule`, and transitively `SubscriptionPlansModule`/`TranslationsModule` (both sit behind Platform Admin's own guard chain by confirmed design), were blocked purely on which identity provider Platform Admin staff authenticate against — ultm8-tenant-isolation SKILL.md §3's confirmed requirement ("SSO against the company's own identity provider plus mandatory 2FA... a distinct Auth0/Keycloak/Cognito pool, or at minimum a separate JWT issuer and audience") names three candidate vendors without picking one, and no amount of engineering work substitutes for an actual vendor choice.

### Decision

**AWS Cognito.** Presented to the user across several passes, not a single-shot recommendation: an initial pass favored Auth0 (better developer experience, larger ecosystem); a deeper pass — live-verified against current vendor pricing and incident-history sources rather than assumed — corrected two things that pass had gotten wrong (Auth0's B2B/Organizations pricing tier doesn't actually apply to a single-internal-team use case; genuine audit-log streaming and anomaly detection are gated behind Auth0's paid tiers, not included free) and surfaced a real, dated reliability data point (a major Okta/Auth0-parent MFA outage, October 2025) that the first pass hadn't weighed at all; a further pass checked Cognito's own outage history for fairness (also real — a Feb 2025 7h50m incident, a Mar 2026 UAE-datacenter-strike-driven outage, a Jul 2026 Kinesis cascading failure) and confirmed its own known DX/setup-complexity cost (~1-2 engineer-days for a properly configured pool, per current third-party review sources) rather than presenting Cognito as risk-free. Final reasoning, weighed directly against Auth0/WorkOS rather than in isolation: Cognito adds no new external vendor to a stack already carrying Stripe/Twilio/Postmark-SES/Cloudflare (this project's own Postmark-instability flag, §11.4, is the concrete precedent for why "one more vendor relationship" is a real, not hypothetical, cost here); its own outage risk is *correlated* with AWS dependency this backend already fully trusts for Secrets Manager (holding live Stripe credentials) and CI/CD, not *additive* to it; and CloudTrail gives real audit logging on every Cognito API call for free, where Auth0 gates the equivalent behind a paid tier for the one identity in the system whose entire justification is auditability. WorkOS was ruled out on inspection, not by comparison shopping: its flagship product (Enterprise SSO/SCIM for external customers bringing their own IdP) doesn't match this problem's actual shape — a small number of ULTM8's own internal staff, not multiple outside organizations each needing federation.

A related, narrower finding from the same discussion, not yet acted on: if ULTM8 already operates Google Workspace or Microsoft 365 for staff email, letting staff sign in with that existing corporate identity (domain-restricted, explicitly allowlisted against `AdminUser.ssoSubject` — never by domain-membership alone) would be strictly better than either Cognito or Auth0 — zero new vendor, zero cost, reuses identity governance the company already operates. This was left open rather than decided, pending confirmation of whether such a Workspace/365 tenant already exists; Slice 1 (this phase) is built against Cognito specifically so it isn't blocked on that separate, slower-moving company decision, and the module is structured (`AdminUser.ssoSubject` as the actual access-control gate, ULTM8's own JWT as what the rest of the app depends on, never the upstream IdP's token directly) so switching later is a bounded, contained change — a new token-verification implementation behind the same interface, not a redesign.

### What this does NOT resolve

Only Slice 1 — the auth spine (`POST /platform-admin/auth/exchange`, `GET /platform-admin/auth/me`, the separate JWT realm/guard/strategy) — is built against this decision. Not built in this phase, each its own later slice: any actual cross-tenant admin business-logic endpoint (all of which need the immutable audit-log write ultm8-tenant-isolation SKILL.md §3 requires, which doesn't exist yet); admin-invite/self-service admin-account management (a `FULL_ADMIN` adding a `SUPPORT`/`BILLING_PAYMENTS_OPS` teammate — the bootstrap-only path in `scripts/bootstrap-admin-user.ts` is explicitly not that); the actual AWS Cognito User Pool itself, which is real infrastructure outside this codebase's own provisioning capability (no AWS credentials exist in the environment this was built in) — the application code is written against `COGNITO_USER_POOL_ID`/`COGNITO_CLIENT_ID` as configuration, matching every other external-service convention already established here (Stripe, Secrets Manager, R2), and the User Pool itself (MFA set to Required, per §4.4) is the user's own infrastructure step to complete before this flow is reachable end-to-end. The 5-minute `PLATFORM_ADMIN_JWT_TTL` default is a Developer-level engineering parameter, not a spec-confirmed or product-owner-approved number the way the tenant realm's 15-minute TTL is (Spec §8.3) — chosen deliberately narrower than the tenant default given this realm's heightened sensitivity, but open to explicit revision rather than treated as settled.

### Recorded by

Reached across several direct exchanges with the user spanning 11-12 Sep 2026: the user asked for the underlying decisions/questions to be restated, then for a "deep dive" on the SSO recommendation specifically — taken through multiple passes, each correcting or sharpening the previous one against live-verified sources rather than resting on the first answer — followed by the user's own explicit direction, "go ahead with Cognito." **FOUND ON REVIEW, before this ever merged:** this decision was referenced by number in `platform-admin.module.ts`'s own header comment before this log entry existed — the same process gap Decision 99's own "Recorded by" section already named once; written now, at this review's own prompting, to close it the same way.

---

## Decision 101 — Video-hosting/live-streaming vendor: Cloudflare Stream (hosting) + AWS Transcribe (captioning/STT), resolved directly with the user

**Date:** 15 Sep 2026
**Status:** Product-owner decision, made directly with the user
**Resolves:** the one remaining open vendor decision blocking `CurriculumModule` — its data-model precondition (Discipline → Rank → Skill) has been satisfied since Phase 10b, and Decision 58 already confirms both Prerecorded and Live Lesson formats are in scope with ULTM8-built captioning (WCAG 1.2.2, not a third-party transcript vendor) for both — but no video-hosting/streaming vendor had ever been chosen.

### Decision

**Cloudflare Stream** for video hosting/delivery — the same read-heavy, egress-heavy public-media access pattern that already justified choosing R2 over S3 for images/PDFs (Spec 55 §11.3), applied here to video specifically. **AWS Transcribe** for captioning/speech-to-text — a backend service call, consistent with this project's already-confirmed AWS-native ops stack (Secrets Manager, and now Cognito per Decision 100), unlike the public video bytes themselves, which have no reason to route through AWS.

Presented to the user as a recommendation (not a forced single option) alongside the roadmap's own open-decisions list; the user asked for Claude's own best judgment rather than picking between alternatives, and the recommendation above was given and followed — the same "recommendation given, user's own choice followed" shape as Decision 94/96's own resolution pattern.

### What this does NOT resolve

Neither vendor's actual infrastructure is provisioned by this decision — no Cloudflare Stream account/API token, no AWS Transcribe access, exist in this working environment (matching every other external-service precedent already established here: Stripe, Cognito, R2, Twilio, Postmark/SES all required the user's own account/credential provisioning before the already-written application code became reachable end-to-end). `CurriculumModule` itself — the actual schema, upload flow, captioning pipeline, and Live Lesson mechanics — is not built by this decision alone; this closes only the vendor-choice blocker, the same way Decision 100 closed only the SSO-vendor blocker for `PlatformAdminModule` without itself building any business-logic endpoint. Audio description (WCAG 1.2.5) remains a separate, still-unresourced item per Decision 58's own original scoping, untouched here.

### Recorded by

Logged during a direct exchange with the user, 15 Sep 2026 — presented alongside two other open decisions (Decisions 102/103 below) surfaced by that same session's own research pass into `PlatformAdminModule`'s and `WaitlistService`'s remaining scope; the user asked for Claude's own best recommendation across all three rather than choosing between presented options, and this decision (and the two below) record the recommendation given and the user's explicit direction to proceed with it.

---

## Decision 102 — PlatformAdminModule Support-tier impersonation: read-only session, resolved directly with the user

**Date:** 15 Sep 2026
**Status:** Product-owner decision, made directly with the user
**Resolves:** `ultm8-tenant-isolation` SKILL.md §3's own [CONFIRMED] grant that Support gets "a time-boxed, audited, tenant-scoped impersonation session" names a real capability but never specifies its mechanics — what a Platform-Admin-issued impersonation session actually lets the tenant-side app do once inside it, or how the tenant's own `AuthGuard`/`TenantAuthorizationService` should recognize and scope such a token. Researched directly against Spec 55, `ultm8-tenant-isolation`, and the full decision log before this was raised with the user — confirmed as a genuine gap, not a guessable one: no existing session mechanism (`act-as`/`assumeRole`/`sudo`-style token) exists anywhere in this codebase to graft onto, unlike every Guardian-on-behalf-of slice (Phase 37-41) which each reused an already-built mechanism with a different caller identity substituted in.

### Decision

**Read-only.** While an active impersonation session is open, Support sees exactly what the tenant user themselves would see — the tenant user's own screens/data, read access only — with no write action of any kind permitted through the impersonated identity. Reasoning: `ultm8-tenant-isolation` §3 labels the Support tier itself "(read-only)" as a whole-tier descriptor before ever mentioning impersonation — a session that could then turn around and write on the tenant's behalf would directly contradict that framing, not merely extend it. This is also the standard shape for support/troubleshooting impersonation industry-wide: view-as-user for diagnosis, not act-as-user for changes.

Mechanically (left open for the implementing phase to design, not itself decided here): a short-TTL, audited, explicitly-scoped-to-one-tenant-User token is the anchor point implied by "time-boxed, audited, tenant-scoped" — the exact claim shape, issuance endpoint, and how the tenant-side `AuthGuard` distinguishes "a real tenant session" from "a Support-issued read-only impersonation of one" remain genuine engineering design work for whichever phase actually builds this, not pre-decided by this entry.

### What this does NOT resolve

This decision answers only the scope question (read-only vs. write-parity) — it does not itself build the impersonation session mechanism, choose the JWT claim shape, or specify which tenant-side screens/endpoints a read-only impersonation session is routed through. `Billing/Payments Ops` and `Full Platform Admin`'s own relationship to impersonation (whether either tier gets it at all, beyond Support) is not addressed — `ultm8-tenant-isolation` §3 names the impersonation grant only under the Support bullet, and this decision does not extend or restrict that. "General tenant-data edits" (the other half of the item this session's research covered) remains entirely unscoped — no field, entity, or sub-role tier is named anywhere in Spec 55 or this log for it, and this decision does not touch it at all.

### Recorded by

Logged during a direct exchange with the user, 15 Sep 2026, immediately following a dedicated research pass into `PlatformAdminModule`'s actual remaining scope (triggered by the roadmap's own "general tenant-data edits, or impersonation — needs its own design pass" item) — the user asked for Claude's own best recommendation, and the read-only framing above was given and explained, then followed with the user's own direction to proceed.

---

## Decision 103 — Staff/Guardian-on-behalf-of Waitlist join and claim: extended to both, resolved directly with the user

**Date:** 15 Sep 2026
**Status:** Product-owner decision, made directly with the user
**Resolves:** `WaitlistService`'s own header comment (Phase 11) had deliberately left join/claim self-service-only, reasoning that — unlike Booking creation, where SKILL.md §9 explicitly confirms Staff override authority — nothing in SKILL.md §10 names an equivalent Staff (or Guardian) on-behalf-of shape for the waitlist specifically, and claiming spends a Membership credit immediately with no textual anchor to build against. This was the one remaining item in the otherwise-complete Guardian-on-behalf-of chain Phase 37-41 shipped (signing → enrollment → membership purchase → booking creation → booking cancellation).

### Decision

Extend the same on-behalf-of shape already established for booking creation/cancellation to `WaitlistService.joinWaitlist()`/`claim()`, for **both** Staff and Guardian callers. Reasoning given to the user and accepted: `withdraw()` already supports Staff-on-behalf-of today (a pure status change, no credit implication) — `join` carries the identical risk profile (queues without consuming any credit; reversible via withdraw) — so extending `join` to Guardian, and to a symmetric Staff shape, closes an inconsistency rather than opening a new risk. `claim()` is the one step that spends a Membership credit immediately, which is exactly the same risk profile Guardian-on-behalf-of Booking creation (Phase 40) already carries and already ships in production code — the original caution in `WaitlistService`'s own header comment predates that precedent; now that it exists, reviewed and working, `claim()`'s risk is no longer materially different from `bookClass()`'s own, and the same target-tenant-context substitution mechanism already used four times this session (Phase 37-41) applies here without any new pattern being invented.

### What this does NOT resolve

The actual implementation — `assertGuardianOfStudent()`/`assertStaffAtSchool()` branches on `joinWaitlist()`/`claim()`, any new DTO fields needed, and full e2e coverage — is not built by this decision alone; it authorizes the next phase to build it the same way Decision 96 authorized (but did not itself build) self-service Student enrollment. Whether a Guardian should also be able to withdraw a linked minor's own waitlist entry is not newly addressed here (Staff-on-behalf-of withdraw already exists; extending it to Guardian as well is a natural, low-risk companion to this decision but is left for the implementing phase to include or flag, not pre-decided).

### Recorded by

Logged during a direct exchange with the user, 15 Sep 2026, alongside Decisions 101/102 above, presented together after the same session's research pass surfaced all three as the project's remaining open decisions — the user asked for Claude's own best recommendation across all three, and this reasoning was given and followed.

---

## Decision 104 — Lesson scoping and authorship: School-scoped, Instructor/Staff-authored, resolved directly with the user

**Date:** 16 Sep 2026
**Status:** Product-owner decision, made directly with the user
**Resolves:** a genuine contradiction inside Spec 55 itself, found while starting Phase 44 (`CurriculumModule`, Decision 101's video vendor having just unblocked it). Decision 58's own prose (§12.1) describes Prerecorded Lessons as "videos an instructor uploads ahead of time" — tenant-side, Instructor-authored. But Spec 55's own §7 endpoint table lists Lesson authoring as `CRUD /admin/curriculum/lessons`, and this project's own confirmed `/admin/*` convention (`ultm8-nestjs-module` §5 — `TranslationsModule` is the direct structural precedent, tenant-facing reads but Platform-Admin-only authoring) means that endpoint prefix should mean the Platform Admin realm, never a tenant JWT. Nothing in Spec 55 reconciles these two statements, and no Section 8 screen-to-role mapping mentions Lesson/Curriculum at all. This was escalated rather than resolved by picking whichever reading was found first, per this project's own standing rule.

### Decision

**School-scoped, Instructor/Staff-authored, ordinary tenant endpoints** — not the Platform Admin realm. `Lesson` carries a denormalized `schoolId` (same convention as `Skill`/`Rank` above it), and writes go through the existing `TenantAuthorizationService.assertStaffAtSchool` check (Owner/Manager, Branch Staff, or Instructor — the same three roles every other tenant-content entity in this schema already uses), reached via ordinary `/schools/{id}/curriculum/lessons` routes, not `/admin/*`. Reasoning given to the user and accepted: Decision 58's own prose is the more specific, more recently-reasoned statement about *this* feature specifically, while the `/admin/curriculum/lessons` table entry reads as a copy-paste/categorization slip against the `TranslationsModule` pattern immediately above it in the same table — and a shared, Platform-Admin-curated lesson library sits awkwardly against today's schema regardless, since `Skill` (what every Lesson links to) is already per-School, not platform-wide reference data. This also keeps Lesson consistent with every other confirmed piece of Decision 58 itself: Lessons "surfacing automatically... a student's profile, the grading flow itself" only makes sense as School-scoped content a Student at that School can already see through ordinary RLS, the same "any active RoleGrant holder at the School may read, business-layer narrows writes" split already established for Discipline/Rank/Skill (Phase 10b) and reused unchanged.

### What this does NOT resolve

This decision answers only scoping and authorship — it does not build the video-upload or captioning-pipeline integration itself (Decision 101 picked the vendors; no Cloudflare Stream/AWS Transcribe credentials are provisioned in this environment, so `videoRef`/`captionStatus`/`captionTrackRef` exist on the model but nothing writes them beyond their schema defaults yet). It also does not resolve two things flagged during the same research pass, both left for the Architect: what Spec 55's own "Belongs to a Category" clause on Lesson actually refers to (no `Category` entity exists anywhere else in the document — treated as a doc inconsistency, not modeled), and Live-Lesson real-time captioning mechanics (explicitly gated on the video-hosting vendor's own capabilities in Spec 55, unresolved there and not addressed here). Full e2e isolation-suite coverage for the new `Lesson`/`LessonSkill` RLS policies is not run by this decision either — this working environment has no reachable Postgres; the schema, hand-authored migration, and NestJS module are typechecked (`tsc --noEmit`) but not yet verified against a live database or the cross-tenant isolation CI gate.

### Recorded by

Logged during a direct exchange with the user, 16 Sep 2026, immediately after a dedicated research pass (docx text extraction of Spec 55 §12.1/§6.1/§7) surfaced the scoping contradiction above as a genuine spec-internal gap, not a guessable one — the user was given both readings plus a recommendation and chose the recommended one.

---

## Decision 105 — PlatformAdminModule general tenant-data edits: not built, pending a named use case

**Date:** 16 Sep 2026
**Status:** Product-owner decision, made directly with the user
**Resolves:** the one item the project's own roadmap tracking had flagged as genuinely irreducible to an engineering question — "which specific tenant fields/entities, if any, should a Platform Admin be able to edit directly, and which sub-role tier(s) may do it?" — the sibling question Decision 102 (Support-tier impersonation) deliberately left untouched.

### Decision

**Do not build a general tenant-data-edit capability.** Verified directly against `ULTM8_Technical_Specification_55.docx` (not just `ultm8-tenant-isolation` SKILL.md's own paraphrase) before this was raised with the user: §4.4 names Platform Admin's exact three sub-role capabilities in full — Support (read-only account metadata + time-boxed impersonation), Billing/Payments Ops (view `PaymentAccount` status + initiate Stripe Connect credential rotation, never a decrypted secret), Full Platform Admin (assign sub-roles + break-glass) — and none of the three includes editing a tenant's records. §7's own endpoint table lists only `GET /admin/tenants` and `GET /admin/tenants/{id}` for `PlatformAdminModule`'s tenant surface, no `PATCH`/`PUT`/`DELETE`. The phrase "viewing or editing another tenant's records" occurs exactly once in the entire document, in §4.7 (Audit trail), as one example of an action type that *would* be logged if it existed — never granted to any role, field, or entity anywhere else in the spec. This is a confirmed, total absence, not an oversight in a paraphrase.

Reasoning given to the user and accepted: every concrete Platform Admin need the spec actually names is already built — Support's read+impersonation (Phase 43) covers diagnosis and hands-on troubleshooting without a write capability; Billing/Payments Ops's credential rotation (Phase 35) covers the one payments-adjacent write the spec confirms. A general tenant-record-edit surface with no named fields, entities, or scenario would mean inventing both the capability's shape and its authorization boundary from nothing — exactly the class of guess `ultm8-domain-rules`/`ultm8-tenant-isolation`'s own standing rules prohibit, and a meaningfully larger audit/security surface (every tenant field becomes admin-writable) to carry indefinitely for a need nobody has actually named yet.

### What this does NOT resolve

If a real, specific scenario emerges later (e.g., Support needing to correct a locked-out user's contact info, or Full Admin needing to fix a stuck Membership/subscription state), that is a fresh, narrowly-scoped decision — naming the exact fields/entities and sub-role — not an unlocking of broad edit access under this same entry. Nothing here revokes or narrows any tenant-data capability already built (impersonation, credential rotation); it only declines to add a new, unscoped one. `MobileAppPublishingModule`'s own confirmed `PATCH /admin/tenants/{id}/app-config` (Section 5, `TenantAppConfig` — branding/build config) is a separate, already-spec-confirmed, already-scoped write surface and is unaffected by this decision either way.

### Recorded by

Logged during a direct exchange with the user, 16 Sep 2026 — the user was presented with three options (don't build it, a narrow named capability, or a broader CRUD-style capability) plus Claude's own recommendation (don't build it, for the reasoning above) via a direct question, and asked for Claude's own best judgment rather than picking between the options; the recommendation was given and followed, the same "recommendation given, user's own choice followed" shape as Decisions 101–104.

---

## Decision 106 — SubscriptionPlansModule billing-direction "blocker": stale citation, not a live question

**Date:** 18 Sep 2026
**Status:** Documentation reconciliation — verified directly against source; not a new product/business decision
**Resolves:** `docs/TRACK-A-ROADMAP.md` and two code comments (`apps/api/src/platform-admin/platform-admin.module.ts`, `apps/api/src/payments/payments.controller.ts`) cited `ultm8-domain-rules` §2 as `[UNRESOLVED]` on whether the platform-level `SubscriptionPlan` a Franchise/School "subscribes to" is ULTM8 billing that Franchise/School directly, or a plan resold onward to member Schools — and said not to implement billing logic until it was resolved. A master-roadmap synthesis (18 Sep 2026) found the skill file's *current* text says the opposite: `[CONFIRMED]` since "Pass 4."

### What was actually verified

Not assumed from the skill file alone — traced to source:
1. **`skills/ultm8-domain-rules/SKILL.md`** itself is internally consistent and unambiguous: §2's own confirmed-items list, the platform-wide "confirmed" bullet roundup, the white-label-entitlement line, the explicit `MembershipPlan`-vs-`SubscriptionPlan` distinction warning, and the canonical-terminology table all independently state the same resolved direction — six separate locations, not one throwaway line.
2. **`git show 80de2d4`** (`Update domain rules and add Spec 55 handover`, authored by the project owner, 31 Aug 2026 — before Phase 0 of implementation even started) shows the actual edit: the line changed from `[UNRESOLVED] ... Do not implement Franchise Subscription Plan billing logic until this is resolved` to `[CONFIRMED] ... is ULTM8's own platform revenue ... not a plan the Franchise resells onward ... resolved Pass 4`. This is a deliberate, dated, pre-implementation resolution, not later drift or an accidental edit.
3. **`deep-review/ULTM8-Dev-Handover-v55/review-history-tracker.html`** (the spec's own review audit trail, independent of the skill file) corroborates it a third way, listing "SubscriptionPlan direction" as the first of five decisions locked in Pass 4 (§10.1/§10.2 status rows).

Three independent primary sources agree. The roadmap doc and code comments were simply never updated after the skill file's Pass 4 edit — a documentation-currency bug, not a genuine open business question.

### Decision

**Not a decision — a correction.** `SubscriptionPlansModule` is not blocked by this question. Its status is the same as `TranslationsModule`'s was before Phase 49: confirmed scope, never picked up. `docs/TRACK-A-ROADMAP.md`, `docs/ULTM8-MASTER-ROADMAP.md`, and the two stale code comments are updated in the same change that adds this entry.

### What this does NOT resolve

This does not scaffold or build `SubscriptionPlansModule` — it only clears the specific citation blocking it from being scheduled like any other unbuilt-but-unblocked module. Building it is unaffected, ordinary future work.

### Recorded by

Investigated and recorded by Claude at the user's direct request ("pick up item B.2: SubscriptionPlansModule citation reconciliation" — the item the same session's own master-roadmap synthesis had flagged as needing an Architect pass), 18 Sep 2026. No new business judgment call was made — this verifies which existing source is current and corrects citations to match, per `CLAUDE.md`'s own source-of-truth hierarchy (the skill file outranks a roadmap doc or a code comment). If this reasoning turns out to be wrong — if the skill file's Pass 4 resolution was itself made in error — that would be a genuine reversal needing the product owner directly, not something to silently re-flip here.

---

## Decision 107 — QR check-in mechanics: two independently-keyed rotating tokens (Class-scoped + Student-scoped), per-Student Instructor roll-call scan with a camera-free manual fallback

**Date:** 18 Sep 2026
**Status:** Developer-level inference, flagged for Architect confirmation, not a product-owner-approved decision like 101–105 — approved by the user as a design proposal before implementation, but the underlying mechanics were never specified anywhere in Spec 55 or SKILL.md and were designed, not confirmed
**Resolves:** two gaps this log never closed. First, Phase 13's own `POST /attendance/scan` shipped against a bare `bookingId` with no rotation at all — a static QR code a Student could screenshot and reuse indefinitely, directly contradicting Decision 66's own confirmed constraint that Class QR codes must be "time-boxed, rotating, never static." Second, Decision 71 confirmed that Instructors need a roll-call scanning capability distinct from Student self-service check-in, but never designed its mechanics (per-Student vs. batched, camera-based vs. name-confirmation, how consent withdrawal interacts with it) — left as a named-but-undesigned item ever since.

### Decision

Two independently-keyed, short-lived signed JWTs, each verified against its own dedicated secret (`QR_CLASS_TOKEN_SECRET`, `QR_STUDENT_TOKEN_SECRET`) so a captured token of one kind can never be replayed as the other even under a payload-shape-check bug: a **Class-scoped token** (`GET /classes/:id/qr-token`, Staff-minted, displayed on a shared screen, any Student at the School scans it via `POST /attendance/scan`) and a **Student-scoped personal token** (`GET /attendance/my-qr-token`, self-minted by any authenticated caller, displayed on the Student's own device, an Instructor scans it via `POST /classes/:id/attendance-scan`). Both expire after `QR_ATTENDANCE_TOKEN_TTL_SECONDS` (default 20s).

Instructor roll-call is per-Student, not batched or checklist-style, discriminated purely by whether the request body carries a `studentToken`: `INSTRUCTOR_SCAN` (Instructor scans the Student's own personal token, camera-based) or `INSTRUCTOR_MANUAL` (Staff confirms by name alone, zero camera involvement, for a Student whose device is dead/absent/a young minor with none). `Booking` gains `checkInMethod`/`checkedInById` columns (nullable, mirroring the existing `overriddenById`/`overrideReason` pairing) recording which of the three methods (`SELF_SERVICE`, `INSTRUCTOR_SCAN`, `INSTRUCTOR_MANUAL`) completed the check-in and by whom. The existing check-in-window cutoff (`Class.qrAttendanceEndAt ?? Class.endDate`) applies identically to all three methods — exempting manual mode would let "just say manual" bypass the whole system's anti-fraud/no-show boundary. Camera-tier `ConsentRecord` withdrawal blocks `SELF_SERVICE` and `INSTRUCTOR_SCAN` but NOT `INSTRUCTOR_MANUAL`, which exists specifically as the camera-free fallback.

### Why

Per-Student over batched/checklist: Decision 71's own text says "scan" — only a per-Student camera interaction is genuinely a scan; a checklist is a different, simpler feature nothing in the spec actually names. Two separate secrets over one shared secret with a type field in the payload: a single shared secret means a bug in the type-check (or a deliberately crafted payload matching the other type's shape) lets a captured Class token be replayed as a Student token or vice versa; two independent secrets make that class of bug structurally impossible rather than merely checked-for. Manual mode bypassing consent-withdrawal while scan mode doesn't: this is the one genuinely unresolved judgment call in this design, explicit in the code's own comments — not confident the camera-tier consent's intent hinges on literally whose device does the scanning (Instructor's vs. Student's) rather than on avoiding any camera image of the Student at all, which would argue for blocking `INSTRUCTOR_SCAN` too (already done) but arguably not `INSTRUCTOR_MANUAL` (no camera involved at all, which is exactly why it's exempted here) — the conservative reading was taken for `INSTRUCTOR_SCAN` and manual was deliberately kept open as the always-available fallback regardless of how that ambiguity resolves, since removing the one camera-free path entirely would leave no way to check in a Student whose Guardian withdrew camera consent at all. TTL default (20s): an explicit Developer-level placeholder, the same tier of judgment call as `PLATFORM_ADMIN_IMPERSONATION_TTL_SECONDS`'s own default — long enough for a phone-to-screen or screen-to-phone scan under normal conditions, short enough to make a screenshotted/shared token useless within one class period, not derived from any named requirement.

### What this does NOT resolve

Whether the consent-withdrawal/manual-mode-bypass asymmetry above is actually correct — flagged explicitly for Architect review rather than silently decided either way. The `QR_ATTENDANCE_TOKEN_TTL_SECONDS` default is a placeholder, not a reviewed number. The School Portal QR-display screen (Staff-facing UI to show the rotating Class token on a shared screen, polling `GET /classes/:id/qr-token` on an interval) was NOT built this phase — this phase is backend-only, following this codebase's own established backend-then-UI phase-splitting convention (e.g. `CurriculumModule` Phase 44 backend / Phase 45 UI); the UI is a natural follow-up phase, not silently dropped.

### Recorded by

Designed as a research-grounded proposal (a dedicated background research pass over the existing codebase's own established conventions — route grouping, Staff-gate reuse, JWT-signing precedent, additive-migration-with-RLS-reasoning) and presented to the user for approval before any code was written; the user approved it as proposed ("Go ahead and build it as proposed"), 18 Sep 2026. Logged here, not as Decisions 101–106 are (a product-owner decision made directly with the user on a named open question), because the mechanics themselves — the two-secret design, per-Student vs. batched, the consent asymmetry — were never put to the user as discrete alternatives to choose between; they were designed by Claude and approved as a package, the same "flagged prominently rather than silently built around" treatment Decisions 90–94 already establish for this class of Developer-level inference.

---

## Decision 108 — Instructor rank: V1 is a manual belt dropdown on the Instructor's own profile settings page; linking it to the real grading system is deferred to V2

**Date:** 17 Sep 2026
**Status:** Product-owner decision, made directly with the user
**Resolves:** a gap this file never addressed. `InstructorResponseDto.beltRanking` (`packages/api-client/src/generated/schema.d.ts`) already exists as plain display text, with its own doc comment stating it is *"not a live reference into the grading system"* — but nothing confirmed how that value gets set, or whether it should ever connect to the real `StudentRank`/`Rank` grading model (domain-rules §5/§6.1), which today has no Instructor-side relation at all.

### Decision

**V1:** an Instructor sets their own displayed rank manually, via a belt dropdown on their own profile settings page — not auto-derived, not staff-entered, not linked to `Rank`/`StudentRank` in any way. This is consistent with `beltRanking` staying the plain-text field it already is.

**V2 (future, not scheduled):** link Instructor rank to the real grading system. Recorded as direction only — not designed.

### What this does NOT resolve

V1 specifics still open, not to be guessed at when this is built: the dropdown's actual option set (freeform per-School text vs. a fixed generic belt list vs. pulling from the caller's own Discipline/Rank ladders, which are School-configurable per domain-rules §5); whether an Instructor can hold one rank total or one per discipline (mirroring `StudentRank`'s one-per-discipline shape, domain-rules §5, is a plausible but unconfirmed default); and which profile settings screen this lives on, since no Instructor-facing "my profile settings" page has been designed yet (only the School-staff-facing Instructor list/detail views this session's mockup work has covered).

V2 specifics are entirely open: whether it reuses `StudentRank`/`Rank` directly or a parallel structure, whether promotion stays coach-initiated the same way `StudentRank` promotion does (domain-rules §5), and how/whether an Instructor who is also independently a Student (with their own real `StudentRank`) reconciles the two. None of this should be built from inference when V2 is scheduled — needs its own decision.

### Recorded by

Logged during a direct exchange with the user, 17 Sep 2026, while reviewing the Instructors page mockup (`docs/design-mockup-notes.md`) and confirming why `beltRanking` is plain text rather than a grading-system reference.

---

## Decision 109 — Transactions Student-name resolution: embed `studentFirstName`/`studentSurname` on `TransactionResponseDto`, not a new lookup endpoint

**Date:** 18 Sep 2026
**Status:** Developer-level inference, flagged for Architect confirmation — not a product-owner ruling
**Resolves:** a real, previously-flagged gap in `TransactionsPage.tsx` (own comment: *"No 'look up a User's name by id' endpoint exists yet"*) — the Transactions page showed a truncated `studentId` instead of the paying Student's name because no endpoint anywhere resolved a `userId`/`studentId` to a name.

### Decision

`TransactionsService.findAllForSchool` now joins `Transaction.student` (`User.firstName`/`surname`) directly via a Prisma `include`, flattened onto two new flat fields on `TransactionResponseDto` — `studentFirstName`, `studentSurname`. No new endpoint, no RLS/migration change: the existing `user_self_or_shared_school` policy on `User` (`apps/api/prisma/migrations/20260902000000_init/migration.sql`) already permits a School Owner/Manager to read a same-School Student's `User` row, since `RoleGrant`'s own `rolegrant_school_manager_scope` policy grants them visibility into every `RoleGrant` at their School, including the target Student's — traced through the actual policy chain, not assumed. `TransactionsPage.tsx` now renders the resolved name, falling back to the truncated id only if both fields are empty.

### What this does NOT resolve

The identical "id only, no name" gap independently exists in three other real screens — `ClassDetailPage.tsx` (Bookings/Waitlist), `InstructorFormModal.tsx`, and `StaffPage.tsx` — each with its own code comment flagging it, none touched by this change. Whether those should each get the same embedded-field treatment repeated per-DTO, or a shared batch lookup endpoint (e.g. `GET /schools/{id}/users?ids=...`) built once and reused, is a real open architectural question this decision deliberately does not answer — flagged for the Architect if/when those three sites are scoped for a real fix.

### Recorded by

Logged while implementing the Transactions page mockup fix for real, 18 Sep 2026, as part of a direct request to move one of this session's page mockups into working code.

---

## Decision 110 — Booking/WaitlistEntry/RoleGrant name resolution: mechanical extension of Decision 109's embed pattern

**Date:** 21 Sep 2026
**Status:** Developer-level inference, flagged for Architect confirmation — not a product-owner ruling
**Resolves:** two of the three sites Decision 109 explicitly left open — `ClassDetailPage.tsx`'s Bookings/Waitlist tables and `StaffPage.tsx`'s lookup-results table, both showing a raw `studentId`/`userId` instead of a name for the same reason Transactions did (no join resolved it).

### Decision

Same shape as Decision 109, applied to three more query/DTO pairs, no new architectural choice made:

- `BookingsService.findAllForClass` / `WaitlistService.findAllForClass` now join `Booking.student`/`WaitlistEntry.student` (`User.firstName`/`surname`), flattened onto `studentFirstName`/`studentSurname` on `BookingResponseDto`/`WaitlistEntryResponseDto`. `ClassDetailPage.tsx` renders the resolved name, falling back to the truncated id.
- `RoleGrantsService.findAllForUser` now joins `RoleGrant.user`, flattened onto `userFirstName`/`userSurname` on `RoleGrantResponseDto`. `StaffPage.tsx`'s lookup-results table shows a "Showing grants for **{name}**" heading above the table rather than a repeated per-row column, since every row in a single lookup shares the same target user.

No RLS/migration change for any of the three — `Booking`/`WaitlistEntry` already carry a broad `*_staff_read` policy covering School Owner/Manager, Branch Staff, and Instructor (the same caller set `TenantAuthorizationService.assertStaffAtSchool` already gates these two endpoints on), and `RoleGrant`'s own `rolegrant_school_manager_scope` policy already covers `findAllForUser`'s caller set. `WaitlistEntry.findAllForClass` remains deliberately unpaginated, per its own pre-existing documented reasoning — untouched by this change.

### What this does NOT resolve

`InstructorFormModal.tsx`'s candidate field (Decision 111) and `StaffPage.tsx`'s *invite* form (Decision 112) are structurally different — a picker over an unknown, not-yet-scoped candidate set rather than a lookup of an already-known id — and are recorded separately rather than folded into this mechanical extension.

### Recorded by

Logged while extending Decision 109's pattern to the remaining known-id lookup sites, 21 Sep 2026, as part of a direct request to fix the Class Detail/InstructorFormModal/StaffPage name gaps.

---

## Decision 111 — InstructorFormModal candidate picker: new `GET .../instructors/eligible-users` endpoint, scoped to active INSTRUCTOR RoleGrant holders

**Date:** 21 Sep 2026
**Status:** Developer-level inference, flagged for Architect confirmation — not a product-owner ruling
**Resolves:** `InstructorFormModal.tsx`'s raw `userId` text field, previously requiring the School Owner to already know and correctly type a target User's UUID with no way to discover one in the UI.

### Decision

New `GET /schools/{schoolId}/instructors/eligible-users`, School-Owner-gated (same gate as `POST .../instructors`), returning every User holding an active `INSTRUCTOR` RoleGrant at that School — i.e. exactly the set `TenantAuthorizationService.assertValidInstructor` would already accept for a create() call, fanned out into a real list instead of checked one candidate at a time. Query shape: `tx.roleGrant.findMany({ where: { schoolId, role: 'INSTRUCTOR', revokedAt: null }, distinct: ['userId'], select: { user: {...} } })`. Deliberately unpaginated (bounded by realistic Instructor headcount per School, matching this codebase's existing precedent of leaving small/bounded sets unpaginated) and hardcoded to `INSTRUCTOR` — no generic role parameter, since `InstructorFormModal` is this endpoint's only consumer. Response includes `email` alongside `id`/`firstName`/`surname` specifically to disambiguate same-name candidates in the picker UI. `InstructorFormModal.tsx`'s `userId` field is now a `SelectField` populated from this endpoint (create only — edit already hides this field, since re-pointing an existing profile at a different User isn't a real product action).

### What this does NOT resolve

Whether "eligible" should ever broaden beyond "already holds an active INSTRUCTOR RoleGrant at this School" (e.g. surfacing users who could be granted the role but haven't been yet) — deliberately kept narrow, matching the existing hint text on this field ("Must already hold an active Instructor role at this School — grant it first on the Staff page"), not a new capability.

### Recorded by

Logged while designing the InstructorFormModal candidate-picker fix, 21 Sep 2026, as part of a direct request to fix the Class Detail/InstructorFormModal/StaffPage name gaps.

---

## Decision 112 — StaffPage invite-target lookup: exact email/phone match only, confirm before inviting, resolved directly with the user

**Date:** 21 Sep 2026
**Status:** Product-owner decision, made directly with the user
**Resolves:** `StaffPage.tsx`'s invite form, previously a raw `userId` text field with no way to discover a target's id — structurally different from Decisions 110/111 above because the invite target has **no existing RoleGrant at this School yet**, so `user_self_or_shared_school` and every other lookup this session built genuinely cannot see them; the ordinary RLS-scoped read has nothing to scope through.

### Decision

The user was asked what scope this lookup should have and chose **exact email or phone match only, never a name search** — avoiding an unprecedented cross-tenant User-search surface, matching the realistic "invite someone you already know" use case. New `GET /schools/{schoolId}/role-grants/invite-candidate` (query: `email` or `phone`, at least one required, enforced in the service rather than via a class-validator cross-field decorator — no precedent for one in this codebase), gated on `assertSchoolOwner` *before* the lookup runs. Uses `PrismaAuthService` — the same pre-tenant-context bypass `RoleGrantsService.create()`'s own target-existence-by-id check already uses (`prismaAuth.user.findUnique({ where: { id: targetUserId }, select: { id: true } })`), generalized to an exact email-or-phone `findFirst`, same minimum-fields-only convention (`id`, `firstName`, `surname` — never a full profile). Returns `{ found, id, firstName, surname }`, all null except `found` when no match. `RoleGrantsController`'s class-level `@Controller('users/:userId/role-grants')` prefix was converted to `@Controller()` with full explicit paths on all four routes (mechanical, no behavior change to the three pre-existing routes) since the new `schools/:schoolId/...` route can't live under that prefix. This is a separate lookup-then-confirm step, not folded into `create()` itself — `StaffPage.tsx`'s invite form now finds a candidate by email/phone, shows "Found: {name}" before any grant is created, and only then submits the existing, untouched `create()` call with the confirmed id.

### Why exact match, not a name search

An exact-match lookup can confirm whether a given email/phone is registered — the same class of exposure `AuthService.register()`'s own already-taken check already accepts for any anonymous, unauthenticated caller. Here the caller must already hold a real `SCHOOL_OWNER_MANAGER` grant at the School in question, a materially higher bar than "anonymous," so this isn't a new risk category and doesn't warrant protection beyond what's already standard elsewhere in this codebase. A name search was explicitly rejected as a broader, unprecedented cross-tenant User-search capability with no corresponding need — the realistic invite flow is "I know this specific person's email or phone," not "let me browse for someone."

### What this does NOT resolve

Whether a broader staff-directory/name-search capability should ever exist for some other confirmed use case — not addressed here, and not to be inferred from this decision if it comes up later.

### Recorded by

Scoped directly with the user via a clarifying question during this session ("what's the best [scope for this lookup]?"), who chose exact email/phone match only; implemented and logged 21 Sep 2026.

---

## Decision 113 — Name-resolution joins (Bookings/Waitlist/RoleGrant/Transactions) switched from a Prisma `include` to a `PrismaAuthService`-backed lookup, closing a real RLS visibility gap

**Date:** 21 Sep 2026
**Status:** Developer-level inference, flagged for Architect confirmation — not a product-owner ruling
**Resolves:** a correctness gap found during a deep-dive review (requested by the user before committing Decisions 110–112) of the just-implemented Bookings/Waitlist/RoleGrant name-resolution joins — a gap that, on inspection, also already existed in the merged Decision 109 Transactions endpoint.

### The gap

`user_self_or_shared_school` (`User`'s RLS policy, `20260902000000_init/migration.sql:235`) makes a `User` row visible to a caller only if that User currently holds an ACTIVE RoleGrant at a School where the caller also holds one — it checks the *target's* own current RoleGrant status, not just the caller's. `RoleGrant.user`, `Transaction.student`, `Booking.student`, and `WaitlistEntry.student` are all REQUIRED relations in `schema.prisma`; Decisions 109/110 resolved display names via a Prisma `include` on these relations, then destructured the result unconditionally (`({ student, ...b }) => ({ ...b, studentFirstName: student.firstName, ... })`).

Prisma's `include` issues a *separate* query for the related row through the *same* RLS-scoped connection — if RLS hides that row, Prisma doesn't error; it silently fails to resolve the relation (a known Prisma+RLS limitation), even though the TS type — trusting the schema's non-null relation — claims it can't be missing. The unconditional destructure would then throw on `student.firstName` for exactly that row.

This is concretely reachable, not theoretical: `GuardiansService.withdrawConsent` (`apps/api/src/guardians/guardians.service.ts:280`), on a BASELINE-tier consent withdrawal, runs `prismaJobs.roleGrant.updateMany({ where: { userId: existing.studentId, revokedAt: null }, data: { revokedAt: new Date() } })` — revoking every active RoleGrant a Student holds, everywhere, synchronously, in-request. Any Booking, WaitlistEntry, Transaction, or RoleGrant-lookup row referencing that Student/User from that point on hit this gap. The parent row itself stayed visible regardless — `booking_staff_read`/`rolegrant_school_manager_scope` key only off the *caller's* own active RoleGrant, never the target's — so this was specifically "the name breaks," not "the whole row disappears for a sensible reason."

Confirmed NOT to affect Decision 111 (`findEligibleInstructorUsers`): its `where` clause already requires the exact RoleGrant row being read to have `revokedAt: null` at the caller's own School, which is itself the visibility witness `user_self_or_shared_school` needs. Confirmed NOT to affect Decision 112 (`lookupInviteCandidate`): it already uses `PrismaAuthService`, immune to this class of gap entirely.

### Decision

Replaced the `include`-based join in `BookingsService.findAllForClass`, `WaitlistService.findAllForClass`, `RoleGrantsService.findAllForUser`, and — retrofitting the already-merged Decision 109 endpoint rather than leaving a known gap unaddressed — `TransactionsService.findAllForSchool`, with a shared helper, `resolveUserNames()` (`apps/api/src/common/prisma/resolve-user-names.ts`), that batch-resolves display names via `PrismaAuthService` — the same pre-tenant-context, SELECT-only-on-`User`, no-tenant-restriction connection `RoleGrantsService.create()` and Decision 112 already use. This makes name resolution depend on nothing but the row's own physical existence (User rows are never hard-deleted anywhere in this codebase today — verified via `grep -rn "user.delete" src`, zero matches), closing the gap completely rather than gracefully degrading it. Authorization is unaffected: the caller's right to see the parent row is still fully gated by the unchanged RLS policy + `assertStaffAtSchool`/`assertSchoolOwner` calls on the primary query; this only changes how the display name for an id the caller is already authorized to know about gets resolved, under the same minimum-fields-only (`id`, `firstName`, `surname`) discipline every other `PrismaAuthService` call site follows. `PrismaJobsService` was considered and ruled out — its `ultm8_jobs` Postgres role has no SELECT grant on `User` at all today (per its own header comment), which would have needed a new migration for a capability `PrismaAuthService` already has.

Response shapes are unchanged (`studentFirstName`/`studentSurname`/`userFirstName`/`userSurname` stay non-nullable strings, falling back to `''` only in the — currently unreachable, given no User hard-delete path — case the batch lookup somehow misses an id; kept as defense-in-depth, not an expected outcome). No new migration, no RLS/schema change, no OpenAPI schema drift (confirmed via a full `export:openapi` → `generate` diff).

### What this does NOT resolve

Whether `PrismaJobsService` should eventually be granted SELECT on `User` for genuine background/aggregate jobs that need it — out of scope here, not needed for this fix. Regression tests were added for all four call sites (`bookings.e2e-spec.ts` ×2, `tenants.e2e-spec.ts`, `memberships.e2e-spec.ts`) proving the name still resolves after the target's only RoleGrant at the School is revoked — real e2e execution still needs CI/a real DB, same as every other fix this session.

### Recorded by

Found during a deep-dive review the user explicitly requested before committing Decisions 110–112 ("deep dive before commit and push"), traced through the actual migration SQL and service code rather than assumed; the user was given three options (defensive patch only / defensive patch + retrofit Transactions / ship as-is and log as follow-up) and asked instead for "the best possible solution" — read as authorizing the fuller `PrismaAuthService`-based fix across all four sites, implemented and logged 21 Sep 2026.

---

## Decision 114 — Student roster: new `GET /schools/{id}/students`, Staff-gated (not Owner-only)

**Date:** 21 Sep 2026
**Status:** Developer-level inference, flagged for Architect confirmation — not a product-owner ruling
**Resolves:** a real, verified gap in `apps/school-portal` — no page anywhere let a School's Staff see who was actually enrolled as a Student. Confirmed there is no `apps/api/src/students/` module or `StudentsController` anywhere in this codebase (a Student is a User plus a `STUDENT`-role RoleGrant, not a separate entity — the same shape already established for Instructors), and confirmed independently by `docs/TRACK-B-ROADMAP.md` on the `track-b-student-app` branch, which found the identical gap from the mobile-app side while building Rank & Grading (Slice 3).

### Decision

New `GET /schools/{id}/students` on `SchoolsController`/`SchoolsService.findAllStudentsForSchool`, returning every User holding an active `STUDENT` RoleGrant at that School (`id`, `firstName`, `surname`, `email`, `enrolledAt` — the RoleGrant's own `grantedAt`, not `User.createdAt`). Query shape: `tx.roleGrant.findMany({ where: { schoolId, role: 'STUDENT', revokedAt: null }, distinct: ['userId'], select: { user: {...}, grantedAt: true } })` — the exact pattern Decision 111 (`findEligibleInstructorUsers`) already established for `INSTRUCTOR`. Safe from the Decision 113 RLS name-join gap by construction, same reasoning as Decision 111: the RoleGrant row being read is itself the `user_self_or_shared_school` visibility witness, so the joined `User` row is always resolvable — no `PrismaAuthService` lookup needed.

Gated on `TenantAuthorizationService.assertStaffAtSchool` (School Owner/Manager, Branch Staff, **or** Instructor — no `branchId` scoping, since Student enrollment itself has no Branch dimension) — deliberately broader than Decision 111's Owner-only gate, because seeing the roster is an ordinary read any Staff member needs, not an Owner-only write flow like granting the Instructor role is.

`apps/school-portal`: a new read-only `StudentsPage.tsx` (no create/edit — a Staff member doesn't create a Student profile directly; a Student joins via `SchoolsService.join()`, self-service or Guardian-on-behalf-of), added to the sidebar nav and router between Instructors and Classes.

### What this does NOT resolve

Whether the roster should eventually show more than name/email/enrollment date (Membership status, current Rank, Guardian info for a minor) — deliberately kept to the minimum-fields precedent this codebase already uses elsewhere (Decision 111), not expanded speculatively. A per-Student detail page is a natural follow-up, not built here.

### Recorded by

Logged while auditing what's actually built vs. missing across ULTM8's frontend apps, 21 Sep 2026, in the same pass that corrected `CLAUDE.md`'s stale "development has not started" framing and reviewed `track-b-student-app`'s own status.

---

## Decision 115 — Auth flow implemented for real: brand rail, passcode show/hide, success panel, segmented OTP input

**Date:** 22 Sep 2026
**Status:** Two sub-decisions resolved directly with the user; the rest is a mechanical port of the already-approved mockup direction (`docs/design-mockup-notes.md`), not a new judgment call
**Resolves:** the auth-flow mockups (Login "Combined" concept, Register, Verify OTP/Forgot/Reset — artifacts linked in `docs/design-mockup-notes.md`) were approved as the working direction but never implemented into `LoginPage.tsx`/`RegisterPage.tsx`/`VerifyOtpPage.tsx`/`ForgotPasscodePage.tsx`/`ResetPasscodePage.tsx` — the pages still only carried the two global tokens (Figtree, accent color) that cascade automatically, not any of the actual layout/pattern work.

### New shared `packages/ui` components (all token-driven, no hardcoded values)

- `PasscodeField` — `TextField`-compatible masked input with a show/hide eye-icon toggle. Applied to every 6-digit passcode entry point (Login, Register's passcode + confirm, Reset's new passcode + confirm), not just Login — the mockup notes only documented it for Login, but it's the same field type/concern everywhere, so this generalizes an already-approved pattern rather than inventing a new one.
- `SegmentedCodeInput` — 6-box digit input for the OTP/verification `code` field, single-box-per-digit with paste support. **Flagged assumption, not a confirmed value:** `VerifyOtpDto`/`ConfirmPasscodeResetDto` validate `code` as `@Length(4, 8)`, not a fixed length — the real Twilio Verify Service's configured code length isn't in this codebase at all. 6 was chosen as the default (matches this app's own passcode length and Twilio's typical default) after the user was shown this exact gap and chose segmented boxes over the safer plain-text default the mockup notes themselves recommended keeping. If the configured Twilio code length is ever confirmed to not be 6, this needs revisiting — not treated as settled beyond "reasonable default, clearly documented."
  - **Deep-dive review before commit** (user explicitly asked for one) caught two real interaction bugs in the first pass, both fixed and re-verified live before commit: (1) the original per-box `chars[index] = digit; chars.join('')` update, when a box ahead of the current end was clicked directly (a real mouse-driven path, not just sequential typing), advanced focus to the wrong box — `index + 1` of the *clicked* box rather than the true next empty slot, landing focus on an unrelated, still-empty box while the digit actually appeared elsewhere. Fixed by distinguishing an in-place edit (`index < value.length`, preserves the tail) from typing ahead of the end (always lands at the real next slot, focus follows it). (2) Backspace on an already-filled box silently did nothing in a real, reproducible case — with `maxLength={1}`, the browser places the cursor inside an existing single character ambiguously (before or after it depending on click position), and Backspace has nothing to delete when the cursor lands before it, so no `change` event ever fired. Fixed by handling Backspace explicitly in `onKeyDown` (`preventDefault` + direct state update) instead of relying on native deletion, and added `onFocus={(e) => e.target.select()}` so clicking an already-filled box actually lets the user retype over it (otherwise `maxLength={1}` blocks a keystroke with nothing selected to replace). All four interaction paths — click-ahead, sequential typing, in-place edit, multi-step backspace — were re-verified live via Playwright against the running app after the fix, not just re-read.
- `SuccessPanel` / `AuthSuccessCard` — the DESIGN.md-documented checkmark/title/subtitle/dismiss pattern, now built. Behavior resolved directly with the user (the mockup notes flagged this as explicitly open, not to be assumed): **auto-advances after 2s, but a dismiss (×) lets the user skip the wait immediately** — not auto-only, not dismiss-only.
- `Field` gained an optional `labelAction` slot (inline element next to the label, e.g. Login's "Forgot your passcode?" moved from the footer to inline with the Passcode label, per the approved Combined concept) and `.ultm8-field-row`/`.ultm8-details` utility classes (two-column field pairs on Register, a styled collapsible "Optional details" block replacing the unstyled native `<details>`).

### Per-page changes

- **Login** — brand rail (dark slate band: mark + "ULTM8" + tagline) above the card per the approved "Combined" concept; title copy "Log in" → "Welcome back"; passcode field is now `PasscodeField`; "Forgot your passcode?" moved inline; footer now just "New School? Create an account"; on success shows `AuthSuccessCard` ("Successful" / "You are successfully logged in to your account.") instead of redirecting immediately.
- **Register** — First/Surname and Passcode/Confirm now paired in two-column rows; passcode fields use `PasscodeField`; "Optional details" now visually styled; on success shows `AuthSuccessCard` ("Account created") before continuing to `/verify-otp`, instead of redirecting immediately (previously flagged as an open question in the mockup notes — resolved by the same auto-advance-+-dismissible answer above).
- **Verify OTP** — `code` field is now `SegmentedCodeInput` (see flagged assumption above). No success panel added here — not shown in the approved mockup for this screen, so not invented.
- **Forgot passcode** — unchanged; the mockup already matched current code exactly.
- **Reset passcode** — `code` field is `SegmentedCodeInput`; new/confirm passcode use `PasscodeField`; on success shows `AuthSuccessCard` ("Passcode changed") before continuing to `/login`, instead of redirecting immediately.

### Verification

`tsc --noEmit` clean across `packages/ui` and `apps/school-portal`. Verified live, not just compiled: ran the real stack (local Postgres/Redis/`apps/api`/`apps/school-portal` dev server) and screenshotted every page with real interaction (typed values, passcode-toggle click, full Login submit → success panel → auto-navigate to `/school`, segmented-box typing) via Playwright against `localhost:5173` — not a static mockup render.

### Recorded by

Resolved directly with the user via two explicit questions (success-panel timing; OTP field style) before implementing, per the mockup notes' own repeated "open question, not assumed" flags and this project's standing rule against silently deciding flagged-open design questions. Implemented 22 Sep 2026.

---

## Decision 116 — Remaining 13 mockups audited against real code; Instructor name-resolution gap closed

**Date:** 22 Sep 2026
**Status:** Developer-level inference (the new `InstructorResponseDto.firstName`/`surname` fields, same pattern as Decision 113), flagged for Architect confirmation like every other same-shape fix this session — everything else in this entry is a mechanical audit result, not a judgment call

**Resolves:** the user asked to "update the rest of the pages too" after the auth-flow pass (Decision 115) — the remaining 13 pages flagged `mockup` in `docs/design-mockup-notes.md` (Instructors, Staff, Branches, Timetable, Classes & detail, Disciplines/Skills/Ranks, Membership Plans, Transactions, Waivers, Franchises & detail, Notifications, and platform-admin's Admin Users/School lookup/Franchise lookup).

### Approach

Five parallel research passes (one per page group) compared each page's current real code against its already-approved mockup artifact, rather than re-deriving design decisions already made during the earlier mockup-review phase. Finding: **most pages already matched their mockups exactly** — the content/field decisions made during that phase were already real. Only four concrete gaps existed:

### 1. Instructors list — missing Id/avatar/Name columns, traced to a real backend gap

`InstructorResponseDto` had no name field at all — verified, not guessed: `Class.instructorId`/`TimetableSlot.instructorId` are direct FKs into `User` (schema.prisma's own comment: "NOT a separate Instructor table"), and `ClassFormModal`'s/`TimetableSlotFormModal`'s instructor pickers were falling back to `beltRanking` text or a truncated id because there was nothing else to show. Fixed the same way Decision 113 fixed the identical class of gap for Bookings/Waitlist/RoleGrant/Transactions: `InstructorsService.findAllForSchool` now resolves `firstName`/`surname` via `resolveUserNames`/`PrismaAuthService`, added to `InstructorResponseDto`. This single backend fix unlocked three frontend fixes at once (all three already reuse the same `useInstructors` hook):
- `InstructorsPage.tsx` — reordered to the Figma-confirmed column order (Id · avatar · Name · Ranking · Specializations · Experience · Phone · Branch · Actions), added a generic silhouette avatar placeholder (`photoUrl` is real/nullable but no upload UI exists anywhere yet, so an icon-for-no-photo is honest, not a fabricated photo).
- `ClassFormModal.tsx`/`TimetableSlotFormModal.tsx` — instructor-picker dropdown now labeled by real name instead of belt/ranking text or a truncated id.
- `ClassesPage.tsx` — added an Instructor column (matched on `instructor.userId === class.instructorId`, the same FK target), showing the resolved name.

Regression test added to `apps/api/test/instructors.e2e-spec.ts`: creates a dedicated Instructor profile, confirms the roster list resolves its name, then revokes its RoleGrant and confirms the name **still** resolves — proving this uses the RLS-immune `PrismaAuthService` path, not a plain `include` that Decision 113 already found breaks under exactly that condition.

### 2. Disciplines — Ranks table showed colour as plain text, not a swatch

`RankResponseDto.primaryColour`/`secondaryColour` are real structured fields (unlike Instructors' plain-text `beltRanking`), so a visual swatch reflects real data. `DisciplineDetailPage.tsx`'s Colour column now renders a colored dot + the text value. Note: the field is free text (`RankFormModal`'s own input is a plain `TextField`, not a color picker), not guaranteed to be a valid CSS color — handled safely by construction, since an invalid CSS `background` value is silently ignored by the browser rather than erroring.

### 3. platform-admin School/Franchise lookup — hardcoded pixel spacing, not design tokens

`SchoolLookupPage.tsx`/`FranchiseLookupPage.tsx` used inline `style={{gap: '4px 16px'}}`-style hardcoded values instead of this app's own spacing/typography tokens (both pages already inherit `@ultm8/ui`'s tokens/components automatically — confirmed, not assumed, via `main.tsx`'s `import '@ultm8/ui'` and a zero-result glob for any local CSS in this app). Added two small shared classes, `.ultm8-subcard-title`/`.ultm8-info-grid`, to `packages/ui/src/components.css`, applied to both pages' entity-detail cards. Not live-verified in the browser — this sandbox has no AWS Cognito configuration, and platform-admin's real login flow requires it — verified via `tsc --noEmit` and code review only; flagged explicitly rather than silently claimed as visually confirmed.

### 4. Everything else — confirmed already matching, nothing changed

Timetable, Class Detail (Bookings/Waitlist names — already fixed by Decision 113), Branches, Membership Plans, Transactions (its remaining "unimplemented" items were mockup items meant to be *excluded*, already correctly absent from real code), Waivers, Franchises & detail, Notifications, and platform-admin's Admin Users page all already matched their mockups exactly — re-confirmed by direct comparison, not assumed unchanged.

### What this does NOT resolve (explicitly flagged, not decided here)

- **Transactions' Failed/Disputed badge colors** are inverted between the mockup (Failed=red/danger, Disputed=blue/accent) and real code (`paymentStatusBadge.tsx`: Disputed=red/danger, Failed=blue/accent). Cosmetic only, not a data/structure gap, and no record anywhere of which was an intentional choice — left as-is rather than silently "fixed" against a reference that was never confirmed authoritative on this specific point.
- **Franchises' `mobileNumber` column** stays unrendered on the list (already wired into `FranchiseFormModal`, just not shown as a column) — the mockup itself flags this as a proposed addition, not a decided one, same category as Instructors' `photoUrl`. Not added.
- **StaffPage's card-section headings** use an inline-style hack (`className="ultm8-page-header__title" style={{fontSize: 18}}`) instead of a dedicated class — flagged by the audit, but NOT changed: the identical pattern is the established convention in `ClassDetailPage.tsx`/`TimetablePage.tsx`/`DisciplineDetailPage.tsx` too, so fixing it only on Staff would make that one page inconsistent with the other three rather than more consistent. A real fix here would mean introducing `.ultm8-subcard-title`-style tokens app-wide across all four pages at once — a separate, bigger decision, not bundled into this pass.
- **Instructor rank/grading-system link** (V1 manual dropdown vs. V2 grading-system link) — Decision 108's own scope, unaffected by this pass.

### Verification

`tsc --noEmit` clean across `apps/api`, `packages/ui`, `packages/api-client`, `apps/school-portal`, `apps/platform-admin`. `export:openapi` → `generate` diffed to confirm only the two new `InstructorResponseDto` fields changed. Live-verified against the running app (real Postgres/Redis/`apps/api`/`apps/school-portal`, Playwright against `localhost:5173`): Instructors list shows a real resolved name, Classes list shows a real resolved Instructor, Ranks table renders a real colour swatch. platform-admin's two changed pages verified by type-check and code review only (Cognito unavailable in this sandbox, noted above).

**`apps/api/test/instructors.e2e-spec.ts` was actually run against a real Postgres in this sandbox, not just compiled** — unlike most other decisions in this file, which could only claim `tsc --noEmit` and flag e2e execution as needing CI (no reachable database in earlier sessions). All 16 cases passed, including the new regression test, confirming the name-resolution fix holds against real RLS, not just against the type system. One environmental note worth recording: the first run attempt hung for ~43 minutes with the process pinned near-idle (only ~42s of real CPU time) because this sandbox's Postgres was killed by a container reset mid-run, and the Prisma client hung indefinitely retrying a dead connection instead of failing fast — not a code or test bug. Confirmed via `pg_isready`/`psql` returning "connection refused" mid-hang, killed the stuck process, restarted Postgres (data persisted — the same ephemerality/persistence pattern already documented elsewhere this session), and reran clean in 11.4s.

### Recorded by

Logged after the user asked to "update the rest of the pages too" following the auth-flow pass (Decision 115); five parallel research agents audited the remaining pages against their approved mockups, findings synthesized and implemented directly, 22 Sep 2026.
