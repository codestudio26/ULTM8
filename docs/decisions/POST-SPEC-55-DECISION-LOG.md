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
**Status:** Originally a Developer-level inference, flagged for Architect confirmation — the underlying mechanics were never specified anywhere in Spec 55 or SKILL.md and were designed, not confirmed, though approved by the user as a design proposal before implementation. **Ratified as a full product-owner decision, 11 Oct 2026**, while reviewing the v1.1/v1.2 open-decisions list — no change to the mechanics, this closes the Architect-confirmation gap.
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

## Decision 110 — General tenant/content offboarding: soft-archive with a 90-day retention window, gated behind an explicit close-account action

**Date:** 21 Sep 2026
**Status:** Product-owner decision, made directly with the user — Claude's own recommendation requested and followed (same shape as Decision 105)
**Resolves:** the systemic `[UNRESOLVED]` gap `ultm8-app-publishing` §4/§5.5 flags ("General tenant/School cancellation and offboarding... is not otherwise specified anywhere in Spec 55... flagged as its own new open item") — the reason `School`, `Branch`, `Franchise`, `Class`, `TimetableSlot`, `Instructor`, `MembershipPlan`, `Rank`, `Waiver`, and `Curriculum`/`Lesson` have no `DELETE` endpoint anywhere, each with its own "general tenant offboarding is `[UNRESOLVED]`" code comment (16 files).

### Decision

Three parts, all requested from Claude as a recommendation based on standard SaaS-market practice rather than picked from a set of options, then accepted as-is:

1. **Semantics — soft-archive immediately, hard-delete after a 90-day retention window.** Not indefinite soft-archive, not immediate hard delete. On the trigger (below), the entity becomes read-only/hidden but is retained in full; after 90 days with no reversal, a scheduled job purges it for real. 90 days specifically to match the one directly analogous precedent already shipped in this exact codebase — the white-label credential grace-period purge (`ultm8-app-publishing` §5.5, Decision 27) — rather than inventing an unrelated number. This also matches ordinary market practice: a bounded retention window balances "don't destroy data over a change of mind" against GDPR/LGPD's own data-minimization principle (Art 5(1)(c)), which disfavors retaining a cancelled tenant's data indefinitely "just in case."
   - **One flagged exception, not resolved here:** `Waiver` signatures are legal liability documents; many jurisdictions require retaining a signed waiver well past 90 days (statute-of-limitations periods, often years — longer still if the signer was a minor, running from age of majority). `Waiver`'s own purge timing needs real legal input for the jurisdictions ULTM8 operates in before it runs on the same 90-day clock as everything else. Every other entity in the list above gets the uniform 90-day rule.
2. **Trigger — two independent triggers, not one; platform-subscription cancellation alone is NOT one of them.** `platformSubscriptionStatus` → `CANCELED` (Phase 54, already shipped) stays billing-only: it blocks new writes via the existing `SubscriptionGateService` degraded-portal gate, but does **not** by itself start the offboarding countdown — a School/Franchise that simply stops paying keeps its data fully intact, the same way Stripe/Shopify/GitHub/Salesforce all separate "billing lapsed" from "delete my account." The only trigger for actual offboarding is a new, explicit, separate **close-account action** — Platform-Admin-mediated, FULL_ADMIN-only, expected to need its own confirmation step (e.g. re-typing the School/Franchise name) given the consequence. That action is what starts the soft-archive → 90-day countdown from part 1.
3. **Scope — School/Franchise-level (and owned content) offboarding only; GDPR/LGPD per-user erasure is explicitly out of scope here.** An individual Student/User's "erase my personal data" request is a different legal mechanism (GDPR Art 17, with its own exceptions for legal retention obligations), a different trigger (a specific erasure/DSAR request, not a School closing), and a different technical shape (anonymize/delete one person's rows without necessarily touching the School/Franchise around them). Conflating the two into one decision would understate the legal complexity either one deserves on its own.

### What this does NOT resolve

- **No code shipped by this decision.** The actual close-account endpoint(s), the soft-archived/read-only state's own access behavior, the 90-day scheduled purge job, and updating all 16 flagged files from "no delete method" to this real lifecycle is genuine follow-up build work (`docs/ULTM8-MASTER-ROADMAP.md` §5 item 9), not done here.
- **Who may trigger close-account** is stated above as Platform-Admin-mediated (FULL_ADMIN-only) as part of the recommendation, but this was not independently re-verified against Spec 55 §4.4's own role table before being proposed — worth a quick confirmation pass before it's built, same discipline Decision 105's own citation-checking used.
- **`Waiver`'s own retention period** is explicitly left open pending real legal input — not resolved by the uniform 90-day rule this decision sets for everything else.
- **Per-user GDPR/LGPD erasure** remains its own separate, not-yet-made decision — still tracked as its own open item (`docs/ULTM8-MASTER-ROADMAP.md` §4, "a tracking gap, not a technical one").

### Recorded by

Logged during a direct exchange with the user, 21 Sep 2026 — presented with the three sub-questions above (offboarding semantics, trigger, and GDPR/LGPD scope) plus multiple options for each, the user asked for Claude's own recommendation based on standard market practice rather than picking between the options; the recommendation was given for all three and followed as given, the same "recommendation given, user's own choice followed" shape as Decisions 101–105.

---

## Decision 111 — Stripe dispute handling (Decision 55) built end to end: webhook mechanics now, chargeback-pattern threshold set at 2 lost disputes

**Date:** 22 Sep 2026
**Status:** Product-owner decision (the threshold number) plus a Developer-level scope/design split, both made directly with the user
**Resolves:** Decision 55's own confirmed dispute-handling contract — idempotent status-driven webhook processing across `Transaction`/`FranchiseFeeCharge`/`PlatformCharge`, refund/credit-restore frozen while disputed, Membership force-Expiry plus Stripe Subscription cancellation on a loss, notification routed by who's financially exposed — was fully specified in the schema (all three entities already carry `status: DISPUTED` and a `disputedAmount` column) but had zero code behind it: `charge.dispute.created/updated/closed` was a literal no-op in `stripe-webhook-processing.processor.ts`, and Decision 68's own `chargeback-pattern-restriction` job didn't exist at all. Surfaced during a deep-dive audit of Track A for anything open, not previously tracked in `docs/TRACK-A-ROADMAP.md`.

### Decision

**Split into two phases**, because the second genuinely depends on data the first produces:

- **Phase A (this decision's own scope, built now)** — the dispute webhook mechanics themselves: real `charge.dispute.*` handlers, the refund/credit-restore freeze, Membership/Subscription force-actions on a loss, and notification routing. Fully specified by Decision 55; no open question blocks it.
- **Phase B (deferred, separately scoped when built)** — the `chargeback-pattern-restriction` scheduled job (Decision 68) that counts a Student's lost disputes across every School they hold a grant at and restricts them to Cash/Bank-only past a threshold. Genuinely depends on Phase A actually recording `DISPUTED` outcomes to count.

**The chargeback threshold is set at 2 lost disputes** — Claude's own recommendation, requested and followed, same shape as Decisions 101–105: the job is named "chargeback-*pattern*-restriction," and a single lost dispute is not a pattern — it's as likely a genuinely fraudulent card or an honest billing dispute as it is abuse. Two is the common "second strike" heuristic in subscription businesses generally (one loss tolerated as noise, a second confirms it isn't). This does not need to be treated as final — it is a business risk-tolerance call, not an engineering constraint, and can be revisited.

### Phase A's design, confirmed against the actual code before writing anything

- **Correlation** mirrors `handleSubscriptionDeleted()`'s own established "try each correlator column in turn" shape: a disputed charge is matched against `Transaction.stripePaymentIntentId` first (one-time Membership purchases), then `FranchiseFeeCharge`/`PlatformCharge` via their Invoice's Subscription id (recurring, Direct-charge or platform billing) — never a guess, always a real stored correlator.
- **Freeze while disputed** — verified there are only two real call sites to guard, not a broad sweep: `BookingsService.restoreCredit()` (the only real Auto-Credit path — Auto-Refund for Membership purchases doesn't call Stripe at all yet, a separate, already-tracked gap, so there's nothing there to freeze) and `FranchiseFeesService.refund()` (the only real `stripe.refunds.create()` call in the codebase outside Connect onboarding). `PlatformCharge` has no refund endpoint at all yet, so nothing to freeze there either.
- **Lost-dispute consequences** — confirmed only `Transaction` (Membership) disputes carry a further consequence: force-`Membership.status = EXPIRED`, and cancel the Stripe Subscription if `stripeSubscriptionId` is set. Nothing in Decision 55 or the schema implies an equivalent forced action on a lost `FranchiseFeeCharge`/`PlatformCharge` dispute — recording the loss is sufficient there.
- **Notification routing "by who's financially exposed"** — `Transaction` disputes notify the School Owner/Manager, `FranchiseFeeCharge` disputes notify the Franchise Owner, both via the existing `notification-fanout` job (a real, working channel). `PlatformCharge` disputes have no equivalent channel: `Notification.userId` only ever points at tenant `User`, never `AdminUser` — Platform Admin is a structurally separate identity with no notification inbox anywhere in this codebase. Rather than inventing one, this follows the same "reasonable-minimum, flagged for Architect review" treatment Decision 95 gave an analogous gap: a loud log line, not a fabricated notification path. **Corrected during implementation**: the original scoping conversation for this bullet said "an `AuditLogService` entry plus a loud log line" — checked directly against `AuditLogService`'s own `RecordAuditLogInput` interface before writing the handler, and that service requires a real `adminUserId` actor, which a system/webhook-triggered event genuinely has none of. `AuditLogService` is the wrong mechanism here; a plain `Logger.error()` call is the actual, correct treatment, and is what's built.

### What this does NOT resolve

Phase B itself (the actual `chargeback-pattern-restriction` job, the new `User.paymentRestrictedAt` field, and the Cash/Bank-only purchase gate) is not built by this decision — only scoped and unblocked by it. The already-tracked, separate gap that Membership/Transaction "Auto-Refund" never actually calls Stripe (it only ever restores credit) is unaffected either way — freezing a refund path that doesn't exist yet is moot until that gap is closed on its own.

### Recorded by

Logged during a direct scoping conversation with the user, 22 Sep 2026, following a full deep-dive audit of Track A that surfaced this as a confirmed-but-unbuilt gap. Options for the threshold were presented with a stated recommendation and reasoning; the user asked for the reasoning restated in more detail plus a fuller explanation of what each phase actually contains before deciding, then accepted the recommendation (2) and asked to proceed with Phase A.

---

## Decision 112 — `chargeback-pattern-restriction` (Decision 68/111 Phase B) built: three Developer-level design gaps closed, all flagged before writing code

**Date:** 22 Sep 2026
**Status:** Developer-level design decisions, made while implementing an already-confirmed rule (Decision 68) — none of these invent new business logic; each closes a genuine implementation gap Decision 68's own confirmed text left unanswered once checked against the actual codebase.
**Resolves:** Decision 111's own deferred Phase B — the job itself, `User.paymentRestrictedAt`, and the Cash/Bank-only purchase gate.

### Decision 68's own text, quoted (skills/ultm8-domain-rules/SKILL.md §9)

"A platform-wide `chargeback-pattern-restriction` background job counts a Student's **lost** Stripe disputes (`Transaction.status = Disputed` outcomes... that resolve as lost) across **every School the Student holds a RoleGrant at**... Once a confirmed threshold is exceeded, the Student is restricted to **Cash/Bank Transfer payment methods only**, going forward... The Student's current School(s) are notified via the existing notification-fanout mechanism."

### Gap 1 — the schema cannot currently distinguish a lost dispute from a merely open one

Decision 111 Phase A made `Transaction.status = DISPUTED` the terminal representation for BOTH an unresolved, in-progress dispute (`needs_response`, `under_review`, etc.) and a permanently lost one — Decision 55's own confirmed contract never needed to tell them apart (the only entity-level consequence of a loss, Membership force-Expiry, is applied at the moment of loss, not queried back out later). Decision 68's own text above explicitly says "outcomes... that resolve as lost," which this schema genuinely cannot answer today. **Closed by adding `Transaction.disputeLostAt DateTime?`** — set at the exact moment `stripe-webhook-processing`'s dispute handler already determines `outcome.lost === true` (Phase A's own `resolveDisputeOutcome()`), cleared back to `null` on the rare reversal to `won`. This is not new business logic — it's persisting a fact Phase A's own code already computes in memory but never previously needed to write down.

### Decision — event-triggered, not a periodic sweep

Decision 68 calls this "a background job," which this codebase already uses for two genuinely different shapes: a periodic `Processor`/`Scheduler` pair (`FranchiseFeeUsageReportingProcessor`/`Scheduler`, `BookingNoShowProcessingProcessor`/`Scheduler`) and a plain event-triggered `Processor` with no scheduler at all, enqueued by whichever action produces the event (`WaitlistCascadeProcessingProcessor`, triggered by a Booking cancellation freeing a seat). Nothing in Decision 68's text requires a periodic cadence, and a periodic sweep would need its own extra idempotency bookkeeping to avoid re-notifying a already-restricted Student's Schools on every run forever. **Built as event-triggered**: `stripe-webhook-processing`'s dispute handler enqueues a `chargeback-pattern-restriction` check the instant it records a NEW lost dispute (`outcome.lost === true`), mirroring `WaitlistCascadeProcessingProcessor`'s exact shape — a `Processor` only, no `Scheduler`. The check itself (count this Student's lost disputes, compare to the threshold, restrict once) is naturally idempotent per Stripe event via the same `ProcessedStripeEvent` dedup Phase A already relies on upstream.

### Decision — what "restricted to Cash/Bank Transfer" means in THIS codebase, verified against the actual purchase flow before writing the gate

Checked `MembershipsService.purchase()` directly rather than assuming a Student ever chooses a payment method per-purchase: **they don't**. Payment method is fixed per School — `paymentAccount.provider` (`STRIPE` or `CASH`/`BANK_TRANSFER`, one value per School's own `PaymentAccount` row) — never a per-purchase Student choice, and `PurchaseMembershipDto` carries no such field. So "restricted to Cash/Bank Transfer payment methods only" cannot mean "offer the Student a Cash/Bank option instead" (no such per-purchase choice exists to offer); it can only mean **block the purchase outright at any School whose PaymentAccount is Stripe-only**, while leaving purchases at an already-Cash/Bank-provider School untouched (the Student was already paying Cash/Bank there — nothing changes). Built as a single guard inside `purchase()`'s existing `paymentAccount.provider === 'STRIPE'` branch, checking `User.paymentRestrictedAt`.

### What this does NOT resolve

No appeal/reversal mechanism — `paymentRestrictedAt` is set once and never cleared by any code this decision builds; Decision 68's own text describes no un-restriction path, and inventing one would be exactly the "fill the gap with a plausible guess" CLAUDE.md forbids. Same accepted, unclosed loophole Decision 68 itself already names: a Student can still evade this by registering a fresh account, which this decision does not attempt to close either.

### Recorded by

Logged while implementing Phase B directly, 22 Sep 2026, following the user's "Go ahead and start Phase B." All three decisions above are implementation-level closures of an already-`[CONFIRMED]` rule, not new business logic — flagged here per this codebase's own standing discipline rather than silently assumed.

---

## Decision 113 — Track B, Slice 1: `apps/student` built as an Expo-managed React Native app; secure token storage via `expo-secure-store`

**Date:** 16 Sep 2026
**Status:** Product-owner decision, made directly with the user
**Resolves:** `docs/TRACK-B-STUDENT-APP-KICKOFF.md`'s two flagged pre-Task-1 decisions ("Expo vs. bare React Native" and "RN-appropriate secure token storage") — both explicitly called out there as real trade-offs not to default on silently.

**Numbering note:** originally logged as "Decision 98" on the `track-b-student-app` branch, chosen independently while that branch was already diverged from `master` — by the time this branch was synced back (see the "Sync Track B onto master" PR), `master` had separately used 98 for an unrelated decision (School→Franchise linking, above) and continued on through 109, and three more decisions (110–112) existed in still-open PRs against `master`. Renumbered to the next free slot, 113, at sync time rather than disturbing any already-published number; nothing about the decision's own content, date, or reasoning changed. The three citations of "Decision 98" in `apps/student`'s own code/docs (`README.md`, `package.json`, `src/auth/secureTokenStore.ts`) were updated to cite 113 in the same sync.

### Decision

`apps/student` is built as an **Expo-managed workflow** React Native app, not bare RN. Reasoning, per the kickoff doc's own framing, confirmed with the user directly ("suggest me" → recommendation given → accepted): the per-School white-label rebuild pipeline (`packages/build-pipeline`, Spec 55 §5) is already a confirmed requirement, and EAS Build is the more direct path to it than a bare-RN native-module setup would be. The counter-consideration (bare RN's finer native-module control, relevant if QR-scanning/camera-consent handling end up needing something Expo's managed workflow doesn't expose) is not a concern yet in this walking-skeleton slice — QR check-in is explicitly out of scope here (see kickoff doc's "Explicitly not doing" list) and can force a reconsideration later if it ever becomes one.

Token storage uses `expo-secure-store` (the RN-appropriate secure-storage primitive named as the Expo-path default in the kickoff doc), not `packages/auth`'s existing `TokenStore` (browser-only `sessionStorage`/`atob`) and not `AsyncStorage` (plain, insecure storage for a JWT). This inherits the kickoff doc's already-flagged, known UX limitation: `POST /auth/login` returns only `{ accessToken }`, no refresh-token endpoint exists yet (`[UNRESOLVED]`, `ultm8-nestjs-module` §7), so sessions force re-login at the access token's TTL (≤15 minutes) regardless of storage mechanism — not solved by this decision, carried forward as-is.

### Toolchain check (before Task 1 started)

Verified directly in the Track B working environment (16 Sep 2026): Node v22.20.0, npm 10.9.3 (matches the monorepo's pinned `packageManager`). No local `ANDROID_HOME`/`ANDROID_SDK_ROOT`/`adb` — confirming `apps/student/README.md`'s original Phase 1 note that a local Metro/Xcode/Android native toolchain isn't available in this environment. `npx expo` and `npx eas-cli` both resolve and run cleanly, which is what the Expo path actually depends on for this slice: `expo start` (Metro + Expo Go) for local dev/testing, and EAS Build's cloud service for anything needing a real native binary — neither requires a local Android SDK or Xcode install. This is a environment capability match in Expo's favor, not just a spec-alignment one.

### What this does NOT resolve

Camera/QR-scanning native-module needs (still `[UNRESOLVED]` per the kickoff doc and `ultm8-domain-rules` §12/§18) — if a future slice's QR check-in work finds Expo's managed workflow genuinely insufficient, that would be a new decision, not a silent reversal of this one. Also does not resolve the missing refresh-token endpoint (`ultm8-nestjs-module` §7) — still open, backend-track territory.

### Recorded by

Logged during a direct, live exchange with the user, 16 Sep 2026 — user asked "what's best? suggest me" on the Expo-vs-bare-RN question; the kickoff doc's own recommendation (Expo) was restated and accepted. Renumbered from 98 to 113 during the Track B/master sync (see numbering note above).

---

## Decision 114 — Booking/WaitlistEntry/RoleGrant name resolution: mechanical extension of Decision 109's embed pattern

**Date:** 21 Sep 2026
**Status:** Developer-level inference, flagged for Architect confirmation — not a product-owner ruling
**Resolves:** two of the three sites Decision 109 explicitly left open — `ClassDetailPage.tsx`'s Bookings/Waitlist tables and `StaffPage.tsx`'s lookup-results table, both showing a raw `studentId`/`userId` instead of a name for the same reason Transactions did (no join resolved it).

### Decision

Same shape as Decision 109, applied to three more query/DTO pairs, no new architectural choice made:

- `BookingsService.findAllForClass` / `WaitlistService.findAllForClass` now join `Booking.student`/`WaitlistEntry.student` (`User.firstName`/`surname`), flattened onto `studentFirstName`/`studentSurname` on `BookingResponseDto`/`WaitlistEntryResponseDto`. `ClassDetailPage.tsx` renders the resolved name, falling back to the truncated id.
- `RoleGrantsService.findAllForUser` now joins `RoleGrant.user`, flattened onto `userFirstName`/`userSurname` on `RoleGrantResponseDto`. `StaffPage.tsx`'s lookup-results table shows a "Showing grants for **{name}**" heading above the table rather than a repeated per-row column, since every row in a single lookup shares the same target user.

No RLS/migration change for any of the three — `Booking`/`WaitlistEntry` already carry a broad `*_staff_read` policy covering School Owner/Manager, Branch Staff, and Instructor (the same caller set `TenantAuthorizationService.assertStaffAtSchool` already gates these two endpoints on), and `RoleGrant`'s own `rolegrant_school_manager_scope` policy already covers `findAllForUser`'s caller set. `WaitlistEntry.findAllForClass` remains deliberately unpaginated, per its own pre-existing documented reasoning — untouched by this change.

### What this does NOT resolve

`InstructorFormModal.tsx`'s candidate field (Decision 115) and `StaffPage.tsx`'s *invite* form (Decision 116) are structurally different — a picker over an unknown, not-yet-scoped candidate set rather than a lookup of an already-known id — and are recorded separately rather than folded into this mechanical extension.

### Recorded by

Logged while extending Decision 109's pattern to the remaining known-id lookup sites, 21 Sep 2026, as part of a direct request to fix the Class Detail/InstructorFormModal/StaffPage name gaps.

---

## Decision 115 — InstructorFormModal candidate picker: new `GET .../instructors/eligible-users` endpoint, scoped to active INSTRUCTOR RoleGrant holders

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

## Decision 116 — StaffPage invite-target lookup: exact email/phone match only, confirm before inviting, resolved directly with the user

**Date:** 21 Sep 2026
**Status:** Product-owner decision, made directly with the user
**Resolves:** `StaffPage.tsx`'s invite form, previously a raw `userId` text field with no way to discover a target's id — structurally different from Decisions 114/115 above because the invite target has **no existing RoleGrant at this School yet**, so `user_self_or_shared_school` and every other lookup this session built genuinely cannot see them; the ordinary RLS-scoped read has nothing to scope through.

### Decision

The user was asked what scope this lookup should have and chose **exact email or phone match only, never a name search** — avoiding an unprecedented cross-tenant User-search surface, matching the realistic "invite someone you already know" use case. New `GET /schools/{schoolId}/role-grants/invite-candidate` (query: `email` or `phone`, at least one required, enforced in the service rather than via a class-validator cross-field decorator — no precedent for one in this codebase), gated on `assertSchoolOwner` *before* the lookup runs. Uses `PrismaAuthService` — the same pre-tenant-context bypass `RoleGrantsService.create()`'s own target-existence-by-id check already uses (`prismaAuth.user.findUnique({ where: { id: targetUserId }, select: { id: true } })`), generalized to an exact email-or-phone `findFirst`, same minimum-fields-only convention (`id`, `firstName`, `surname` — never a full profile). Returns `{ found, id, firstName, surname }`, all null except `found` when no match. `RoleGrantsController`'s class-level `@Controller('users/:userId/role-grants')` prefix was converted to `@Controller()` with full explicit paths on all four routes (mechanical, no behavior change to the three pre-existing routes) since the new `schools/:schoolId/...` route can't live under that prefix. This is a separate lookup-then-confirm step, not folded into `create()` itself — `StaffPage.tsx`'s invite form now finds a candidate by email/phone, shows "Found: {name}" before any grant is created, and only then submits the existing, untouched `create()` call with the confirmed id.

### Why exact match, not a name search

An exact-match lookup can confirm whether a given email/phone is registered — the same class of exposure `AuthService.register()`'s own already-taken check already accepts for any anonymous, unauthenticated caller. Here the caller must already hold a real `SCHOOL_OWNER_MANAGER` grant at the School in question, a materially higher bar than "anonymous," so this isn't a new risk category and doesn't warrant protection beyond what's already standard elsewhere in this codebase. A name search was explicitly rejected as a broader, unprecedented cross-tenant User-search capability with no corresponding need — the realistic invite flow is "I know this specific person's email or phone," not "let me browse for someone."

### What this does NOT resolve

Whether a broader staff-directory/name-search capability should ever exist for some other confirmed use case — not addressed here, and not to be inferred from this decision if it comes up later.

### Recorded by

Scoped directly with the user via a clarifying question during this session ("what's the best [scope for this lookup]?"), who chose exact email/phone match only; implemented and logged 21 Sep 2026.

---

## Decision 117 — Name-resolution joins (Bookings/Waitlist/RoleGrant/Transactions) switched from a Prisma `include` to a `PrismaAuthService`-backed lookup, closing a real RLS visibility gap

**Date:** 21 Sep 2026
**Status:** Developer-level inference, flagged for Architect confirmation — not a product-owner ruling
**Resolves:** a correctness gap found during a deep-dive review (requested by the user before committing Decisions 114–116) of the just-implemented Bookings/Waitlist/RoleGrant name-resolution joins — a gap that, on inspection, also already existed in the merged Decision 109 Transactions endpoint.

### The gap

`user_self_or_shared_school` (`User`'s RLS policy, `20260902000000_init/migration.sql:235`) makes a `User` row visible to a caller only if that User currently holds an ACTIVE RoleGrant at a School where the caller also holds one — it checks the *target's* own current RoleGrant status, not just the caller's. `RoleGrant.user`, `Transaction.student`, `Booking.student`, and `WaitlistEntry.student` are all REQUIRED relations in `schema.prisma`; Decisions 109/113 resolved display names via a Prisma `include` on these relations, then destructured the result unconditionally (`({ student, ...b }) => ({ ...b, studentFirstName: student.firstName, ... })`).

Prisma's `include` issues a *separate* query for the related row through the *same* RLS-scoped connection — if RLS hides that row, Prisma doesn't error; it silently fails to resolve the relation (a known Prisma+RLS limitation), even though the TS type — trusting the schema's non-null relation — claims it can't be missing. The unconditional destructure would then throw on `student.firstName` for exactly that row.

This is concretely reachable, not theoretical: `GuardiansService.withdrawConsent` (`apps/api/src/guardians/guardians.service.ts:280`), on a BASELINE-tier consent withdrawal, runs `prismaJobs.roleGrant.updateMany({ where: { userId: existing.studentId, revokedAt: null }, data: { revokedAt: new Date() } })` — revoking every active RoleGrant a Student holds, everywhere, synchronously, in-request. Any Booking, WaitlistEntry, Transaction, or RoleGrant-lookup row referencing that Student/User from that point on hit this gap. The parent row itself stayed visible regardless — `booking_staff_read`/`rolegrant_school_manager_scope` key only off the *caller's* own active RoleGrant, never the target's — so this was specifically "the name breaks," not "the whole row disappears for a sensible reason."

Confirmed NOT to affect Decision 115 (`findEligibleInstructorUsers`): its `where` clause already requires the exact RoleGrant row being read to have `revokedAt: null` at the caller's own School, which is itself the visibility witness `user_self_or_shared_school` needs. Confirmed NOT to affect Decision 116 (`lookupInviteCandidate`): it already uses `PrismaAuthService`, immune to this class of gap entirely.

### Decision

Replaced the `include`-based join in `BookingsService.findAllForClass`, `WaitlistService.findAllForClass`, `RoleGrantsService.findAllForUser`, and — retrofitting the already-merged Decision 109 endpoint rather than leaving a known gap unaddressed — `TransactionsService.findAllForSchool`, with a shared helper, `resolveUserNames()` (`apps/api/src/common/prisma/resolve-user-names.ts`), that batch-resolves display names via `PrismaAuthService` — the same pre-tenant-context, SELECT-only-on-`User`, no-tenant-restriction connection `RoleGrantsService.create()` and Decision 116 already use. This makes name resolution depend on nothing but the row's own physical existence (User rows are never hard-deleted anywhere in this codebase today — verified via `grep -rn "user.delete" src`, zero matches), closing the gap completely rather than gracefully degrading it. Authorization is unaffected: the caller's right to see the parent row is still fully gated by the unchanged RLS policy + `assertStaffAtSchool`/`assertSchoolOwner` calls on the primary query; this only changes how the display name for an id the caller is already authorized to know about gets resolved, under the same minimum-fields-only (`id`, `firstName`, `surname`) discipline every other `PrismaAuthService` call site follows. `PrismaJobsService` was considered and ruled out — its `ultm8_jobs` Postgres role has no SELECT grant on `User` at all today (per its own header comment), which would have needed a new migration for a capability `PrismaAuthService` already has.

Response shapes are unchanged (`studentFirstName`/`studentSurname`/`userFirstName`/`userSurname` stay non-nullable strings, falling back to `''` only in the — currently unreachable, given no User hard-delete path — case the batch lookup somehow misses an id; kept as defense-in-depth, not an expected outcome). No new migration, no RLS/schema change, no OpenAPI schema drift (confirmed via a full `export:openapi` → `generate` diff).

### What this does NOT resolve

Whether `PrismaJobsService` should eventually be granted SELECT on `User` for genuine background/aggregate jobs that need it — out of scope here, not needed for this fix. Regression tests were added for all four call sites (`bookings.e2e-spec.ts` ×2, `tenants.e2e-spec.ts`, `memberships.e2e-spec.ts`) proving the name still resolves after the target's only RoleGrant at the School is revoked — real e2e execution still needs CI/a real DB, same as every other fix this session.

### Recorded by

Found during a deep-dive review the user explicitly requested before committing Decisions 114–116 ("deep dive before commit and push"), traced through the actual migration SQL and service code rather than assumed; the user was given three options (defensive patch only / defensive patch + retrofit Transactions / ship as-is and log as follow-up) and asked instead for "the best possible solution" — read as authorizing the fuller `PrismaAuthService`-based fix across all four sites, implemented and logged 21 Sep 2026.

---

## Decision 118 — Student roster: new `GET /schools/{id}/students`, Staff-gated (not Owner-only)

**Date:** 21 Sep 2026
**Status:** Developer-level inference, flagged for Architect confirmation — not a product-owner ruling
**Resolves:** a real, verified gap in `apps/school-portal` — no page anywhere let a School's Staff see who was actually enrolled as a Student. Confirmed there is no `apps/api/src/students/` module or `StudentsController` anywhere in this codebase (a Student is a User plus a `STUDENT`-role RoleGrant, not a separate entity — the same shape already established for Instructors), and confirmed independently by `docs/TRACK-B-ROADMAP.md` on the `track-b-student-app` branch, which found the identical gap from the mobile-app side while building Rank & Grading (Slice 3).

### Decision

New `GET /schools/{id}/students` on `SchoolsController`/`SchoolsService.findAllStudentsForSchool`, returning every User holding an active `STUDENT` RoleGrant at that School (`id`, `firstName`, `surname`, `email`, `enrolledAt` — the RoleGrant's own `grantedAt`, not `User.createdAt`). Query shape: `tx.roleGrant.findMany({ where: { schoolId, role: 'STUDENT', revokedAt: null }, distinct: ['userId'], select: { user: {...}, grantedAt: true } })` — the exact pattern Decision 115 (`findEligibleInstructorUsers`) already established for `INSTRUCTOR`. Safe from the Decision 117 RLS name-join gap by construction, same reasoning as Decision 115: the RoleGrant row being read is itself the `user_self_or_shared_school` visibility witness, so the joined `User` row is always resolvable — no `PrismaAuthService` lookup needed.

Gated on `TenantAuthorizationService.assertStaffAtSchool` (School Owner/Manager, Branch Staff, **or** Instructor — no `branchId` scoping, since Student enrollment itself has no Branch dimension) — deliberately broader than Decision 115's Owner-only gate, because seeing the roster is an ordinary read any Staff member needs, not an Owner-only write flow like granting the Instructor role is.

`apps/school-portal`: a new read-only `StudentsPage.tsx` (no create/edit — a Staff member doesn't create a Student profile directly; a Student joins via `SchoolsService.join()`, self-service or Guardian-on-behalf-of), added to the sidebar nav and router between Instructors and Classes.

### What this does NOT resolve

Whether the roster should eventually show more than name/email/enrollment date (Membership status, current Rank, Guardian info for a minor) — deliberately kept to the minimum-fields precedent this codebase already uses elsewhere (Decision 115), not expanded speculatively. A per-Student detail page is a natural follow-up, not built here.

### Recorded by

Logged while auditing what's actually built vs. missing across ULTM8's frontend apps, 21 Sep 2026, in the same pass that corrected `CLAUDE.md`'s stale "development has not started" framing and reviewed `track-b-student-app`'s own status.

---

## Decision 119 — Auth flow implemented for real: brand rail, passcode show/hide, success panel, segmented OTP input

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

## Decision 120 — Remaining 13 mockups audited against real code; Instructor name-resolution gap closed

**Date:** 22 Sep 2026
**Status:** Developer-level inference (the new `InstructorResponseDto.firstName`/`surname` fields, same pattern as Decision 117), flagged for Architect confirmation like every other same-shape fix this session — everything else in this entry is a mechanical audit result, not a judgment call

**Resolves:** the user asked to "update the rest of the pages too" after the auth-flow pass (Decision 119) — the remaining 13 pages flagged `mockup` in `docs/design-mockup-notes.md` (Instructors, Staff, Branches, Timetable, Classes & detail, Disciplines/Skills/Ranks, Membership Plans, Transactions, Waivers, Franchises & detail, Notifications, and platform-admin's Admin Users/School lookup/Franchise lookup).

### Approach

Five parallel research passes (one per page group) compared each page's current real code against its already-approved mockup artifact, rather than re-deriving design decisions already made during the earlier mockup-review phase. Finding: **most pages already matched their mockups exactly** — the content/field decisions made during that phase were already real. Only four concrete gaps existed:

### 1. Instructors list — missing Id/avatar/Name columns, traced to a real backend gap

`InstructorResponseDto` had no name field at all — verified, not guessed: `Class.instructorId`/`TimetableSlot.instructorId` are direct FKs into `User` (schema.prisma's own comment: "NOT a separate Instructor table"), and `ClassFormModal`'s/`TimetableSlotFormModal`'s instructor pickers were falling back to `beltRanking` text or a truncated id because there was nothing else to show. Fixed the same way Decision 117 fixed the identical class of gap for Bookings/Waitlist/RoleGrant/Transactions: `InstructorsService.findAllForSchool` now resolves `firstName`/`surname` via `resolveUserNames`/`PrismaAuthService`, added to `InstructorResponseDto`. This single backend fix unlocked three frontend fixes at once (all three already reuse the same `useInstructors` hook):
- `InstructorsPage.tsx` — reordered to the Figma-confirmed column order (Id · avatar · Name · Ranking · Specializations · Experience · Phone · Branch · Actions), added a generic silhouette avatar placeholder (`photoUrl` is real/nullable but no upload UI exists anywhere yet, so an icon-for-no-photo is honest, not a fabricated photo).
- `ClassFormModal.tsx`/`TimetableSlotFormModal.tsx` — instructor-picker dropdown now labeled by real name instead of belt/ranking text or a truncated id.
- `ClassesPage.tsx` — added an Instructor column (matched on `instructor.userId === class.instructorId`, the same FK target), showing the resolved name.

Regression test added to `apps/api/test/instructors.e2e-spec.ts`: creates a dedicated Instructor profile, confirms the roster list resolves its name, then revokes its RoleGrant and confirms the name **still** resolves — proving this uses the RLS-immune `PrismaAuthService` path, not a plain `include` that Decision 117 already found breaks under exactly that condition.

### 2. Disciplines — Ranks table showed colour as plain text, not a swatch

`RankResponseDto.primaryColour`/`secondaryColour` are real structured fields (unlike Instructors' plain-text `beltRanking`), so a visual swatch reflects real data. `DisciplineDetailPage.tsx`'s Colour column now renders a colored dot + the text value. Note: the field is free text (`RankFormModal`'s own input is a plain `TextField`, not a color picker), not guaranteed to be a valid CSS color — handled safely by construction, since an invalid CSS `background` value is silently ignored by the browser rather than erroring.

### 3. platform-admin School/Franchise lookup — hardcoded pixel spacing, not design tokens

`SchoolLookupPage.tsx`/`FranchiseLookupPage.tsx` used inline `style={{gap: '4px 16px'}}`-style hardcoded values instead of this app's own spacing/typography tokens (both pages already inherit `@ultm8/ui`'s tokens/components automatically — confirmed, not assumed, via `main.tsx`'s `import '@ultm8/ui'` and a zero-result glob for any local CSS in this app). Added two small shared classes, `.ultm8-subcard-title`/`.ultm8-info-grid`, to `packages/ui/src/components.css`, applied to both pages' entity-detail cards. Not live-verified in the browser — this sandbox has no AWS Cognito configuration, and platform-admin's real login flow requires it — verified via `tsc --noEmit` and code review only; flagged explicitly rather than silently claimed as visually confirmed.

### 4. Everything else — confirmed already matching, nothing changed

Timetable, Class Detail (Bookings/Waitlist names — already fixed by Decision 117), Branches, Membership Plans, Transactions (its remaining "unimplemented" items were mockup items meant to be *excluded*, already correctly absent from real code), Waivers, Franchises & detail, Notifications, and platform-admin's Admin Users page all already matched their mockups exactly — re-confirmed by direct comparison, not assumed unchanged.

### What this does NOT resolve (explicitly flagged, not decided here)

- **Transactions' Failed/Disputed badge colors** are inverted between the mockup (Failed=red/danger, Disputed=blue/accent) and real code (`paymentStatusBadge.tsx`: Disputed=red/danger, Failed=blue/accent). Cosmetic only, not a data/structure gap, and no record anywhere of which was an intentional choice — left as-is rather than silently "fixed" against a reference that was never confirmed authoritative on this specific point.
- **Franchises' `mobileNumber` column** stays unrendered on the list (already wired into `FranchiseFormModal`, just not shown as a column) — the mockup itself flags this as a proposed addition, not a decided one, same category as Instructors' `photoUrl`. Not added.
- **StaffPage's card-section headings** use an inline-style hack (`className="ultm8-page-header__title" style={{fontSize: 18}}`) instead of a dedicated class — flagged by the audit, but NOT changed: the identical pattern is the established convention in `ClassDetailPage.tsx`/`TimetablePage.tsx`/`DisciplineDetailPage.tsx` too, so fixing it only on Staff would make that one page inconsistent with the other three rather than more consistent. A real fix here would mean introducing `.ultm8-subcard-title`-style tokens app-wide across all four pages at once — a separate, bigger decision, not bundled into this pass.
- **Instructor rank/grading-system link** (V1 manual dropdown vs. V2 grading-system link) — Decision 108's own scope, unaffected by this pass.

### Verification

`tsc --noEmit` clean across `apps/api`, `packages/ui`, `packages/api-client`, `apps/school-portal`, `apps/platform-admin`. `export:openapi` → `generate` diffed to confirm only the two new `InstructorResponseDto` fields changed. Live-verified against the running app (real Postgres/Redis/`apps/api`/`apps/school-portal`, Playwright against `localhost:5173`): Instructors list shows a real resolved name, Classes list shows a real resolved Instructor, Ranks table renders a real colour swatch. platform-admin's two changed pages verified by type-check and code review only (Cognito unavailable in this sandbox, noted above).

**`apps/api/test/instructors.e2e-spec.ts` was actually run against a real Postgres in this sandbox, not just compiled** — unlike most other decisions in this file, which could only claim `tsc --noEmit` and flag e2e execution as needing CI (no reachable database in earlier sessions). All 16 cases passed, including the new regression test, confirming the name-resolution fix holds against real RLS, not just against the type system. One environmental note worth recording: the first run attempt hung for ~43 minutes with the process pinned near-idle (only ~42s of real CPU time) because this sandbox's Postgres was killed by a container reset mid-run, and the Prisma client hung indefinitely retrying a dead connection instead of failing fast — not a code or test bug. Confirmed via `pg_isready`/`psql` returning "connection refused" mid-hang, killed the stuck process, restarted Postgres (data persisted — the same ephemerality/persistence pattern already documented elsewhere this session), and reran clean in 11.4s.

### Recorded by

Logged after the user asked to "update the rest of the pages too" following the auth-flow pass (Decision 119); five parallel research agents audited the remaining pages against their approved mockups, findings synthesized and implemented directly, 22 Sep 2026.

---

## Decision 121 — Social/OAuth login is a confirmed V2 scope item, not excluded permanently

**Date:** 22 Sep 2026
**Status:** Approved by product owner — a scoping/roadmap decision, not a technical one
**Resolves:** why Login's real code (and every other auth screen) has no Google/Facebook/Apple/Microsoft/Discord sign-in buttons even though the Figma reference shows them — flagged and excluded during the mockup-review pass and again when implementing Decision 119, on the grounds that no OAuth/social provider is confirmed anywhere in the spec (Decision 72: passcode is the *sole* login credential) and building it would mean inventing a whole auth capability, not a style choice.

### Decision

Social/OAuth login (sign in via Google, Facebook, Apple, Microsoft, Discord, or similar) is confirmed as **planned for ULTM8 V2** — a real, intended feature, not a permanently rejected one. It is explicitly **out of scope for the current build**. Nothing about V1's passcode-only login model (Decision 72) changes as a result of this — V1 ships and stays email/phone + 6-digit passcode only, per Decision 72, with no OAuth path.

### Effect

- No code change from this decision alone — it confirms the *reasoning* already applied when the social-login buttons were excluded from `LoginPage.tsx`/`RegisterPage.tsx` (Decision 119) was correct, and converts "not confirmed, so excluded" into "confirmed as deferred, so excluded — with a known target version."
- When V2 auth work actually starts, this needs its own real design/engineering pass, not a Figma-icon copy: which provider(s) specifically, how a socially-authenticated account reconciles with the existing email/phone + passcode identity model (a returning user signing in via Google needs to map to the same `User` row as their existing email-based account, not create a duplicate), and how/whether `AuthContext.tsx`'s current `login(email, passcode)`-only shape extends to support it. None of that is decided here — this decision only confirms the feature is planned and gives it a target version, not a design.

### Recorded by

Stated directly by the user in response to being asked why social-login icons don't appear on the real Login page, 22 Sep 2026.

---

## Decision 122 — Membership force-Expiry now cancels its own future Bookings, closing a real gap in an already-confirmed rule

**Date:** 30 Sep 2026
**Status:** Developer-level fix, not a new product decision — this closes a gap in a rule Spec 55 §6.1 already confirmed; see "Decision" below for the one genuinely inferred piece of scope.
**Resolves:** a gap found while explaining the payments/membership/booking flow to the user — `handleSubscriptionDeleted()`'s own header comment admitted: "The 'same-day sweep cancels the Student's own future Bookings' half of this rule is NOT built here — Booking doesn't exist in this codebase yet (Phase 11)." That comment was accurate when Phase 8 wrote it; it was never revisited once Phase 11 actually built Booking, so a Membership force-Expiry (a Subscription's final cancellation, or a lost Membership-purchase dispute, Decision 55) has been silently leaving the Student's already-made future Bookings in place ever since — the exact quoted Spec 55 §6.1 sentence this decision now finally honors.

### Decision

Both places `StripeWebhookProcessingProcessor` flips a `Membership` from `ACTIVE` to `EXPIRED` — `handleSubscriptionDeleted()` and `applyDisputeToTransaction()` (a lost dispute) — now also cancel every `UPCOMING` `Booking` that Membership was funding (`Booking.sourceMembershipId`), in the same database transaction as the Membership-expiry write itself. Each cancelled Booking's `refundResolution` is set to `WITHHELD`, and a `waitlist-cascade-processing` `'seat-freed'` job is enqueued (post-commit, same deferred-side-effect convention this file already uses for Stripe/BullMQ calls) so the next Waiting entry on that Class gets notified, exactly as a normal cancellation already does.

**Scope, inferred (flagged for Architect review, not itself a new SKILL.md-confirmed rule):** only the Student's own seat is cancelled. A `BookingAttendee` guest seat this Membership was funding for a *different* Student is left untouched — whether losing your own Membership should also bump a guest you invited off someone else's Booking is a materially different, undecided question this fix doesn't attempt to answer.

**`refundResolution: WITHHELD`, never `REFUNDED`:** this is a forced cancellation because the funding Membership itself is gone (a failed renewal or a lost dispute), not the Student's own voluntary cancellation under the Class's own refund policy — there is no credit to hand back to a Membership being retired for good. `restoreCredit()` is deliberately not called for the same reason (and would be a no-op for a general-access/Subscription Membership regardless, per that method's own comment).

### What this does NOT resolve

- Membership `EXPIRED` via `expiryDate` passing (a Class Pack/Trial simply running past its own expiry date) has no scheduled sweep anywhere in this codebase at all — a separate, larger gap this fix does not touch. This fix only covers the two sites that already exist and already force-Expire a Membership; it doesn't add a new expiry mechanism.
- The `BookingAttendee` guest-seat question noted above.

### Verification

`tsc --noEmit` clean across `apps/api`. `nest build` clean. Actually run (not just compiled) against a real local Postgres 16 + Redis 7 in this sandbox — both the two new test cases and the full existing suite: `stripe-webhook-processing.e2e-spec.ts` (15/15 passed) and `bookings.e2e-spec.ts` (36/36 passed), plus the full `test:e2e` run across the whole repo (354 passed, 22 pre-existing skips for unrelated unconfigured integrations, 0 failures) — the cross-tenant-isolation gate CI depends on was exercised for real, not assumed.

### Recorded by

Found and fixed at the user's own request ("fix the future-bookings sweep gap") after they asked how Membership payment failure affects booking access and this gap was traced from the code, 30 Sep 2026.

---

## Decision 123 — Guardian "Kid Mode" booking delegation: a minor may self-book against an existing paid credit, inside the Guardian's own session, never via a separate minor login

**Date:** 6 Oct 2026
**Status:** Product-owner decision, made directly with the user through a dedicated design/stress-test pass — not a Developer-level inference like 107/109/114/115
**Resolves:** a genuinely new, previously-unaddressed question — not a `[CONFIRMED]`/`[UNRESOLVED]` item in SKILL.md §14 at all, since the age-13 limited-login mechanism SKILL.md does name is itself unbuilt (`GuardiansService.createMinor()`'s own comment: a minor's `phoneVerifiedAt` is permanently null, and `AuthService.login()` hard-rejects any account where that's null — there is no path for a minor to log in today, full stop). The user asked whether a Guardian could grant a linked minor the ability to book a class themselves; this closes that as a standalone mechanism, explicitly not a widening of the age-13 login.

### Decision

**No new minor login.** "Kid Mode" is a PIN-gated screen inside the *Guardian's own already-authenticated* `apps/student` session — never a separate account, credential, or JWT for the minor. The PIN's role is confirming a device handoff is happening (a UX gate), not authenticating the minor as a distinct identity.

**The real security boundary is a scoped token, not the PIN.** Entering Kid Mode (PIN confirmed) calls a new endpoint — using the Guardian's own full session — that mints a second, short-lived JWT whose only capability is `POST /classes/:id/book`, and only for `studentId`s on that Guardian's own per-minor allow-list (read live from the database at mint time, never cached). Every other endpoint rejects this token outright; hiding buttons client-side is explicitly not treated as sufficient. The app swaps to this token while Kid Mode is on-screen and back to the Guardian's normal token the moment it's exited.

**Zero new booking logic.** This reuses the already-built, already-verified Guardian-on-behalf-of booking path (`BookClassDto.studentId`, Phase 40) exactly as-is — the waiver gate, rank gate, capacity lock, and Membership-credit consumption are all unchanged.

**New model**, shaped directly on the existing `ConsentRecord` precedent: `BookingDelegation { guardianId, studentId, status: ACTIVE | WITHDRAWN }` — **per-minor** (explicit user choice over a single account-wide toggle): a Guardian with two linked minors can enable this for one and not the other, and revoking one never touches the other.

**Scope — confirmed, all explicit, none inferred:**
- Book a class, consuming an existing Membership/class-pack credit — in scope.
- Purchasing a new Membership/class-pack, cancelling a booking, joining a waitlist, signing a waiver, or touching payment/account settings — all explicitly out of scope. A `LIMITED_MINOR`-scoped token must be rejected by every endpoint except booking-create; this is a hard allow-list, not a default-permit list with exceptions carved out.

**Revocation behavior:** turning off a minor's delegation does not auto-keep or auto-cancel their existing Kid-Mode bookings. They move into a new "needs Guardian review" state (a new marker on the Booking itself), surfaced in the Guardian's app with a Confirm/Cancel action per booking.

**Guardian visibility:** every Kid-Mode booking is visible to the Guardian exactly the same way every other linked-minor booking already is — no silently-made bookings.

**Check-in unaffected, no new gap:** a Kid-Mode-booked minor checks in exactly the way any Guardian-booked minor already does today — Decision 107's `INSTRUCTOR_MANUAL` path ("Staff confirms by name alone, zero camera involvement, for a Student whose device is dead/absent/a young minor with none") already covers this; verified against that decision's actual text before concluding there was no gap, not assumed.

### Why

Kid Mode over a real minor login: building a genuine credential-based login for a minor with no phone to OTP-verify is a large, separate, ground-up feature (new auth codepath, new rate-limiting/lockout surface, a new claim shape every downstream endpoint would need to explicitly trust) that the user's own "kid mode" framing sidesteps entirely by reusing the Guardian's existing, already-trusted session. A PIN screen alone was explicitly rejected as sufficient on its own — a PIN gates the UI, but the underlying JWT is unchanged by it, so without a genuinely scoped token the restriction would be cosmetic, not enforced; a technically curious minor (or a UI bug) could still reach the Guardian's full capabilities through the same token. The scoped-token design was chosen specifically so "book only" is a server-side guarantee regardless of what the client UI shows. Per-minor over one account-wide toggle: explicitly chosen by the user over the simpler global-switch alternative, for the realistic case of linked minors at different ages/trust levels (e.g. a 14-year-old vs. a 6-year-old) needing different answers.

### What this does NOT resolve

- No code has shipped by this decision — this closes the design/approval step only; the model, the token-minting endpoint, the allow-list guard, the booking-review-queue marker, and the Guardian-facing UI (per-minor toggle, PIN entry, Kid-Mode booking screen, review-queue screen) are all genuine follow-up build work.
- The exact PIN length/storage mechanism (purely local/device-side vs. a lightweight server-side check) was not specified as a hard requirement — the PIN is explicitly not the security boundary (the scoped token is), so this is an implementation detail to settle during the build, not a reopened product question.
- Whether a Kid-Mode token's TTL should be a fixed sitewide constant or configurable is not decided — "short, on the order of minutes" is the only constraint set here.
- The age-13 limited-login mechanism itself remains entirely unbuilt and untouched by this decision — Kid Mode is explicitly a standalone mechanism, not a dependency on or a widening of that (still-unbuilt) feature.

### Recorded by

Proposed by the user ("what if parent grant them access to book a class for themselves... find the best solution"), designed and adversarially stress-tested by Claude across two passes (an initial design + 10-row stress-test table, then a kid-mode-specific second pass once the user's own "no separate login" framing simplified the credential problem), with the user resolving each of 7 explicit open questions directly (no separate login; booking-only scope, no purchase; per-minor granularity over a global toggle; standalone from the age-13 login; revoked bookings go to a Guardian review queue, not auto-kept/auto-cancelled; Guardian keeps full visibility) before approving the consolidated design, 6 Oct 2026.

---

## Decision 124 — Grading: Gus's prototype rules take precedence over Spec 55 where they conflict, one logged decision per conflict

**Date:** 9 Oct 2026
**Status:** Product-owner decision, given directly by Gus (author of the grading prototype and owner of the grading rules) in this session
**Resolves:** Q1 of `docs/grading-integration/GRADING-MERGE-QUESTIONS.md`: "Do your grading rules override Spec 55 where they conflict?" Context: Gus's handover package (`dojohq-grading-handover.zip`, 7 Oct 2026) encodes grading rules that differ in places from Spec 55 §2.3/§6.1/§7 and from the RanksModule already built. The full comparison is in `docs/grading-integration/GRADING-INTEGRATION-ROADMAP.md` §3.

### Decision

For the **grading module only** (ladders, ranks and stripe rungs, requirements, eligibility, progress, grading actions, history, Grading Board, grading events, and the skill/lesson link), the rules in Gus's prototype (`HANDOVER.md` §6, `prototype/index.html` lines 316–541, and the decisions recorded in `CHANGES.md`) take precedence over Spec 55 where the two conflict.

Answer given: *"yes, however always feel free to ask questions to verify."*

**Conditions, part of the decision:**

1. **One decision per conflict.** This entry does not settle any individual conflict by itself. Each place where Gus's rule replaces a Spec 55 rule is confirmed with Gus and logged as its own numbered decision (125 onward), citing the Spec 55 section it replaces. Nothing is built against an override until that entry exists.
2. **Ask to verify.** Where Gus's prototype is silent, ambiguous, or only mocked (HANDOVER §8: notifications, fee, permissions, video), it is not treated as a rule. The question is put to Gus instead.
3. **Scope is grading only.** Tenancy and Row-Level Security, the Platform Admin realm, payments, roles outside grading, and every other module stay under Spec 55 and the existing decisions. A grading rule that would touch one of those (for example a grading fee through Stripe, or who may grade) also needs the product owner's sign-off for that area.
4. **Spec amendment list.** Every override is added to a list for a future Spec 55 amendment, the same way Decisions 70–76 were summarised into §15.

### Why

Gus built and stress-tested the grading rules: 105,303 checks and a 45-step click-through, both re-run and reproduced on 8 Oct 2026. Spec 55 §2.3 itself says the prototype "validates the grading/ranks data model and interaction flow … which the production RanksModule and Grading Board should implement as-is." Making his rules the reference avoids re-deriving them. Requiring one logged decision per conflict keeps the audit trail this log exists for, so a later developer reading Spec 55 alone is not misled.

### Effect on existing documents

- **`CLAUDE.md` source-of-truth hierarchy (item 3)** states that approved decisions "never override Spec 55 Sections 1–11". This decision is an explicit, product-owner-approved exception for grading. `CLAUDE.md` itself was **not** edited by this entry. Whether to add a one-line carve-out there is put to the product owner separately.
- **`skills/ultm8-domain-rules/SKILL.md` §5** should be updated by the Architect as individual grading overrides (125+) are logged. It was not edited here.

### What this does NOT resolve

Every individual conflict listed in `GRADING-MERGE-QUESTIONS.md` remains open until answered, including: rung storage, which rung requirements belong to, skipping rungs, back-dating, starting classes, the skills hard-block switch, downgrade reasons, voiding vs deleting history, and who may grade.

### Recorded by

Asked as Q1 of the grading merge question list (published 8 Oct 2026) and answered directly by Gus on 9 Oct 2026. Recorded by Claude.

---

## Decision 125 — Grading decisions are approved by Gus as ULTM8 product owner

**Date:** 9 Oct 2026
**Status:** Product-owner decision, given directly by Gus in this session
**Resolves:** Q2 of `docs/grading-integration/GRADING-MERGE-QUESTIONS.md`: "Who approves grading decisions from now on: you alone, or you plus the ULTM8 product owner?"

### Decision

Gus is the ULTM8 product owner, and he approves all grading decisions. That includes those that touch payments, roles or tenancy, such as a grading fee or who may grade.

Answer given: *"I am the product owner, so I decide."*

### Effect

- **Decision 124, condition 3** ("also needs the product owner's sign-off for that area") is satisfied by Gus's own sign-off. No second approver is needed.
- Every override is still logged as its own decision (Decision 124, condition 1). Tenancy isolation, Row-Level Security and the Platform Admin realm still follow Spec 55 unless Gus explicitly decides otherwise for a named case.

### Recorded by

Asked as Q2 of the grading merge question list and answered directly by Gus on 9 Oct 2026. Recorded by Claude.

---

## Decision 126 — Rung storage: keep Rank + RankStripeTier, but every rung carries everything a prototype rung carries

**Date:** 9 Oct 2026
**Status:** Product-owner decision, given directly by Gus in this session
**Resolves:** Q3 of `docs/grading-integration/GRADING-MERGE-QUESTIONS.md`: "How are the rungs stored: belt + stripe tiers (ULTM8 today) or one row per rung (your prototype)?"

### Decision

**Option A.** Keep ULTM8's existing storage: a `Rank` (belt) with ordered `RankStripeTier` rows, and `StudentRank.currentRankId` + `currentStripeId`. Every (belt, stripe tier) pair is one rung of the ladder. Schools, coaches and students see and grade a single flat ladder exactly like the prototype. Each stripe is its own step with its own requirements, its own grade action and its own history entry, as Gus confirmed on 8 Oct ("each stripe is a step on the ladder, and a new grade").

Answer given: *"A … MY prototype, but looks like your recommendation cover my prototype."*

**Condition attached by Gus:** option A must cover the prototype's behaviour in full. Concretely, any setting a prototype rung has must be settable on each rung (stripe tier), not only on the belt:

| Prototype rung field | ULTM8 today | Needed under this decision |
|---|---|---|
| classCount | `RankStripeTier.classesRequired` | already per rung |
| minDays | `RankStripeTier.minimumDaysInRank` | already per rung |
| scope (which classes count) | `RankStripeTier.eligibleClassTypes` | already per rung |
| stripe count and colour | `RankStripeTier.count` / `colour` | per rung; mixed colours on one rung are Q6 |
| skills (required skills) | `RankRequiredSkill` on the **belt** | **per rung**. Spec 55 §6.1 already says skills are required "at the CURRENT checkpoint — stripe or rank" |
| weeklyCap | `Rank.weeklyClassCountCap` on the belt | per rung (Q8) |
| timeOnly ("time in rank only") | `Rank.yearsInRankFlag` on the belt | per rung; scope is Q7 |
| name | none | per rung (Q5) |
| colour, secondaryColour | on the belt | stays on the belt |
| tagColor, coralAccent (drawing only) | none | to be added for belt drawing |

### Why

Booking eligibility (`BookingsService.assertRankEligible`), waitlist, QR attendance credit and the student app's "My Rank" already read Rank + stripe tier. Option B would rewrite that working code to get the same on-screen ladder.

### Effect / open follow-up

- The schema changes in the table above belong to Phase 1 of `GRADING-INTEGRATION-ROADMAP.md`. The rows marked Q5, Q6, Q7 and Q8 still wait for their own answers. Moving required skills to the rung follows directly from this decision, because the prototype requires it.
- A translation layer (the shared grading engine, roadmap Phase 2) flattens belt + tiers into the prototype's ladder, so Gus's rules and stress-test scenarios run unchanged against ULTM8 data.

### Recorded by

Asked as Q3 and answered directly by Gus on 9 Oct 2026. The per-rung field check was done by Claude against `apps/api/prisma/schema.prisma` and the prototype's `makeRank()`.

---

## Decision 127 — Requirement direction: Gus's rule, a rung's requirements are what it takes to be promoted INTO it

**Date:** 9 Oct 2026
**Status:** Product-owner decision, given directly by Gus in this session. Overrides the existing RanksModule behaviour, as a grading override under Decision 124.
**Resolves:** Q4 of `docs/grading-integration/GRADING-MERGE-QUESTIONS.md`: "Which rung do requirements belong to?"

### Decision

Gus's `gradingRequirement` rule (`prototype/index.html`, HANDOVER §6.3) is adopted exactly:

| Student is at… | …next rung is… | Requirements come from |
|---|---|---|
| a normal rung | a normal rung | the **next** rung: its classes, minimum days and skills mean "what it takes to be promoted into it" |
| a normal rung | a time-only rung (e.g. Brown · 4 → Black) | the **current** rung, because a time-only rung has no class or skill numbers |
| a time-only rung | anything | the **current** rung's minimum days (the time spent at it); the next rung's skills are shown but optional |

Answer given: *"yes"*.

### Effect

- `GradingService.assertSkillsSignedOffOrAcknowledged` currently checks the **current** rank's skills, and `cycleSkillSignOff` only allows skills of the current rank (`apps/api/src/ranks/grading.service.ts`). Both must change to use the rule above. The grading engine (roadmap Phase 2) owns this rule, and the API, portal and app all call it.
- This is the rule the prototype's stress test (`refReq`, `refEligible`, `refPct`) was written against, so those scenarios can serve as ULTM8's acceptance tests without translation.
- Spec 55 §6.1's wording ("skills required at the CURRENT checkpoint") is superseded for grading, and goes on the spec-amendment list.

### Recorded by

Asked as Q4 and answered directly by Gus on 9 Oct 2026. Recorded by Claude.

---

## Decision 128 — Prototype grading rules adopted as written (batch)

**Date:** 9 Oct 2026
**Status:** Product-owner decision (Gus). A grading override under Decision 124 wherever it differs from Spec 55 or the existing RanksModule.
**Resolves:** Q5–Q8, Q15, Q18, Q21–Q25 (in part), Q27, Q35, Q36, Q39 and Q42 of `docs/grading-integration/GRADING-MERGE-QUESTIONS.md`. Gus agreed to adopt every rule his prototype already implements, recorded as one list.

### Decision

Each rule below is built exactly as `prototype/index.html` implements it (references are to HANDOVER.md §6 and CHANGES.md):

1. **Rung names** are typed per rung by the school (Q5).
2. **Mixed stripe colours on one rung** are supported (for example 3 yellow + 1 red), as in the kids red and yellow templates (Q6).
3. **"Time in rank only"** is a switch on any rung in any style. The years are stored per rung as minimum days. Classes are not counted and skills are optional (Q7). This supersedes Spec 55's "Black Belt and above" limit for grading.
4. **Weekly class cap is per rung** (Q8).
5. **Board column names:** Just Starting / Getting There / Ready to Grade (Q15). The thresholds are settled separately.
6. **"Log a class"** stays as a staff action next to QR attendance (Q18).
7. **Grade can skip rungs.** The skipped rungs are recorded on the history ("Skipped N ranks in between") (Q21).
8. **Back-dated grading date:** never in the future, and never before the date the student reached their current rank (Q22, already decided by Gus on 7 Oct).
9. **"Starting classes"** can be entered when grading (Q23). This supersedes Spec 55's reset-to-zero for grading.
10. **Per-style "skills required" switch:** off means warn and require an acknowledgement; on means grading is blocked with no override (Q24). This supersedes Spec 55's "warns, never blocks" for grading.
11. **Downgrade requires a written reason.** History entries carry a system note and a user note (Q25).
12. **Grade only moves up, Downgrade only moves down** (Q27). This closes the item that was waiting for Gus's confirmation in HANDOVER §9.
13. **Board drag** rewrites the class count (or the rank date for a time-only rung) and writes an ADJUSTMENT entry to the history (already decided 7 Oct).
14. **Grading events:** a Pass promotes one rung; a Fail keeps progress with no special window; an event is read-only once completed (Q35, Q36).
15. **Lesson categories** are a real list with ordering, and lessons are ordered within a category (Q39).
16. **Skill sign-offs are wiped** on every rank change (Q42).

Answer given: *"i agree"*.

### Effect

Schema and API changes are needed for: rung name, colour segments, per-rung time-only, weekly cap and skills (see Decision 126); effective date, reason and notes on history; skip-rung target; starting classes; the per-discipline skills-required switch; the ADJUSTMENT event type; and a LessonCategory table with ordering. Each goes on the Spec 55 amendment list.

---

## Decision 129 — Grading history entries are voided with a reason, never deleted

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q26

The prototype's "delete history entry" becomes **void with a reason**. The entry is hidden from the normal history view but kept in the database with who voided it, when and why. Voiding never changes the student's current rank, which matches the prototype. Answer given: *"Go ahead"*.

---

## Decision 130 — Bulk promote and events ask for the skills acknowledgement per student, in one fast step

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q28 (HANDOVER §9 open item 5)

Bulk promote and event completion apply the same checks as a single grade (missing required skills, minimum days not yet served), judged per student. Gus's condition: *"yes, but try to make a list or an easy flow. The idea to bulk promote is the speed of action."*

Flow, designed to keep bulk promote quick:

- Students with nothing missing need no extra step.
- The confirm window shows a short "Needs a look" list at the top with only the flagged students, each with the reason: "2 skills not signed off" or "12 days short".
- One tick, "I acknowledge these N students", covers the whole list. Any student can be removed from the batch with one click instead.
- Students blocked by the per-style "skills required" switch are listed as "can't be promoted" and are skipped automatically, as the prototype already does.
- Each student's history records that their promotion was acknowledged.

Requests are capped at 200 students each, per Spec 55.

---

## Decision 131 — Templates: ship the three IBJJF ladders only

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q9

The IBJJF Adult & Kids ladder (White Stripes, 90 rungs), the White & Red Stripes variant (139) and the Yellow Stripes variant (175) ship as templates. Karate, Taekwondo, Judo, Muay Thai, Kids BJJ and MMA are not shipped until Gus confirms real numbers. Schools can still build any style from scratch. Answer given: *"correct"*.

---

## Decision 132 — Guardians can see their linked children's rank and progress

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q44

A Guardian can read, but not change, each linked minor's ranks, progress, skills for the next grade and rank history. Today `GradingService.assertCallerCanReadStudent` refuses Guardians. It must also admit a caller holding an active GuardianLink to that student. Answer given: *"yes they can"*.

---

## Decision 133 — Membership status has no direct grading rule

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q20 (in part)

There is no separate grading rule for memberships. A student without an active membership cannot book classes, so they earn no attendance toward their next grade; that is how membership affects grading. Answer given: *"if membership is not active, they can[not] book into the classes, so it affects grading"*. The word "can" in the original reply is read as "cannot" from the second half of the sentence. This reading was put back to Gus for confirmation.

---

## Decision 134 — Grading history follows the account-deletion rule

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q46 (in part)

Grading data is kept or removed together with the rest of the account. Spec 55 Decision 44 already specifies that `account-deletion-processing` hard-deletes a deleted account's StudentRank rows (and with them its history and skill sign-offs). That stays as is. Answer given: *"if we keep the records on our system we will keep grading record, if not it will be gone"*. Still open: what other students' history shows when an **instructor's** account is deleted (put back to Gus).

---

## Decision 135 — Grading ships in v1.1

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q49 (in part)

Grading (Track A: API and school portal) is part of the planned **v1.1** release. Version numbers are assigned by the product owner (CLAUDE.md, Versioning). This records his assignment; nothing is tagged until he says so. The Track B (student app) release was put back to Gus. Answer given: *"V1.1"*.

---

## Decision 136 — Confirmation of Decision 133, and board thresholds: 33% / 66% by default, editable per school

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q14; confirms the reading recorded in Decision 133

- **Decision 133 confirmed.** A student without an active membership **cannot** book classes, so they earn no attendance. Gus: *"Yes correct"*.
- **Board thresholds.** The Grading Board splits students into three columns at 33% and 66% progress (classes attended ÷ classes required; days ÷ required days for a time-only rung). These are the default for every school, and each school can edit them. Gus: *"Yes by default but they should be able to edit, in case they wish to change"*. This is consistent with Decision 75 (school-configurable, per discipline) and gives it its default. The progress formula itself stays the prototype's (`computeProgress`). Skills and minimum days are not part of the percentage.

---

## Decision 137 — Self-declared ranks at signup, verified by grading staff

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q32, Q33 (in part)

1. **At signup**, a student (or a guardian for a minor) enters their current rank in each discipline they train at that school. It is stored as **unverified**.
2. **Anyone with grading permission** for that discipline (Decision 138) can verify it in the school portal.
3. **An unverified rank still allows booking** rank-restricted classes. Gus: *"yes they can book"*. This is an explicit exception to the booking rank gate for unverified ranks.
4. **When anyone with grading permission logs in to the school portal**, a notice lists the students whose ranks are waiting to be verified.
5. **White belts and beginners are verified automatically.** Gus: *"White belts and beginners should be auto verified by the school"*.

Still open, put back to Gus: whether the verifier can correct a wrong rank, and exactly which rungs count as "white belt / beginner" for automatic verification.

---

## Decision 138 — Grading permission: owner always, others per discipline as granted

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q29, Q30

The school owner always has grading permission. Anyone else (instructor or branch staff) has it only for the disciplines the owner grants, as in the prototype's Settings → "Instructor grading permissions" table. The permission covers: grade, downgrade, board adjustments, bulk promote, events, skill sign-off and verifying self-declared ranks. Downgrade and adjustments need no higher permission than promoting, per the prototype ("the right to promote or downgrade, per style"). Gus: *"Yes"*, and earlier *"Who ever is grant permission to the grading area"*.

This replaces today's `assertStaffAtSchool` check, which admits all staff to every grading action; the code itself flags that check as [UNRESOLVED].

---

## Decision 139 — Branches: one home branch per student; branch staff grade their own branch; one ladder per school

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q17 (in part)

1. Each student has **one home branch**, chosen when they join.
2. Grading staff see and grade **only their own branch's students**. The owner sees and grades all branches.
3. The school keeps **one ladder per style**, shared by all its branches.

Gus: *"Each branch are responsible for their grading"*, then "yes" to each of the three points. Today `POST /schools/:id/join` creates a school-wide STUDENT RoleGrant with no branch, so join needs a branch choice.

Still open, put back to Gus: whether a class attended at a different branch counts toward grading, and how existing students without a home branch get one.

---

## Decision 140 — "Which classes count": any ticked type by default, "each ticked type required" as an option

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q16 (in part)

Each rung lists which class types count toward it, and a weekly cap (prototype). By default, a class of **any** ticked type counts toward the rung's class total (Gus: *"correct"*). Gus also said the alternative, where the student must attend **each** ticked type, *"also can be the case"*, so it is offered as a per-rung option. A class counts toward a discipline only if its type is ticked on the student's next rung. That also settles whether one class counts toward several disciplines.

Still open, put back to Gus: in "each type required" mode, whether the school sets a number per type or "at least one of each" is enough. This depends on classes having a type (Q12).

---

## Decision 141 — A deleted instructor shows as "Former instructor" on students' grading history

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q46 (remainder)

When an instructor's account is deleted, the grading history of the students they graded is kept intact. The "graded by" name on those entries shows **"Former instructor"**. Today `PromotionEvent.performedById` is `ON DELETE RESTRICT` to User, which would block deleting the instructor's account. It must become nullable with a stored display label (or `SET NULL` plus the label), as part of the account-deletion work (Spec 55 Decision 44). Gus: *"yes"*.

---

## Decision 142 — The student app gets read-only grading in its next release

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q49 (Track B), Q43 (in part)

Track B (`apps/student`) shows each student, and each guardian for their linked minors (Decision 132), their rank per discipline by name, their progress toward the next grade, and the skills needed for it. All of it is read-only. It ships in the app's next release; the version number is the product owner's to assign. Gus: *"yes"*. Whether the app also shows lessons and rank history is left to a later question.

---

## Decision 143 — Classes carry a class type chosen from the discipline's list

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q12

When a school creates a class or timetable slot, it picks the class's **type** (for example Kids Fundamentals or Adult Sparring) from that discipline's class-type list (`Discipline.classTypesOffered`). Attendance credit (Decision 140), the weekly cap and the booking rank gate use this type. Today they rely on the discipline name in `Class.activities` (Decision 90's bridge). Gus: *"yes"*.

---

## Decision 144 — Grading fees are charged by the school to its students, optionally

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q37 (in part)

The prototype's "Charge a grading fee" switch is a **school's** choice to charge **its own students** for a grading. It is not a ULTM8 platform charge. Gus: *"Not ULTM8, these charge [are] for the school to charge the students if they choose to charge per grade."* The money goes to the school's own payment account (Stripe Connect, Decision 86), like membership sales. `Transaction` currently requires a `membershipPlanId`, so a grading-fee charge needs its own transaction kind.

Still open, put back to Gus: which release it ships in, the payment methods (card, cash, bank), and whether the fee is set per event, per rung or per discipline.

---

## Decision 145 — Grading notifications in v1.1: "ready to grade" and "you've been promoted"

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q38

For v1.1, two grading notifications are real:

1. **"Ready to grade"**: sent in-app to the owner and to staff with grading permission for that discipline (and branch, per Decision 139), when a student becomes eligible.
2. **"You've been promoted"**: sent to the student, or to the guardian for a minor.

Gus: *"yes for now"*. More can be added later. Push delivery depends on the deferred push dispatch (Decision 95). Until then, delivery uses the channels that already work (in-app and email).

---

## Decision 146 — Rank, skill and discipline names are typed once by the school

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q48

Names a school types (disciplines, rung names, skills, lesson titles) are stored once, in the school's own words, and not translated. Only the app's and portal's own buttons and labels are translated into the four supported languages. Gus: *"yes"*. The portal and the app have no translation support yet; that is separate i18n work.

---

## Decision 147 — Self-declared ranks: the verifier can correct them; only plain White Belt is verified automatically

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** the open points of Decision 137 (Q32, Q33)

1. **Correction.** While verifying, anyone with grading permission can change a self-declared rank to the correct rung. The correction is noted on the student's history (who changed it, from what, to what, when). Gus: *"yes"*.
2. **Automatic verification applies to the first rung only**, White Belt with no stripes, which means a person with no ranking yet. Any rung above it, including White Belt · 1 Stripe, means someone graded the student at some point, so it must be verified by staff. Gus: *"each belt and each stripe are a ladder, so a white belt is not a white belt 4 stripes. So white belt only … 1 stripe it means this person has been graded by someone at some point and it must be verified."* In general terms: the discipline's first rung (lowest belt, no stripe) is verified automatically.

---

## Decision 148 — Classes at another branch count when the student may book them; owner assigns home branches

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** the open points of Decision 139 (Q17)

1. **Attendance at another branch counts** toward grading whenever the student was allowed to book that class. Booking decides: if booking lets a Riverside student into a Downtown class, the attended class counts like any other (subject to Decision 140's class-type rules and the weekly cap). Gus: *"if students is allowed to book at the second branch it will means it counts."* Today attendance credit already ignores branch, so no new restriction is added. Which other branches a student may book stays a booking rule.
2. **Existing students without a home branch** are assigned one by the school owner. Until then, the Grading Board shows them under "No branch". Only the owner sees that group, since branch staff see only their own branch (Decision 139). Gus: *"the owner"*.

---

## Decision 149 — "Each ticked type required": the school sets a number per class type

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** the open point of Decision 140 (Q16)

When a rung uses "each ticked type required", the school sets a required number of classes for each ticked type (for example 20 Fundamentals + 10 Sparring). Progress for that rung counts each type separately and is complete only when every type's number is met. In the default "any ticked type" mode, the rung keeps a single total. Gus: *"yes"*.

---

## Decision 150 — Grading events and the grading-fee setting ship in v1.1

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q34; adds to Decision 144 (Q37)

1. **Grading events** (prototype: schedule, participants, Pass/Fail, complete; Decisions 128 and 130) are part of **v1.1**. Asked "Do grading events ship in v1.1, or after it?", Gus answered *"yes it does"*. This replaces the roadmap's earlier "after v1.1" plan.
2. **Grading fee in v1.1:** the grading system gets a **fee switch**; when it is on, a **fee amount** field is shown. Gus: *"On this version, we need to add to the grading system, a toggle for fee, if it is on, we will need a field for fee."* The fee is the school's own charge to its students (Decision 144).

Still open, put back to Gus: whether v1.1 actually collects the fee (card or cash through the school's payment account) or only records the amount owed; whether the switch and amount are set per school, per discipline or per event.

---

## Decision 151 — Franchise-wide ladders, behind an on/off switch

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q10

A franchise can share one ladder across its schools, controlled by an on/off switch. Gus: *"yes, we need a toggle to switch this on and off."* Today a Discipline belongs to one School only, and nothing is shared across a franchise. The tenancy design is not yet decided: who controls the switch, whether schools can edit a shared ladder, what happens to students when it is switched on or off, and the release. Those were put back to Gus. Any design must keep Franchise → School isolation and RLS intact (CLAUDE.md, standing rules).

---

## Decision 152 — Disciplines picked from the school's list; rung reordering allowed with confirmation; "currently attending" from membership

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q11, Q13, Q19

1. **Classes, timetable slots and instructor specialisations pick their discipline from the school's Discipline list** instead of free text (Gus: *"yes"*). This replaces Decision 90's exact-string bridge once built. Existing free-text values need a one-time mapping.
2. **Rungs can be reordered by drag even when students hold them**, after a confirmation that lists the students affected. Deleting a rung students hold stays blocked (Gus: *"yes"*).
3. **"Currently attending only" on the Grading Board** is decided automatically by an active membership, and a manual Active/Inactive switch per student overrides it. Gus: *"Automatic from membership, with the manual switch as an override."*

---

## Decision 153 — "Edit rank date" correction action

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q31 (HANDOVER §9 open item 6)

Anyone with grading permission can correct the date a student reached their current rung. A note goes on the history recording the old date, the new date, who changed it and when. The grading-date rule (Decision 128, item 8) is unchanged. Gus: *"correct"*.

---

## Decision 154 — Lessons: watchable by students and guardians with a paid membership for that activity

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q40, Q41

1. **Who can watch:** students and guardians with an account and an **active paid membership for that activity** (discipline). Gus: *"Yes and guardian, any one with an account and paid membership to the activity."* Today every role holder at the school can read every lesson (`lesson_tenant_isolation`), so reads must be narrowed. How a membership maps to an activity needs checking against `MembershipPlan` during design.
2. **Video pricing for schools** is decided later, when video is built (Gus: *"yes"*).

---

## Decision 155 — Student app: rank history in the next release, lessons once video exists

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q43

Adds to Decision 142: the app also shows **rank history** in its next release, and **lessons** once video hosting is built. Gus: *"yes"*. Asked whether students should see "Ready to Grade" before the coach decides, Gus answered *"yes, students will [see] the whole progression of their grading."* Whether that is always on or a school setting was put back to Gus (Q45).

---

## Decision 156 — Skill sign-offs are logged

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q47

Every skill sign-off change (Not started / Learning / Signed off) is logged with who, when, the old status and the new status. Today `cycleSkillSignOff` overwrites the status with no trace. Gus: *"yes"*.

---

## Decision 157 — Gus's handover package stored in the repo as read-only reference

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q50

The complete `dojohq-grading-handover` package (prototype, stress-test harness, click-through test, tools, screenshots, design canvas, notes) is stored unchanged at `deep-review/grading-prototype/` as read-only reference. Its scenarios are the acceptance tests for the grading engine (roadmap Phase 2). Gus: *"yes"*.

---

## Decision 158 — Grading events move to Version 2 (supersedes Decision 150, item 1)

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q34 (revised)

Grading events (schedule, participants, Pass/Fail, complete) are **not** in v1.1. They move to **Version 2**. Gus: *"I think event should be on Version 2, after thinking better."* This supersedes item 1 of Decision 150. The event rules already decided (Decision 128 items 14, Decision 130) stay valid for when events are built. v1.1 keeps the Grading Board, single grading, bulk promote (with Decision 130's acknowledgement step), and the rest of the v1.1 scope. Version numbers are the product owner's (CLAUDE.md, Versioning).

---

## Decision 159 — Grading fees: ULTM8 takes nothing; the school collects; the school chooses how the fee is set

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q37 (in part); adds to Decisions 144 and 150

1. **ULTM8 takes no money from grading fees.** The school collects the fee through its own payment system. Gus: *"ULTM8 does not take, school does it, via their payment system."*
2. **The school chooses how its fee is set:** per event, per rung, or one amount per style. Gus: *"fees can be set per event, per rung or one amount per style, they can choose it."* "Per event" only becomes usable once events exist (Version 2, Decision 158). In v1.1 the choice is per rung or per style.

Still open, put back to Gus: whether "their payment system" means the school's payment account **inside** ULTM8 (Stripe Connect / cash, as with memberships, so the fee appears as a transaction in the portal) or a system **outside** ULTM8 (ULTM8 only shows the amount owed).

---

## Decision 160 — Franchise-wide ladders: franchise owner controls the switch, edits at franchise level only, after v1.1

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q10 (completes Decision 151)

1. The **franchise owner** turns the shared ladder on or off. Gus: *"Yes"*.
2. When on, the ladder is **edited only at franchise level**. Member schools use it but cannot change it. Gus: *"Yes at franchise level"*.
3. It ships **after v1.1**. Gus: *"Later"*. It touches Franchise → School data separation and gets its own design, which must keep RLS and tenant isolation intact. That design must also settle what happens to existing school ladders and students when the switch changes.

---

## Decision 161 — Students always see their full grading progression

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q45 (completes Decision 155)

Students (and guardians, Decision 132) always see the whole progression of their grading in the app, including their progress toward the next rung and when they are "Ready to Grade". This is not a school setting for now. Gus: *"always on, for now"*.

---

## Decision 162 — Grading fee is paid inside ULTM8 as a single-event pass, set up by the school like a day pass

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** Q37 (completes Decisions 144, 159)

**Option A: payment inside ULTM8.** The school owner sets up the grading in the school portal as a **day event**, similar to a day pass. Buying it grants the student access to, and permission to enter, that single event. The money goes to the school through its own payment setup (Stripe Connect card, or cash/bank confirmed by staff, exactly as for memberships). ULTM8 takes nothing (Decision 159). Gus: *"Via the portal, school owner will set up as day event, similar to a day pass. it will grant them access and permission to enter to that single event."*

**Checked against the existing code before recording, not assumed.** ULTM8 can already express this with no new payment code:
- A **one-off Class** (the grading day) plus a `MembershipPlan` of type `CLASS_PACK`, with `classesIncluded = 1` and `scopedClassId` set to that Class. The price is the fee. `schema.prisma` notes the 1-credit cap when `scopedClassId` is set.
- Purchase runs through the existing card (Stripe Connect) and cash/bank flows, which create a `Transaction` and a `Membership`.
- Booking enforces the scope: `bookings.service.ts` rejects a membership scoped to a different Class.
- "Per rung" or "per style" fees (Decision 159) become separate passes for the same grading day, for example a kids fee and an adult fee.

Still to confirm with Gus: whether v1.1 ships this using the existing one-off Class + scoped pass (no grading-events feature needed), with the Version 2 grading-events feature later linking each event to its pass; and whether the v1.1 "fee switch + amount" in grading settings (Decision 150, item 2) is replaced by this pass setup, or should create the pass automatically.

---

## Decision 163 — Grading fee in v1.1 uses the existing single-event pass; no separate fee switch; events become a full module in Version 2

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** the two open points of Decision 162; supersedes Decision 150, item 2

1. **v1.1:** a school sets up a grading day as a one-off Class plus a 1-credit pass scoped to it (Decision 162), using features ULTM8 already has. **Version 2:** grading events are developed further as a **full module** (participants, Pass/Fail, promotions, Decisions 128 and 130), linked to each event's pass. Gus: *"Yes, V2, events are developed further, as full module."*
2. **No separate "fee on/off + amount" setting in v1.1.** The single-event pass is the only way to set a grading fee. This supersedes Decision 150, item 2. Gus: *"Ok"*.

---

## Decision 164 — Moving existing belt-level required skills onto rungs: they go to the first rung of the next belt

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** a data-migration question raised while building grading foundation PR 2 (per-rung fields, Decision 126)

Existing `RankRequiredSkill` rows were written under the old meaning, "needed to **leave** this belt" (the current `GradingService` check). Under Decision 127, a rung's skills mean "needed to get **into** this rung". When they are copied onto rungs, each belt's required skills go to the **first rung of the next belt** in the same discipline. For example, Blue Belt's skills become "needed to get into Purple Belt". This keeps what each School meant. Skills on the top belt have no next rung and are not copied. The original `RankRequiredSkill` rows are kept unchanged until the grading engine (roadmap Phase 2) switches over, so nothing is lost. Gus: *"A"*, and ULTM8 is *"pre-launch"*, so no live School data is affected.

---

## Decision 165 — A rung's stripe colours are set only in its stripe list; its single colour follows the first stripe

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** a gap found on the independent review of grading foundation PR 2 (codestudio26/ULTM8#98): a rung's single `colour` was not checked against its `stripeSegments`

A rung stores its stripe colours twice: the single `RankStripeTier.colour` from V1, and the stripe list `stripeSegments` (Decision 128). From now on:

1. The **stripe list is the only place a rung's stripe colours are set.**
2. The single colour is **filled in automatically from the first stripe in the list**. That is the newest colour the student earned, and the colour the rung is named after. For example, "Grey/White Belt · 1 Yellow Stripe" is 1 yellow then 3 red, so its colour is yellow, not red (the majority). This is how the prototype builds and names rungs (`prototype/index.html`, `redRungs`/`yellowRungs`). The two can never disagree.
3. A rung with no stripes has an empty list; its single colour stays as entered.

Options considered: the stripe list wins (chosen); refuse saves where they disagree; the single colour wins and repaints the stripes. For mixed stripes, "first stripe" was chosen over "the colour with the most stripes", after Gus pointed to the prototype's rung list. Gus: *"A"*, then *"yes"*.

---

## Decision 166 — "Edit rank date": the new date can't be in the future or before the student's previous grading

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** the date bounds of the "edit rank date" correction (Decision 153), raised while building grading foundation PR 3

When staff correct the date a student reached their current rung, the new date:

1. **can't be in the future**, the same as a grading date (Decision 128, item 8); and
2. **can't be before the student's previous grading** on their history, so the history always stays in date order. Voided entries (Decision 129) don't count.

Any day from the previous grading's own day up to today is accepted. The correction also updates the date on the history entry that put the student on this rung, and adds an `ADJUSTMENT` entry recording the old date, the new date, who changed it and when (Decision 153).

Options considered: "no future, no earlier than the previous grading" (chosen), or "no future only", which allows history out of order. Gus chose the first.

---

## Decision 167 — A stripe award restarts the time-in-rank clock

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** a gap found while building grading foundation PR 3 (codestudio26/ULTM8#103)

Every stripe is its own rung and its own grade (Decision 126). So a stripe award restarts the student's time-in-rank clock (`StudentRank.dateOfCurrentRank`) like any other rank change. This is how the prototype behaves: `applyRankChange` sets the rank date for every change. Before this, the stripe-award endpoint kept the belt's date, so the minimum-days count for the next stripe started from the belt grading. "Edit rank date" (Decisions 153, 166) then corrects the stripe's own date. Gus: *"Good catch, please make sure it's done"*.

---

## Decision 168 — Branches and grading: who covers which students

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** four points left open by Decisions 138, 139 and 148, raised while building grading foundation PR 4

1. **A School with no branches:** the School is the branch. Anyone with grading permission (Decision 138) sees and grades all of its students, and joining asks for no branch. Gus: *"Than the branch is the school, that simple."*
2. **Joining a School that has branches** requires choosing a home branch (Decision 139: "chosen when they join"). Gus: *"Required"*. Students enrolled before this keep no home branch until the owner assigns one (Decision 148). Until then, only the owner sees and grades them.
3. **Coaches and staff are assigned per branch, and may be assigned to more than one.** A non-owner sees and grades only the students whose home branch is one of their branches. A staff assignment with no branch, in a School that has branches, covers no students for grading. The owner covers every student. Gus: *"Coaches will have to assigned per branch, which means can be assigned for more than one branch"*, and *"dan can not be with NO Branch or No school"*.
4. **Viewing:** staff without grading permission for a style can still view (read only) the ranks and history of their own branches' students in it. Grading permission covers the actions. Gus: *"Yes, view only"*.

Built as: a `StudentHomeBranch` row per (School, Student), kept separate from the STUDENT `RoleGrant`. A branch on that grant would also hide other branches' classes from the student, and which branches a student may book stays a booking rule (Decision 148). Each branch a coach covers is one INSTRUCTOR or BRANCH_STAFF `RoleGrant` with that branch.

---

## Decision 169 — An instructor always belongs to a branch, or to the School when it has no branches

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** a gap left by Decision 168: an instructor could be added without a branch in a School that has branches, and then could grade no one

When the owner adds an instructor:
- **In a School with branches**, the instructor must be assigned to a branch. An instructor who teaches at several branches is assigned to each of them, one assignment per branch (Decision 168).
- **In a School with no branches**, the School itself is the branch, and the instructor belongs to the School.

So an instructor is always part of something: a branch, or the School. Branch Staff already required a branch. Gus: *"when we add an instructors is has to be part of branch if the school has more than one place or if is single the branch is the school. Meaning an instructor has to be part of something. Branch or school"*.

Instructors added before this rule, without a branch in a School that has branches, are not changed. The owner reassigns them.

---

## Decision 170 — Classes pick their styles from the School's list: required when the School has styles; one or more per class

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** two points left open by Decisions 143 and 152, raised while building grading foundation PR 5

1. **Required when the School has styles.** Every class and timetable slot picks at least one style from the School's list. When that style lists class types, it also picks one of them. A School with no styles set up creates classes without one, using free text as before. Gus: *"Required if styles exist"*.
2. **One or more styles per class.** A class lists one or more styles, each with its own class type. Most classes list one. A mixed class, for example an Open Mat for BJJ and Judo, lists both ("BJJ · Open Mat" and "Judo · Open Mat"), and attending counts once toward each listed style whose type is ticked on the student's next rung in that style (Decision 140). Gus asked for the best solution, and chose it: *"Yes, one or more"*.

Built as: a `styles` list (`[{disciplineId, classType}]`) on Class and TimetableSlot. Classes generated from a timetable slot copy it. Existing classes were mapped once from their free text wherever an entry named exactly one style (Decision 152). Until the grading engine switches over (roadmap Phase 2), the booking rank check and attendance credit keep reading the free-text `activities`, which the API now fills in from the chosen styles' names.

---

## Decision 171 — Counting classes toward a rung: Monday–Sunday weekly cap, combined progress for "each type", nothing ticked counts everything

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** four points the prototype leaves open (it stores `weeklyCap` and `scope` but never applies them), raised while building the grading engine (roadmap Phase 2)

1. **Weekly cap.** Weeks run Monday to Sunday, in the school's local time. Within a week, the first classes up to the cap count, in date order; extra classes that week are ignored, not carried over to the next week. Gus: *"Mon–Sun, extras ignored"*.
2. **Progress in "each ticked type required" mode (Decision 149).** One combined figure, with each type capped at its own number. For 20 Fundamentals + 10 Sparring, a student with 18 and 4 is at 22 of 30 = 73%. Extra classes of one type never make up for another. Gus: *"Combined: 22 of 30 = 73%"*.
3. **A rung with no class types ticked** counts every class. Gus: *"Every class counts"*.
4. **A rung with no weekly cap, or a cap of 0,** has no weekly limit. Gus: *"No limit"*.

Built as: the grading engine, `apps/api/src/ranks/engine/` (pure functions with unit tests; the API, portal and app all get their numbers from it). It is not wired in yet: attendance counting moves onto it in roadmap Phase 2b, and eligibility and the booking check in Phase 2c.

**Confirmed by Gus (9 Oct 2026).** When the next rung is time-only (Brown Belt · 4 Stripes → Black Belt), Decision 127 takes the class number from the **current** rung, and the engine also takes that rung's ticked class types, count mode and weekly cap. So Brown 4 → Black counts exactly as Brown 3 → Brown 4 did: both read Brown · 4 Stripes' settings. Time-only counting starts at Black Belt (Black → Black · 1 Stripe). Gus: *"brown 4 to black, it is the same as brown 3 to brown 4 nothing has changes"*. Decision 140's wording ("ticked on the student's next rung") describes the normal case, where the two readings agree.

---

## Decision 172 — A School has its own time zone, set up the same way as a Branch's

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** the School-wide time zone gap flagged in `class-occurrence-generation.processor.ts`, raised again for the grading engine's Monday–Sunday week (Decision 171)

Decision 76 says a Branch mirrors its School's profile fields, time zone included, but the School never got the field. Gus: *"we need to add the time on school, the set up from branches and schools should be mirrored"* and *"need to add time zone to the set up"*.

1. **School time zone.** A School has an optional time zone (an IANA name such as `Europe/London`), entered the same way as a Branch's: in the create-school form and in school settings.
2. **Which time zone applies.** A class uses its Branch's time zone; when it has no Branch, or its Branch has none, the School's; when neither is set, UTC (today's behaviour). This applies to generating classes from the timetable now, and to the grading engine's days and weeks in roadmap Phase 2b.

Existing Schools start with no time zone, so nothing changes until an owner sets one. Like a Branch's, the value is free text (validated as an IANA name by neither form today).

---

## Decision 173 — Who may book: each rung unlocks class types for booking, set by the school owner

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus). A grading override under Decision 124 where it differs from Spec 55 §6.1 (`eligibleClassTypes` as the booking gate). **Resolves:** how the booking rank gate works once Decision 127 made a rung's ticked class types mean "classes that count toward reaching this rung", raised while building roadmap Phase 2c

Asked whether a student may book the class types up to their current rung or up to their next one, Gus said neither is fixed: *"this decision is for the school owner, for example a lot of academies across the world will allow white 3 stripes and above to join the blue belt and open mats. This is particular to each place, school owner must decide."*

1. **A separate per-rung list, "Unlocks booking".** It is separate from "which classes count" (Decisions 140, 149). The class types a rung lists may be booked by students on that rung and on every rung above it.
2. **Types no rung lists are open to everyone,** so the owner only marks the classes they want to restrict. Fundamentals, listed nowhere, stays open even to a student with no rank yet. A style where nothing is set is open throughout. Gus: *"Yes, any class"*.
3. **Refused otherwise.** A restricted type is refused for a student below the unlocking rung, or with no rank in that style. Staff can still override per booking, recorded as before (SKILL.md §9).
4. **A class with no class type is open.** A class listing several styles must pass for each style.

Gus confirmed the worked example (White · 3 Stripes unlocks Advanced and Open Mat, Purple Belt unlocks Competition): *"yes"*.

Built as `RankStripeTier.bookingUnlocksClassTypes` (kept when omitted on an edit, like the other rung settings), the engine's `bookingAccess`, and one gate shared by booking and the waitlist claim. This replaces Decision 90's activities ↔ style-name bridge for booking. Existing rungs start with nothing unlocked, so every class is open until the owner sets some. The old gate never worked as designed in practice: it compared style names against class types.

---

## Decision 174 — "Each type required" rungs: starting classes per type, and the board drag sets the same % for each type

**Date:** 9 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** how Decision 128's "starting classes" (item 9) and board drag (item 13) work on a rung that counts each class type separately (Decision 149). The prototype has one class count per student, so it doesn't say. Raised while building roadmap Phase 3.

1. **Starting classes, per type.** When the student's new next rung counts each type separately (for example 20 Fundamentals + 10 Sparring), the coach enters a number per type when grading (Fundamentals 5, Sparring 2). For an "any type" rung it stays one number. A time-only new rank takes none. Gus: *"A number per type"*.
2. **Board drag, same % for each type.** Dragging a student on such a rung to a column sets every type to that column's percentage of its own number. For example, Ready to Grade at 66% gives Fundamentals 14/20 and Sparring 7/10. Gus: *"Same % for each type"*.

Item 1 is built in roadmap Phase 3a: the `startingClassesByType` grading field, recorded on the history entry. Item 2 comes with the Grading Board in Phase 3b.

---

## Decision 175 — Age-13 minor limited-login: closed as superseded by Kid Mode, not built

**Date:** 9 Oct 2026
**Status:** Product-owner decision, made directly with the user
**Resolves:** the age-13 limited-login item's own long-standing open status (`skills/ultm8-domain-rules/SKILL.md` §14/§18, "provisional age threshold 13, *pending legal review*") — raised while reviewing the user-journey gap inventory (Step 1, sign-up) for whether it was still needed now that Decision 123's Kid Mode exists.

### Decision

**The age-13 limited-login feature is closed, not built.** Kid Mode (Decision 123) already covers the practical need it was meant to serve — a minor doing something themselves without their own credentials — via a scoped, short-lived token minted from the Guardian's own session, with no new auth surface, no OTP-for-a-minor problem, and no new claim shape every endpoint has to trust. Building a second, parallel "real" minor login (even a read-only one) alongside Kid Mode would be two mechanisms answering overlapping versions of the same question, for no confirmed product need beyond what Kid Mode already serves.

This explicitly reverses the "not a dependency on or a widening of" framing in Decision 123 §"What this does NOT resolve" (line 1424) — that line described the two as merely independent at the time; this decision goes further and closes the age-13 feature outright, rather than leaving it standing as a separate future build.

### Why

Decision 123 itself already laid out why a genuine minor login is a large, separate feature (new auth codepath, new rate-limiting/lockout surface, a new claim shape every downstream endpoint would need to explicitly trust) — that cost was accepted as a tradeoff *against* building a second mechanism, not as a reason to eventually build both. With Kid Mode shipped and the only concrete use case (booking, Decision 123) already served, there's no longer a live product requirement driving the age-13 feature forward; keeping it listed as `[CONFIRMED]`-but-unbuilt indefinitely invited future work against a need that no longer has a clear owner or scope.

### What this does NOT resolve

- Does not retroactively change anything about Kid Mode's own scope (still booking-only, per-minor, Decision 123) — this closes the *alternative* feature, not an expansion of Kid Mode.
- If a future, genuinely different need emerges for a minor's own read-only login (e.g. a minor old enough to want to check their own schedule without a Guardian's device), that would be a new product question requiring its own decision — not a reopening of this one by assumption.
- Decision 77's age-13 threshold finding (the number itself, confirmed final for whenever/if a limited login were ever built) is not disturbed — it simply has no live feature to attach to now.

### Recorded by

Raised by Claude while auditing open gaps against the current, merged state of the codebase (Kid Mode now shipped, grading now merged); the user chose "Close as superseded" over "Keep it open" when asked directly, 9 Oct 2026.

---

## Decision 176 — "Log a class" picks a class type, always counts and is recorded; the board's Active switch is per student per style

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** two points the prototype leaves open now that rungs count by class type and students can train several styles. Raised while building roadmap Phase 3b (the Grading Board).

1. **"Log a class"** (Decision 128, item 6): the coach picks the class type from the next rank's ticked types. If the next rank ticks none, the type is optional. A logged class always counts, even past the weekly cap, because the coach is adding it deliberately. It is written to the student's history (who, when, which type), so the count can be audited. A time-only rank takes none. Gus: *"Pick type, skip cap, record it"*.
2. **The Grading Board's manual Active/Inactive switch** (Decision 152) is **per student per style**: a student marked inactive on the BJJ board still shows on the Judo board. Gus: *"Per student, per style"*.

---

## Decision 177 — Coaches can see which students are theirs: two narrow read-only database rules

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** a gap found building the Grading Board. Decision 168 says coaches see their own branch's students, but row-level security only let the School owner (and each student) see who belongs to a branch or School, so a coach's board came back empty. The existing student roster has the same gap for coaches.

1. **Schools with branches.** An active INSTRUCTOR or BRANCH_STAFF grant at a branch lets its holder **read** the home-branch rows of that branch, and nothing more. Gus: *"Narrow rule for coaches"*.
2. **Schools without branches: the School is the branch** (Decisions 168, 169). That School's INSTRUCTOR/BRANCH_STAFF can **read** its STUDENT role grants (who is enrolled), nothing else, and only while the School has no branch. Gus: *"Yes, the school is the branch"*.

Both are read-only (`FOR SELECT`) and scoped to the caller's own active grant, and they follow impersonation scoping. Each student's grading data (rank, memberships, name) is still read under that student's own context, after this check. Built in `20261021000000_grading_board` (`student_home_branch_staff_read`, `rolegrant_branchless_staff_student_read`, `is_staff_of_school_without_branches()`), with tests for leaks across branches and Schools, for writes, for revoked grants, and for the rule switching off once a branch exists.

---

## Decision 178 — "Ready to grade": after grading actions and daily, once per rank; the background job may read grading data

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** how Decision 145's two grading notifications are delivered. Raised while building them.

1. **When "ready to grade" is checked.** Right after anything that can make a student ready (a check-in, "Log a class", a skill sign-off, a board drag, a rank-date edit, a grade, a declared or verified rank), **and** in a daily sweep, which catches students who become ready by time alone. Gus: *"Actions + daily check, once per rank"*.
2. **Once per rank.** The owner and coaches are told once when a student meets everything for their next rung (classes, minimum days and required skills, per the engine). Every rank change clears it, so the next rung can notify again. Stored as `StudentRank.readyNotifiedAt`.
3. **Who is told** (Decision 145, with Decisions 138, 139, 168): the School owner(s), and the staff with grading permission for that style who cover the student's branch (in a School with no branches, all such staff; a student with no home branch is the owner's alone). Only for an enrolled student, at an open School with ranks switched on.
4. **"You've been promoted"** goes to the student, or, when the student is a Guardian-linked minor, to each linked guardian instead (Decision 145, item 2). Text for a guardian: "Sam has been promoted to Blue Belt."
5. **The background job may read grading data.** These checks run as the background-job role (`ultm8_jobs`), which until now could not read grading tables, and guardian links are readable only by the guardian. With Gus's approval, that role gets **read-only** access to student ranks and skill sign-offs, the ladder (ranks, rungs, rung skills), disciplines, home branches, grading permissions and guardian links, plus students' first name and surname. Its only write is `StudentRank.readyNotifiedAt`. Gus: *"Yes, read-only grants"*. Built in `20261022000000_grading_ready_notification`; the alternative (the job acting as each user) was declined.

Delivery is in-app and email, as for every notification until push is built (Decision 95).

---

## Decision 179 — Grading portal screens are built in English first; translations come later, for more languages

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** how the grading roadmap's Phase 4 exit criterion "translations for all 4 languages including Arabic RTL" applies while the portal has no translation support (Decision 146 already treats that as separate work).

1. The grading screens in the School Portal (student grading panel, Grading Board, ladder editor, grading settings) are built **in English now**. Translation is its own piece of work afterwards. Gus: *"Ok"*.
2. Translations will cover **more than the four languages** named so far, including Asian languages. Which languages, and how, is to be decided then. Gus: *"also the translations will be for more languages, like asian languages, but we will look into this after"*.
3. Browser tests: each screen is tested in Chromium here (desktop and tablet widths, keyboard-only). Firefox and WebKit runs are left to an environment that has those browsers. Gus: *"ok"*.

---

## Decision 180 — Ladder reordering: belts, and stripes within their own belt; a rung keeps its students when it moves

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** how Decision 152 item 2 ("rungs can be reordered by drag even when students hold them, after a confirmation that lists the students affected") applies to ULTM8's two-level ladder. Gus's prototype has one flat list of rungs; ULTM8 stores belts, each with its own stripes.

1. **What can be reordered:** whole belts within a style, and stripes within their own belt. A stripe can't move to another belt. Gus: *"Belts + stripes within a belt"*.
2. **A rung keeps its identity when it moves.** The students holding it stay on it; only the ladder order changes, so their next rank may change. The editor lists the students affected before saving (Decision 152).
3. **A rung students hold can't be removed** (Decision 152). The API refuses and names the students; move them to another rank first. This also closes a gap: before, removing a held rung left its students with no rung.

Built in the API as: rung ids on `PATCH /ranks/{id}` (`stripeTiers[].id`), `PUT /styles/{id}/ranks/order` for belts, and `GET /styles/{id}/rung-holders` (owner only) for the confirmation.

---

## Decision 181 — Grading permission becomes seven toggles per coach per style; board % editable by the owner and coaches given it

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** who may change a style's Grading Board percentages (Decisions 75, 136), and refines Decision 138's single grading permission. Raised while planning the grading settings screen.

1. **Seven toggles, per coach, per style.** The owner always may do everything. For each Instructor or Branch Staff member and each style, the owner sets:
   - **Promote:** grade up, stripe award, bulk promote, give a first rank;
   - **Move down:** downgrade, with a reason;
   - **Sign off skills;**
   - **Adjust progress:** move a student on the Grading Board (e.g. to Ready to Grade), log a class, correct the rank date, and the board's Active/Inactive switch;
   - **Verify self-declared ranks** (or correct them);
   - **Void history entries;**
   - **Change board %:** this style's Grading Board split.

   Each grading action needs its own toggle. The branch rule is unchanged: coaches grade only their own branches' students (Decision 168). Gus: the 7-toggle list, *"Per person, per style"*.
2. **Board percentages are per style** (Decision 75), 33% / 66% by default (Decision 136), changed by the owner or a coach with **Change board %** for that style. Gus: *"The owner + who ever is granted the permission to the grading area"*. The settings screen itself is built separately.
3. **"Ready to grade" notifications** (Decisions 145, 178) go to coaches who may **Promote** in that style.
4. **Existing grants keep every toggle on.** Nobody uses the system live yet (Gus).
5. **A Grading permissions page** in the School Portal lists the school's Instructors and Branch Staff, with "May grade" per style and the seven toggles. The API's permission list includes that staff list (owner only), since no staff roster endpoint existed.

---

## Decision 182 — Templates use the prototype's numbers; Duplicate copies the ladder, skills and settings

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** how the three IBJJF templates (Decision 131) and "Duplicate style" are built.

1. **Templates start with the prototype's numbers.** A style created from one of the three IBJJF templates gets the prototype's belts, stripes, classes required, minimum days, weekly caps, eligible class types and black-belt degree years (`buildIbjjfLadder`), plus its five class types. Each belt's totals are spread over its five stripe rungs, as in the prototype. The school then edits everything as its own; the template is not linked afterwards. Gus: *"Prototype numbers, then edit"*.
2. **Duplicate copies the ladder, skills and settings.** The copy, named "… (Copy)", gets every belt and rung with all their rules, every skill (re-linked to the copied belts and rungs), the class types, the "skills required" switch and the board %. It does not copy students, their ranks or history, lesson links, or coach grading permissions. Gus: *"Ladder + skills + settings"*.
3. **Owner only**, like every ladder edit.

Built in the API as `GET /style-templates`, `POST /schools/{id}/disciplines/from-template` and `POST /disciplines/{id}/duplicate`; in the School Portal as **Start from template** and **Duplicate** on the Disciplines page.

---

## Decision 183 — Coach invites: one emailed link per coach, single use, 7 days; "Can invite coaches" for Branch Staff

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** how a coach joins a School. Spec 55 §8.2 says Instructors are "provisioned by School invite, not self-registration"; until now the only invite was the owner granting the role to an existing account (Decisions 80, 116).

1. **Coaches have an ordinary account**, like students and parents, and don't buy a membership to coach. They become a coach in one of two ways: the owner grants the role to their existing account (unchanged), or they accept an invite link. Gus: *"account owner will upgrade the account to coaches level or school owner will send an coaches invitation link, which will auto link the coaches to a coaches account"*.
2. **The invite link:** one per person, sent by **email**; it works **once**, for **7 days**, and can be **cancelled**. Gus: *"Single use, 7-day expiry, cancellable"*. Text-message invites need a new Twilio Messaging integration and come later. Gus: *"Email now, text later"*.
3. **Accepting:** the person opens the link, logs in (or creates their account) **with the invited email**, and accepts. Their account gets an INSTRUCTOR grant at the School, at the branch chosen in the invite when the School has branches (Decision 169). Matching the email stops a forwarded link being used by someone else.
4. **A coach keeps their student side.** Any role the account already holds, such as STUDENT, is kept (Spec 55: a person may hold more than one role). Gus: *"A coach keeps their student side"*.
5. **Who can invite:** the owner, and Branch Staff the owner has given **"Can invite coaches"**, set per staff member. Gus: *"owner and those who have been granted the access to the invitation area… a school operator could be assigned this job"*; *"Can invite coaches toggle"*. **Branch Staff only:** Spec 55 §8.2 rules out instructor management for Instructors, and a decision can't override the spec outside grading. Gus: *"Branch Staff only"*. **Own branches only** for staff; the owner can invite to any branch. Gus: *"Own branches only"*.
6. **Security:** only the token's SHA-256 is stored. Row-level security lets the owner manage all of the School's invites, staff with the permission manage their own branches' invites, and the link holder read and accept only that one invite. Whoever sends an invite must have a verified phone (Decision 81).
7. **The coach dashboard** (grading, their classes, notifications, their own student info), in the web portal and the mobile app, is Decision 184 and is built separately.

Built in the API as `CoachInvite` and `StaffPermission` with the endpoints listed in the CHANGELOG, and in the School Portal as **Invite a coach** and **Who can invite coaches** on the Staff page, plus the invite link page `/coach-invite/{token}`.

---

## Decision 184 — The coach dashboard, on the web portal and the mobile app

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** what a coach sees after signing in. Gus: *"We need to create a coaches dashboard, similar to the students, carrying the coaches info too such as, Grading, their classes, messages, plus their students info if they are a students"*; *"Both Mobile app and Web Portal, just like the students portal"*.

1. **Where:** both the School Portal (web) and the mobile app. The web portal is built first; the mobile app's coach screens follow on the Track B branch.
2. **What it shows:**
   - **Grading:** the styles the coach grades in (Decision 181), with how many of their students are ready to grade and getting there, and the Grading Board and student panels for them.
   - **Their classes:** the weekly timetable slots and upcoming classes where they are the instructor.
   - **Messages:** their notifications for now. There is no messaging between people yet; that is its own feature later. Gus: *"Notifications for now"*.
   - **Their own training:** when they also train at the School, their ranks and progress (Decision 183: a coach keeps their student side).
3. **Only what they may do.** A coach sees the Grading Board and student panels for their styles only, and only the actions their toggles allow (promote, move down, sign off skills, adjust progress, verify, void, change board %). The API enforces this regardless (Decision 181). They see students of their own branches only (Decision 168).
4. **Sign-in and menu:** a coach who doesn't own the School lands on their dashboard, with a menu of Dashboard, Grading Board and Notifications; the header shows "Coach". A coach at several Schools sees the first one for now (no School switcher yet).

Built in the API as `GET /schools/{id}/grading-permissions/me` (the caller's own styles and toggles; the owner gets `isOwner: true`), and in the School Portal as `/coach`, with the Grading Board and student panel working for coaches.

---

## Decision 185 — Grading hardening: one-rung default steps, no downgrade notice, grades tied to the rung the grader saw

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** questions raised by the Phase 7 hardening round (Gus's scenarios re-run against the API, and the grading stress test).

1. **Default step is one rung.** A promote with no target rung goes to the next rung; a downgrade with no target goes to the rung just below, as the prototype's windows do. Before, the API defaulted to the next (or previous) belt's first rung. The portal always sends a target, so this matters for direct API callers such as the coach mobile app. Gus: *"Next rung, like the prototype"*.
2. **No notification on a downgrade.** Only "ready to grade" and "promoted" / "new stripe" are sent (Decision 145); a downgrade shows in the student's history. Gus: *"Remove it"*.
3. **A grade refers to the rung the grader saw.** Grading requests may carry the student's current rung as the grader sees it; if the student has moved since, the request is refused (409) and the grader reloads. The portal always sends it, and bulk promote uses the rung from its own plan, so a batch can't undo a downgrade made in the meantime or give two rungs at once (Decision 130: one rung each). Two coaches awarding the same stripe at once: one wins, the other is told to reload.
4. **Only the School's students are graded.** Grading actions refuse anyone without an active student role at the School (404), checked after the caller's own rights.

Also fixed in the same round, with no new rule: rank history is listed newest first by grading date; the board's "N inactive hidden" counts every inactive student in the style whatever the search (Gus's 7 Oct fix); ladder edits of one style take turns instead of deadlocking; bad ids and out-of-range starting classes are refused with 400.

---

## Decision 186 — Branch Staff use the coach screens

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** a gap found in the Phase 7 decision review. Decision 181 counts Instructors and Branch Staff as "coaches" for grading permissions, but the coach invite and coach dashboard (Decisions 183, 184) were built for Instructors only, so Branch Staff given grading toggles or "Can invite coaches" had no portal screens to use them.

1. **Branch Staff get the same screens as coaches** in the School Portal: they land on the coach dashboard, use the Grading Board and student panel for the styles they may grade (only the actions their toggles allow, students of their own branches), and see their notifications. Gus: *"Same coach screens"*.
2. **Branch Staff with "Can invite coaches"** also get **Invite coaches**, limited to their own branches; the owner keeps inviting from the Staff page, where "Who can invite coaches" stays owner only.

Built in the API as `GET /schools/{id}/staff-permissions/me` (the caller's own invite rights), and in the School Portal as the coach screens for Branch Staff plus `/coach-invites`.

---

## Decision 187 — Words on screen: belts and stripes, not "rungs"

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** wording. Gus: *"The division between belts are called stripes."*

Every word a user reads (School Portal, Student app, emails, notifications, API error messages) says **belt** and **stripe**: a student holds a belt with a number of stripes (e.g. "Blue Belt, 2 stripes"). "Rung" stays only as an internal name in code and in earlier entries of this log, where it means one step of the ladder: a belt with a given number of stripes.

---

## Decision 188 — Instructors choose their own belt per style; the owner verifies it

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** the V1 specifics Decision 108 left open. Gus: *"Just like students, they will choose and school owner will verify"*, and chose *"Per style, from the School's belts"*.

1. **The instructor chooses**, on their own profile page in the School Portal, a belt and stripes **for each style**, from that style's belts at the School, the same way a student self-declares at signup (Decision 137).
2. **It is unverified until the School Owner verifies it, or corrects it.** Until then it shows as "Not verified".
3. Linking an instructor's belt to their grading history (Decision 108's V2) stays out of scope.

---

## Decision 189 — Belts waiting to be verified: a notice at login for grading staff only

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Confirms:** Decision 137.4. Gus chose *"Staff only"*.

When the School Owner, or a coach or Branch Staff member with grading permission, logs in to the School Portal, a notice lists the students whose self-declared belts are waiting to be verified, limited to the styles and students they may grade (Decisions 138, 168, 181). Students and guardians see no such notice.

---

## Decision 190 — Lessons need a paid membership, unless the owner makes a lesson free

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Adds to:** Decision 154. Gus: *"yes, unless it is free of charge set by the school owner"*, and chose *"Each lesson"*.

1. A lesson is watchable by students and guardians with an active paid membership for that activity (Decision 154).
2. **The School Owner can mark any single lesson as free**; a free lesson is watchable by every student and guardian at the School.

---

## Decision 191 — Lesson categories: confirmed

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Confirms:** Decision 128.15. Gus: *"Yes"*.

Lesson categories are a real list with an order, and lessons are ordered within their category.

---

## Decision 192 — Notes in a student's grading history can be edited and hidden; every change is kept

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Adds to:** Decision 128.11. Gus: *"Yes … but records changes and it can be hidden"*, and chose *"Graders edit; hidden from student"*.

1. **Who:** the School Owner, and anyone who may grade that student in that style (Decisions 138, 168, 181).
2. **Edit:** the note's text can be changed. Every change is kept: who, when, the old text and the new text.
3. **Hide:** a note can be hidden, and shown again. A hidden note is not shown to the student or guardian; staff still see it, marked as hidden. Hiding and showing are kept in the same change record.
4. System notes (written by ULTM8, e.g. "Bulk promotion") and the downgrade reason (Decision 128.11) are not edited this way.

---

## Decision 193 — A staff member given a role again starts with today's permissions

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** L1 from the Phase 7 security review. Gus: *"they should get the new permission given at the present time"*.

When an Instructor or Branch Staff role is removed, that person's grading permissions and "Can invite coaches" at that School are cleared. If they are given the role again later, they start with no extra permissions, and the owner grants whatever applies now.

---

## Decision 194 — The board's "inactive hidden" count includes students on the top stripe

**Date:** 10 Oct 2026 · **Status:** Follows Gus's prototype (Decision 124); offered to Gus as the default on 10 Oct 2026. **Resolves:** the question left in the Phase 7 acceptance report (D3).

The Grading Board hides inactive students and shows how many it hid. That count includes inactive students on the last stripe of the top belt, who never appear on the board because they have nothing left to be promoted to, as the prototype does.

---

## Decision 195 — Lessons: membership plans say which styles they cover and whether they include lessons

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** how a membership maps to an activity (left open by Decision 154) and "paid" (Decision 190). Gus chose *"Plans tick their styles"*, then for free passes: *"any one with pass, or if better when we set up the free pass and can give access to the curriculum or not"*, and agreed to *"Yes, switch per plan"*.

1. **Each membership plan ticks the styles it covers.**
2. **Each plan has an "Includes lessons" switch.** It starts on for plans with a price and off for free plans (Friend Pass, £0 plans); the owner can change it on any plan.
3. **A lesson's styles are the styles of the skills it teaches.**
4. **Who can watch a lesson:** a student, or a guardian of that student, with a live membership (active, not expired, credits left for packs) on a plan that includes lessons and covers one of the lesson's styles. A lesson the owner marked free (Decision 190) is watchable by every student and guardian at the School. Staff always see every lesson.

Replaces "paid membership" in Decisions 154 and 190 with this per-plan switch.

---

## Decision 196 — The owner's typed "Belt ranking" on an instructor is removed

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · Gus: *"correct remove the old one"*.

Instructors choose their own belt per style (Decision 188), so the owner's free-text "Belt ranking" on the Instructor profile goes, with its stored values.

---

## Decision 197 — Who edits history notes: confirmed

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Confirms:** the reading of Decision 192 built in PR #145. Gus: *"yes"*.

"Anyone who may grade that student in that style" means the School Owner, or a coach with "Promote" or "Move down" for that style who covers the student's branch.

---

## Decision 198 — Deleting: only what has never been used

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** the acceptance pass's Q2 (Gus's prototype can delete a style, a belt, a skill and a lesson; ULTM8 could not). Asked what fits best, Gus chose the recommended rule: *"Delete if never used"*.

The School owner can delete what no student's record uses; anything that is part of a record stays, and the portal says why. Owner only, with a confirmation.

1. **Lesson:** always (nothing in a student's record points to a lesson).
2. **Skill:** when no student has ever been marked on it (Learning or Signed off, now or in the sign-off log). It comes off the stripes that required it and the lessons that list it; refused if it is a lesson's only skill.
3. **Belt:** when nobody holds it or any of its stripes, it is not in anyone's grading history, and no instructor has declared it (Decision 188). Its stripes go with it and the belts after it move up one place. (Decision 152: a stripe a student holds still can't be removed.)
4. **Style:** when nobody has ever held a rank in it, no instructor has declared a belt in it, and no class, timetable slot or lesson uses it. Its belts, skills and coach grading permissions go with it, and it is taken off membership plans (Decision 195) and instructors' styles.

Not in this decision: archiving a used style or belt (hide it, keep the records). Offered and not chosen for now.

Built as `DELETE /disciplines/{id}`, `/ranks/{id}`, `/skills/{id}`, `/lessons/{id}` (204, or 409 with the reason), with **Delete** buttons on the Disciplines, style and Curriculum pages.

---

## Decision 199 — The belt-level weekly cap and required skills are removed; the plain belt keeps its own on its rung

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** the open item left by Decision 164 (belt-level required skills, and the belt-level weekly cap, still written by the API but ignored by grading since roadmap Phase 2).

Asked whether they can be removed, Gus: *"Yes as longer we have that on the non stripe belts for exemple brown belt! Not brown belt 1 stripe"*.

1. **Removed:** `Rank.weeklyClassCountCap` and the `RankRequiredSkill` table, and the belt-level `weeklyClassCountCap` / `requiredSkillIds` in the ranks API (sending them is now a 400).
2. **Kept, as Gus asked:** the plain belt (e.g. "Brown Belt", no stripes) is a rung of its own, with its own weekly cap and required skills (Decision 126), edited like every other rung. Its skills are what it takes to reach that belt (Decision 127).
3. **Nothing changes for students.** Decision 164 had already copied each belt's cap onto its rungs and its skills onto the next belt's first rung, and grading reads only the rungs, so nothing is copied again; the migration logs what it drops.
4. **Not removed:** the belt-level "years in rank" flag (also unused by grading since Decision 128 item 3 made "time in rank only" a per-rung switch). It wasn't part of the question; left until asked.

Built in migration `20261102000000_remove_belt_level_settings`.

---

## Decision 200 — Timetable "click-to-book" UI surfaces the TimetableSlot ↔ Class relationship as a real blocker, not just a citation

**Date:** 26 Sep 2026
**Status:** Developer-level finding, escalated — **not resolved**, flagged for Architect decision before any backend work starts
**Resolves:** why the Timetable design-canvas mockup's new "Book" action (added to every slot across Daily/Weekly/Monthly, per the user's request to make booking a class easier straight from the Timetable) is a review-only preview and not a real booking flow

### What was built

Every rendered slot on the Timetable mockup (`https://claude.ai/artifact/MbCT5h6Nq23yeZY8Sf7myu`, `Timetable.dc.html`) now has a "Book" affordance — a pill button on Daily/Weekly's agenda cards, a small icon button on Monthly's dots. Clicking it opens a confirmation preview (Class, Instructor, Day-or-Date, Time, Branch, then Cancel/Confirm) matching Spec §3.2's own confirmed booking-flow field set. Confirm only closes the preview — there is nothing to submit to yet.

### Why this can't be more than a preview today

`skills/ultm8-domain-rules/SKILL.md` §9 already carried this as an `[UNRESOLVED]` citation before this session touched Timetable at all: *"How `TimetableSlot` and `Class` actually relate... do not assume one Class row is auto-spawned per TimetableSlot occurrence without this being confirmed."* The real `Booking` entity belongs to `Class` (§10, §16: `Class *—* Booking`), never to `TimetableSlot` — and the Timetable page's own subtitle already states it renders "the recurring weekly slot template — not the bookable Classes list." Adding a Book button to the Timetable therefore reproduces the exact citation the skill already flags, except now against a concrete, user-requested UI feature instead of an abstract data-model question — worth its own decision-log entry so it doesn't stay buried only inside a skill citation and a mockup tooltip.

### What actually needs deciding (Architect, not a Developer inference)

1. Does selecting a Timetable slot resolve to an **existing, already-dated** `Class` occurrence (i.e. is a `Class` row auto-spawned per `TimetableSlot` × calendar date somewhere already, or by some job not yet built)? Or does one need to be **created/looked up on demand** at the moment of booking?
2. If on-demand: what identifies "the same" `Class` occurrence across repeat visits (so two Students booking the same Monday 6pm slot land on one shared `Class`, not two separate ones each capped at their own capacity)?
3. Only once (1)/(2) are answered does a real `POST /timetable-slots/:id/book`-shaped endpoint (or whatever shape falls out of the answer) make sense to design — building one against a guessed answer risks the same class of mistake Decision 105 already warned against (building speculatively ahead of a named, confirmed use case).

### What does NOT need deciding again

The confirmation preview's field set (Class, Instructor, Class Timings, Class Date) is already right — it's a direct match to Spec §3.2's own confirmed booking flow (browse → select → confirm → pay if required). Whatever the Architect decides above, the UI shape built here likely doesn't need to change, only what it's wired to.

### Tracking

Logged in `docs/v1.2-backend-backlog.md` ("Timetable page (mockup — click-to-book preview, Daily/Weekly/Monthly)") and `docs/ULTM8-MASTER-ROADMAP.md` §4 (cross-track open-decisions view), and as `note7` on the canvas artifact itself, so it's discoverable from all three places a future session might look, not just one.

### Recorded by

Surfaced while implementing the user's explicit request to add a click-to-book function to the Timetable page (Daily/Weekly/Monthly) — escalated per this project's standing rule (never fill an `[UNRESOLVED]` domain gap with a plausible-sounding guess), 26 Sep 2026.

## Decision 201 — Membership Plans page rebuilt around a Stats Ribbon; Visibility made an inline, real toggle; a systemic codegen gap found and worked around

**Date:** 26 Sep 2026
**Status:** Developer-level implementation of a design direction the user picked from 5 researched concepts; the codegen finding is a Developer-level workaround, not an Architect ruling
**Resolves:** turning the "Membership Plans — 5 concepts" exploration (`https://claude.ai/artifact/UibYczF3pRDdHXcJAsQRnm`) into real code — the user picked Concept 5 (Stats Ribbon + List) and asked to build what's real now, with anything not backend-ready logged for the dev/backend team instead of faked

### What was built (real, in `MembershipPlansPage.tsx`/`membershipPlanQueries.ts`)

- A stats ribbon above the existing plans table: **Total plans / Visible / Hidden** — real, computed client-side from the same `plans` list the table already renders, no new endpoint.
- **Active members** — the ribbon's 4th tile, shown as a visibly muted/dashed placeholder ("—") with an explanatory `title`/`aria-label`, same "not built yet, not broken" convention `TopBar.tsx`'s disabled search input already established. No per-plan membership-count endpoint exists (`MembershipsController` only has Student-scoped `findMyMemberships`/`getMembershipStatus`) — logged in `docs/v1.2-backend-backlog.md` rather than guessed at.
- **Visibility made an inline, real toggle** — replaced the static Visible/Hidden `Badge` with a `Checkbox` wired to a new `useUpdateMembershipPlanVisibility(schoolId)` hook, sending a partial `PATCH /v1/membership-plans/{id}` body of just `{ visible }`. Confirmed safe by reading `MembershipsService.updatePlan()` directly: every field it doesn't receive is left `undefined` in the Prisma `update()` call, so this never touches a FRIEND_PASS plan's forced `price=0`/`classesIncluded=1` or any other cross-field rule — it only ever changes the one field the user actually toggled.

### What was deliberately NOT built

- **Colour-coded Type badges / a toggle-switch visual** — the mockup concepts used a 5-colour categorical palette and a toggle-switch control that don't exist in `@ultm8/ui` today (`Badge` only supports `'default' | 'accent' | 'success' | 'danger'`; no Toggle/Switch component exists at all). Adding either would be a shared-design-system change affecting every consumer of `@ultm8/ui`, not something to invent unilaterally for one page — the real Visibility toggle above reuses the existing `Checkbox` component instead, keeping the same underlying capability without a new design-system primitive. Left for a future, separate design-system decision if the colour/toggle-switch treatment is still wanted.
- **Duplicate / Archive actions** — present in the mockup's kebab menu as explicitly-flagged proposed items; not carried into real code since no backend endpoint exists for either and this page's real Actions column has only ever had Edit.

### Codegen gap found while wiring the Visibility toggle (not Membership-Plans-specific)

`UpdateMembershipPlanDto`'s generated TS type marks `visible`/`termsWaiverRequired` as non-optional, but a fresh `export:openapi` off the current backend source shows this DTO's OpenAPI schema has **no `required` array at all** — both fields are genuinely optional, matching `updatePlan()`'s own undefined-tolerant handling. `openapi-typescript` appears to render any `@ApiPropertyOptional({ default })` field as non-optional regardless. Grepped the whole schema for the same shape (a `default`-having property absent from its DTO's `required[]`) and found ~10 more affected DTOs: `CreateSchoolDto`/`UpdateSchoolDto`, `CreateFranchiseDto`/`UpdateFranchiseDto`, `CreateClassDto`/`UpdateClassDto`, `CreateTimetableSlotDto`/`UpdateTimetableSlotDto`, `CreateRankDto`/`UpdateRankDto`, `GradingActionDto` — see `docs/v1.2-backend-backlog.md` for the exact field list. Worked around here with one documented type cast in `membershipPlanQueries.ts` rather than widened ad hoc per call site; the real fix (an `openapi-typescript` config/version change, or dropping `default` from the affected Swagger metadata) is a one-time tooling change, logged once rather than repeated per affected page.

### Verification

`npx tsc -p tsconfig.json --noEmit` clean on `packages/api-client` and `apps/school-portal`. `export:openapi` re-run and diffed against the committed `packages/api-client/openapi.json` (byte-identical — confirms the DTO source and the committed schema JSON already agree; the gap is purely in the JSON→TS codegen step). No backend files changed — this decision is frontend-only plus documentation.

### Tracking

Logged in `docs/v1.2-backend-backlog.md` ("Membership Plans page") and as `note2` on the "Membership Plans — 5 concepts" canvas artifact.

### Recorded by

Implemented per the user's explicit choice of Concept 5 and instruction to "build [what's real], and... anything that is not on the back end now... to a list with notes to be done by the dev team back end team," 26 Sep 2026.

## Decision 202 — Transactions page rebuilt around a Stats Ribbon; no backend gap this time

**Date:** 27 Sep 2026
**Status:** Developer-level implementation of a design direction the user picked from 5 researched concepts (same research-first process as Decision 201, applied to Transactions this time: `https://claude.ai/artifact/1vc4HExuUryXohNCwah86P`)
**Resolves:** the user picked Concept 2 (Stats Ribbon + List) and asked for the same "build what's real, log the rest" treatment as Membership Plans

### What was built (real, in `TransactionsPage.tsx`)

A stats ribbon above the existing table: **Total transactions / Successful / Failed+disputed / Total revenue** — all four real and client-computed from the same `transactions` list the table already renders. Unlike Membership Plans' Concept 5, this concept needed no scope decision and produced no backend-backlog entry: `Transaction` already carries `status` and `amount`, so every tile is genuinely real with zero new endpoints and zero proposed placeholders.

One correctness detail worth recording: **Total revenue is grouped by currency, not summed flat.** `Transaction.currency` is per-row and nullable (inherited from `MembershipPlan.currency`, itself an optional, School-chosen field per plan — see `MembershipPlanFormModal`'s own "Your School's own choice, no conversion applied" hint), so a School running plans in more than one currency could have genuinely mixed-currency Transactions. Summing raw minor units across currencies and labeling the result with one currency code would be silently wrong. Implemented as a `Map<currency, sum>` instead, rendering one revenue figure per currency present (almost always just one, in practice) rather than a single figure that assumes a school-wide currency constant that doesn't actually exist in the schema.

### What was deliberately not built

Nothing was left out this time — Concept 2 carried no proposed elements (unlike Concept 1/3/4/5's Refund/Download-invoice/kebab-menu items, all explicitly flagged proposed on their own boards, per Decision 201's same reasoning for why a real read-only page shouldn't grow dead action buttons).

### Verification

`npx tsc -p tsconfig.json --noEmit` clean on `apps/school-portal`. No backend or `packages/api-client` files touched — this decision is frontend-only.

### Tracking

Logged as `note2` on the "Transactions — 5 concepts" canvas artifact. No `docs/v1.2-backend-backlog.md` entry — there is no backend gap to track.

### Recorded by

Implemented per the user's explicit choice of Concept 2 ("ok lets go with Concept 2"), continuing the same build-what's-real policy established in Decision 201, 27 Sep 2026.

## Decision 203 — Waivers page rebuilt around a Split-Pane Reader; per-waiver signature status confirmed not buildable today, at a deeper level than previously flagged

**Date:** 27 Sep 2026
**Status:** Developer-level implementation of a design direction the user picked from 5 researched concepts (same research-first process as Decisions 123/124: `https://claude.ai/artifact/MctvsgBry9WEkEK2Fqq5QL`); the signature-status finding below is a Developer-level investigation, escalated — not resolved here
**Resolves:** the user picked Concept 3 (Split-Pane Reader) and, separately, asked for a "signature field... show[ing] if it has been signed or not" to be added — this entry covers both: what was built for real, and why the signature request could not be

### What was built (real, in `WaiversPage.tsx`)

Replaced the flat table with a list-plus-reader split pane, matching the chosen Concept 3: a compact left-hand list (Title, a truncated preview, and a real reading-time/word-count estimate) beside a right-hand reader pane showing the selected Waiver's **full** `body` text (`white-space: pre-line`, preserving paragraph breaks, capped at `70ch` for readability). This directly closes a gap the shipped code's own `bodyPreview()` comment already admitted: `Waiver.body` can run up to 20,000 characters (`CreateWaiverDto`'s own `MaxLength`) — "far too long for a table cell." Staff can now actually read a waiver's full text without opening the Edit form. Title/preview/reading-time/Last-updated/Edit are all real fields or client-computed values requiring no backend change, same as Concept 1's own real columns.

### What was asked for and why it can't be built today — a deeper gap than this session's own earlier note assumed

Asked via AskUserQuestion which shape to show ("rollup count", "full per-student roster", or "both") and whether to build it for real now or flag it as a mockup placeholder first. The user deferred the shape choice ("which would you pick") and asked to build what's real and log the rest for the backend team ("Just as before"). Recommended shape: **both** — a rollup count, expandable to the full per-student roster — since that's the most useful presentation once the data exists. It doesn't today, for three independently-blocking reasons found by re-reading the actual current backend source (not assumed from this session's own earlier canvas note, which only flagged the first of these three):

1. **No staff-facing endpoint exists at all.** `WaiversController` (verified directly) exposes only `POST /waivers/:id/sign` (a Student/Guardian signs), `POST /waivers/:id/signature-upload-url`, and `GET /waivers/me` (a Student's own signatures, self-scoped). There is no `GET .../waivers/:id/signatures` or equivalent for a School Owner. This was already known from this session's earlier Waivers-concepts research.
2. **New finding — even if that endpoint existed, `WaiverSignature` rows don't model "unsigned."** `WaiversService.sign()` is the *only* code path anywhere that creates a `WaiverSignature` row, and `schema.prisma`'s own model declares `status WaiverSignatureStatus @default(SIGNED)` — grepped the whole backend for any write of `UNSIGNED`/`PENDING`/`EXPIRED` on this model and found none. So a `WaiverSignature` row existing *means* signed; there is no row representing "assigned, not yet signed" despite those being real enum values on `WaiverSignatureStatus`. "Who hasn't signed" can't be read off this table alone — it would have to be computed as (all Students who should sign) minus (Students with a SIGNED row), which needs a Student roster to diff against.
3. **New finding — that Student roster doesn't exist for real in production either.** `WaiverSignatureRequestsProcessor`'s own header comment (the `waiver-signature-requests` job, confirmed by reading it directly) documents a pre-existing, separate, larger gap: no endpoint anywhere in this codebase ever creates a `STUDENT` RoleGrant through the real API — every e2e test seeds one directly with a superuser Prisma client. In a real deployment today this job's own Student-lookup query would return empty, and so would any "how many Students are there to sign this" denominator. This is already tracked elsewhere (the processor's comment cites Decision 95 and the project roadmap) — not a new gap, but a real blocking dependency for this feature specifically, worth stating plainly here rather than leaving it implicit in a job's code comment.

Given all three, nothing under "signature status" could be shown as genuinely real today — not even a partial figure (e.g. a bare SIGNED count with no denominator) without materially misrepresenting what's known. Built instead as a single, visibly inert "Signatures" panel in the reader pane (dashed border, muted text, explanatory `title` tooltip pointing at the backlog) — the same "not built yet, not broken" convention `StatTile`'s `proposed` mode already established for Membership Plans' Active Members tile, adapted here to a panel rather than a numeric tile since there is no honest number to show at all, not even a placeholder "—" metric with a real (if incomplete) count behind it.

### A related, newly-confirmed real behavior worth flagging to the Architect

While tracing this, confirmed that `skills/ultm8-domain-rules/SKILL.md` §13's `[UNRESOLVED]` item — "where `Class.terms/waiver-required` is actually enforced" — **is resolved in code**, just never updated in the skill: `BookingsService` (verified directly) checks, at booking time, whether the Student holds *any* `WaiverSignature` with `status: 'SIGNED'` at that School — not scoped to a specific required Waiver, since `Class` has no field linking it to one particular `Waiver` row (only the boolean `termsWaiverRequired`). This is a reasonable reading of the schema as it stands, but it does mean "requires a waiver" currently means "requires having signed *some* waiver for this School," which may or may not be the intended rule — flagged for the Architect to confirm or correct, not silently treated as settled by this entry.

### Verification

`npx tsc -p tsconfig.json --noEmit` clean on `apps/school-portal`. No backend or `packages/api-client` files touched — this decision is frontend-only plus documentation; the signature-status feature itself is not implemented anywhere, real or placeholder-wired, beyond the inert panel described above.

### Tracking

Logged in `docs/v1.2-backend-backlog.md` ("Waivers page") with the full three-layer gap above, spelled out for the dev team, and referenced from the "Waivers — 5 concepts" canvas artifact's own `note1` (already recorded there before this page was built for real).

### Recorded by

Implemented per the user's explicit choice of Concept 3 ("ok lets go with Concept 3") plus a follow-up request for a signature/signed-status field; shape and build-scope confirmed via AskUserQuestion, then built per the user's "build and create the notes for the dev team" answer, continuing the same policy established in Decisions 123/124, 27 Sep 2026.

## Decision 204 — Notifications page explored as 5 concepts; the session's widest real-vs-proposed gap found — no compose/broadcast capability exists at all

**Date:** 27 Sep 2026
**Status:** Developer-level finding, escalated — the backlog below is logged for the dev/backend team; no real code was changed as part of this entry (design/documentation only)
**Resolves:** the user's request for 5 Notifications concept directions (same research-first process as Decisions 123/124/125), recommended Concept 3, and asked for every non-real element found across the 5 boards to be logged for the backend team

### What was found (verified directly against `NotificationsController`/`NotificationsService`/`schema.prisma`, not assumed)

The real API surface for Notifications is the narrowest of any page redesigned this session: `GET /notifications/me` (list, self-scoped — not School-scoped; Staff and Students share the same endpoint) and `PATCH /notifications/:id/read` (mark read). That is the entire write surface. Every real `Notification` row is written only by the internal `notification-fanout` background job, itself triggered by exactly three system events today (`WAIVER_SIGNATURE_REQUEST`, `PAYMENT_DISPUTE`, `CHARGEBACK_PATTERN_RESTRICTION`) — **there is no endpoint anywhere for a School Owner/Staff member to compose or broadcast a message to their Students.** This is a wider gap than any other page's finding this session (wider than Waivers' missing signature-list endpoint, Decision 203): Waivers was missing a way to *read* an existing capability's data; Notifications is missing the *write* capability itself, for what a school-communication product's core value proposition (per this session's own ClassDojo/Bloomz research) actually is.

Two smaller, independent gaps were also found: `Notification` has no snoozed/deferred state of any kind (only `read`, a plain boolean), and no delete endpoint exists. Push notification delivery itself is real only at the registration step — `DeviceToken` registration works, but actual push SEND is, per that model's own header comment, "deliberately NOT built this phase," so no delivery-rate or read-time metric can be computed even in principle from what the schema stores today (`Notification.read` has no timestamp — no `readAt` column).

### The 5 concepts

1. Refined Table and 2. Grouped Timeline carry no proposed elements at all — both are 100% real fields (`Notification.title`/`body`/`read`/`type`/`createdAt`) or client-side computations over them (a Type label, a relative-time display, day-grouping), same standard Concepts 1/2 met on Transactions/Waivers.
3. Priority Inbox (Linear-style, **the recommended and user-favored direction**) — Unread/All tabs and Mark read are both real; Snooze and Delete are shown, explicitly flagged proposed, and — per a follow-up request — consolidated into a single "⋮" row-actions menu rather than three separate icon buttons.
4. Broadcast Center (ClassDojo/Bloomz-style) — an entirely proposed "Compose announcement" panel above the same real inbox list, built specifically to make the missing-broadcast-capability gap concrete rather than leave it only as prose.
5. Delivery Ribbon — Total/Unread are real but page-scoped (no count endpoint exists to total across every page); Push delivery rate and Read within 24h are explicitly flagged proposed placeholders.

### Tracking

Full backend requirements (a new broadcast/compose endpoint and its open product questions, a snooze data-model decision, a delete endpoint, push SEND + a delivery-status field, a `readAt` column for time-to-read metrics, and a dedicated count endpoint) logged in `docs/v1.2-backend-backlog.md` ("Notifications page"), and recorded as `note1` on the "Notifications — 5 concepts" canvas artifact (`https://claude.ai/artifact/Vi4uogt6Kpiq166NSR9GHm`).

### Recorded by

Requested directly by the user ("Give 5 great ideas... look at other softwares ideas" pattern, continuing Decisions 123/124/125's process), recommendation given via AskUserQuestion-free direct comparison, then the full non-real inventory logged per the user's explicit "any that is not real add to the note for the dev... to do the back end" instruction, 27 Sep 2026.

## Decision 205 — Timetable's "Book" action corrected: Staff-on-behalf-of booking is real; a Student field was missing, not the whole feature

**Date:** 27 Sep 2026
**Status:** Developer-level correction of an earlier overstated finding (Decision 200), verified directly against `BookingsService`/`SchoolsService` before changing anything
**Resolves:** the user's own second-guess on the Timetable mockup's "Book" action ("this is the school view, not the students... does not make sense for academies") — investigated rather than agreed with by default, since the premise turned out to be wrong

### What was found (verified directly, not assumed)

`BookingsService.bookClass()` (`apps/api/src/bookings/bookings.service.ts:81-119`) already has a real, shipped **Staff-on-behalf-of** booking path: when `BookClassDto.studentId` names someone other than the caller, `isStaffAction` is set true and the write is gated by `TenantAuthorizationService.assertStaffAtSchool()` — a School Owner/Staff member can, today, book a named Student into a `Class` for real. So "Book" is not inherently wrong for the School Portal audience — a front-desk/walk-in booking is a legitimate, already-designed capability, not something invented for this mockup. The user's instinct that *something* was wrong with the Book action was still correct, just for a narrower reason than "wrong audience": the confirmation preview never asked which Student it was for at all — no student picker existed anywhere in it, despite that being the one piece of information every real booking action absolutely requires.

Also verified before building the fix: `GET /schools/:id/students` is real (`apps/api/src/tenants/schools/schools.controller.ts`, `SchoolsService.findAllStudentsForSchool`), Staff-gated, returns `id`/`firstName`/`surname`/`email`/`enrolledAt`, full unpaginated list — same "small bounded roster, client-side filter" convention every other picker in this app already follows (confirmed via `apps/school-portal/src/students/StudentsPage.tsx`/`studentQueries.ts`, and cross-checked against the near-identical `instructors/eligible-users` endpoint built for the same reason in Fix 3 earlier this session).

### What was built (mockup only — `Timetable.dc.html`)

Added a required "Student" field to the Book confirmation dialog (all three views share one modal), populated from real-shaped sample data matching `StudentSummaryResponseDto`'s actual fields, with "Confirm booking" disabled until a Student is selected — matching what a real submission would require. Updated the board's own inline comments and the backend backlog to state the corrected finding plainly, including retracting the overstated "no backend booking capability exists for a Timetable slot at all" line from the earlier note.

### What's still not real, and why that hasn't changed

Decision 200's actual blocker stands exactly as before: `bookClass()` takes a `classId`, and this page renders `TimetableSlot` — the recurring weekly template, not a dated `Class` occurrence — and the domain-rules skill's `[UNRESOLVED]` citation on how the two relate is unaffected by anything found here. Adding a real Student field didn't (and couldn't) resolve that; the two gaps were always independent, just previously described as one bigger, vaguer gap than either actually is.

### Tracking

`docs/v1.2-backend-backlog.md`'s existing "Timetable page" section rewritten in place (not appended past) to correct the overstated claim and separate the two gaps clearly, rather than leaving a known-inaccurate note live alongside the correct one.

### Recorded by

Investigated in response to the user questioning the Book action's fit for the School Portal audience ("what do you think?"); the premise was checked against the real code rather than accepted, found materially wrong, and the actual narrower gap fixed per the user's follow-up "lets fix it make sense, any thing that we dont have on the back end please add to the back end to do list," 27 Sep 2026.

---

## Decision 206 — Proposed design: how a manually-added Instructor gets a real login (account-claim invitation, not admin-set credentials)

**Date:** 28 Sep 2026
**Status:** Developer-level proposed design, **not approved, not built** — flagged for Architect/product-owner confirmation before any of this is implemented. Recorded because the user asked directly for the logic to be worked out and written down, not because it's been signed off.
**Resolves:** the open question left by "Add Manually" on the Add Instructor mockup (`InstructorAdd.dc.html`) — that mode collects First Name/Surname/Email for a person who has no ULTM8 account at all, but nothing was ever built to say how that person subsequently gets in. Also generalizes the identical, previously-flagged gap on `StaffPage.tsx`'s invite form ("If a true from-zero invite... is wanted, that's a new capability" — logged in `docs/v1.2-backend-backlog.md`'s Instructors section) so the same mechanism can serve both, rather than building it twice.

### What was checked before designing anything

- `RegisterDto` (`apps/api/src/auth/dto/register.dto.ts`) requires **email, phone, firstName, surname, passcode+passcodeConfirm, dateOfBirth** — all mandatory. "Add Manually" only collects name + email. Even a full self-registration can't be synthesized from what Staff enters today; phone and date of birth are missing, and passcode is explicitly "the account's sole login credential" (Decision 72) — nothing in the confirmed model suggests an admin should be the one setting it on someone else's behalf.
- The only credential-recovery flow that exists (`RequestPasscodeResetDto`/`ConfirmPasscodeResetDto`) is **phone + Twilio Verify OTP**, not an email link or token of any kind. There is no email-based claim/magic-link mechanism anywhere in this codebase to build on — this would be new.
- No `Invitation`-shaped entity exists in `schema.prisma` today. `RoleGrant` requires a `userId` that already exists (`RoleGrantsService.create()`'s `PrismaAuthService` existence check, Decision 80/81) — there's no "grant a role to someone who doesn't have an account yet" path anywhere, confirmed by re-reading that service directly rather than assumed.
- Email delivery is real and already wired (`NotificationDeliveryService`, Postmark primary/SES fallback, Spec 55 §11.4) — usable as-is for whatever this sends.

### Proposed design

A new, generic **account-claim invitation**, not an Instructor-specific mechanism (so it also closes the identical gap on Staff's invite form later, without a second design):

1. **New entity — `AccountInvitation`** (name indicative, Architect's call): `id`, `email`, `firstName`, `surname`, `schoolId`, `intendedRole` (`INSTRUCTOR` | `BRANCH_STAFF`), `branchId?`, a cryptographically random single-use `token` (hashed at rest, like the OTP codes already are), `expiresAt` (proposed 7 days), `createdByUserId`, `status` (`PENDING` | `CLAIMED` | `EXPIRED` | `REVOKED`), `draftProfile` (JSON — the rest of what Staff already entered on Add Instructor: branch, phone, beltRanking, specializations, yearsOfExperience, bio, photoUrl; empty for a future Branch Staff use of the same mechanism).
2. **On Add Instructor's "Add Manually" submit:** server first checks whether `email` already belongs to an existing `User` (via `PrismaAuthService`, same lookup Decision 116 already uses). If it does, **reject** and point Staff at "Invite to Instructor Role" instead — that page already exists precisely for an existing account, and this keeps the two flows from overlapping or ever creating a duplicate account for the same person. If it doesn't, create the `AccountInvitation` row (status `PENDING`) and enqueue an email — reusing `NotificationDeliveryService` — with a claim link (`https://.../claim-invitation?token=...`). No `User`, `RoleGrant`, or `Instructor` row is created yet.
3. **New unauthenticated, token-gated endpoints:** `GET /invitations/:token` (validates not expired/claimed/revoked, returns `firstName`/`surname`/`email` to prefill a screen — never anything from `draftProfile`, which is internal); `POST /invitations/:token/claim` (body: the same required fields `RegisterDto` already needs minus name/email, which come from the invitation — phone, passcode+confirm, dateOfBirth, plus the existing optional fields). On success, in one transaction: create the `User` row (same path `AuthService.register()` already uses), create the `RoleGrant` (`RoleGrantsService.create()`'s existing logic, `role=intendedRole`), create the `Instructor` row from `draftProfile` (`InstructorsService.create()`'s existing logic), mark the invitation `CLAIMED`. A token that's expired or already claimed fails with a clear error, same as an already-used OTP does today.
4. **New frontend screen — "Complete Your Registration":** effectively the existing Register screen, pre-filled with the invitation's name/email (email shown read-only — it's what the invite was sent to) and gated by the token in the URL instead of being open self-registration. No new field vocabulary — same fields `RegisterDto` already requires.
5. **Expiry/resend/revoke:** an expired or revoked invitation should be resendable/revocable by the School Owner (same authorization gate as the invite itself) — not designed further here; flagged as part of the same follow-up work, not a separate gap.

### Why this shape, not a simpler one

- **Not admin-set passcodes** — nothing in the confirmed model treats passcode as something anyone but the account holder sets; this preserves that without needing a new decision to violate it.
- **Not reusing the phone-OTP reset flow** — that flow authenticates *an existing* User by proving phone ownership; there's no User yet here to attach an OTP challenge to, so it doesn't fit.
- **Generic, not Instructor-only** — costs nothing extra to design this way now, and avoids building the identical mechanism twice when Staff's own from-zero invite gap (already flagged) gets picked up.
- **Server-side existing-email check before creating an invitation** — closes the risk of two divergent paths (Add Manually vs. Invite to Instructor Role) ever producing two accounts for one person, which neither page's design considered in isolation.

### What this does NOT resolve

- Whether 7 days is the right expiry, whether resend should be rate-limited, and exact copy/branding for the claim email — left to whoever builds this.
- Whether `AccountInvitation` should also become the mechanism for Guardian/minor account creation or any other "someone else creates this account" flow elsewhere in the product — out of scope, not evaluated here.
- This is still unbuilt. `InstructorAdd.dc.html`'s "Add Manually" mode stays tagged Proposed/Placeholder exactly as before; nothing in this decision changes what's real today.

### Tracking

`docs/v1.2-backend-backlog.md`'s "Add Manually" note (under "Add / Update Instructor pages") updated to point here instead of carrying the design inline.

### Recorded by

Written up directly at the user's request ("we need to send the new user a log in. How are we going to do that, write the logic and add to the back end notes"), 28 Sep 2026 — a proposed design, not a product decision; needs Architect/product-owner confirmation before anything here is built.

---

## Decision 207 — The belt-level "years in rank" flag is removed too

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Completes:** Decision 199, which left this flag out because it wasn't part of that question.

Asked whether the belt-level "years in rank" switch can go like the weekly cap and skills, Gus: *"yes"*. Each rung has its own "time in rank only" switch, with the years stored as minimum days (Decision 128, item 3), and grading reads only that, so nothing changes for students. `Rank.yearsInRankFlag` is dropped (migration `20261103000000_remove_years_in_rank_flag`) and a belt no longer takes or returns it.

---

## Decision 208 — Lesson access is also enforced by the database

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Completes:** Decisions 154, 190 and 195, which the API enforced alone.

Gus: *"yes add the database check"*.

1. **What it does.** A lesson's content (description, video and captions) moves to its own table, `LessonContent`. The database gives it only to: staff at the School (Owner/Manager, Branch Staff, Instructor); anyone at the School when the lesson is free; a student whose live membership (active, not expired, credits left) is on a plan that includes lessons and covers one of the lesson's styles. A guardian reads through the child's context, as the API already does. Same rule as the API's (Decisions 154, 190, 195).
2. **What doesn't change.** The lesson itself (title, category, order, styles, "free") stays readable by anyone at the School, so a locked lesson still shows what it is. Nothing changes for users: they see exactly what the API showed before. Only staff write content.
3. **Why.** A second layer: if a future server change forgot the check, the database would still not hand out a locked lesson's content. When the two disagree, the database wins.

Built in migration `20261104000000_lesson_content_access` (`can_view_lesson_content`, `is_lesson_staff`); existing content is copied into the new table.

---

## Decision 209 — A School's branch names are shown to people browsing it, so they can choose a home branch when joining

**Date:** 10 Oct 2026 · **Status:** Product-owner decision (Gus) · **Resolves:** a gap found building the app's join screen for Decision 137.1. Joining a School with branches needs a home branch (Decisions 139, 168), but someone who hasn't joined can't read the School's branches: the database only shows them to people with a role there.

Gus chose *"Show branch names"* over letting people join without a branch.

1. **What is shown.** The School's page in the app (`GET /academies/{id}`) lists its branches by **name only**, to anyone signed in, the same way the School's own name and address are already shown (Decision 94). A branch's address, phone and other details stay visible to the School's own people only.
2. **How.** Through the separate discovery database role, like the rest of the School's public page, with a column-level grant on the branch's id, School and name only. The database refuses that role anything else about a branch.
3. **What it enables.** The app's **Join this School** screen: who is joining (oneself or a guardian's child), the home branch, then the current belt in each style (Decisions 137, 147). The belts come from a new `GET /students/{id}/ranks/declare-options`, read through the student so a guardian can use it too.

Built in migration `20261105000000_branch_discovery`.

---

## Decision 210 — TimetableSlot↔Class relationship: already resolved by existing code, not an open question

**Date:** 10 Oct 2026 · **Status:** Confirmed by reading the code, not a new design
**Resolves:** the `[UNRESOLVED]` flag in `skills/ultm8-domain-rules/SKILL.md` §9 and the "blocking architectural gap" `docs/v1.2-backend-backlog.md`'s Timetable section had been carrying.

Asked how `TimetableSlot` should relate to `Class` for real Timetable click-to-book, the user asked to see how Classes are actually created today before deciding. Reading `apps/api/src/jobs/class-occurrence-generation.processor.ts` directly (not assumed) showed this was already built: a daily repeatable BullMQ job materializes real, dated `Class` rows from every active `TimetableSlot` up to `WEEKS_AHEAD` (4) weeks ahead, each carrying `timetableSlotId` and `occurrenceDate` as real columns. There is no remaining architecture question — `ClassesController`/`ClassesService` simply don't yet expose a lookup by `timetableSlotId`+`occurrenceDate`, which is the one small thing Timetable's "Book" action needs to resolve a clicked slot+date to its already-materialized `Class` and book it via the existing Staff-on-behalf-of `bookClass()` path.

### Tracking

`docs/v1.2-backend-backlog.md`'s Timetable section to be corrected to reflect this — the blocker was a missing read endpoint, not an open relationship question.

### Recorded by

Investigated at the user's direct request ("not sure — need to see how Classes are created today first") during the v1.2 backlog unblocking pass, 10 Oct 2026.

---

## Decision 211 — Instructor "Add Manually" account-claim invitation (Decision 206) approved for build

**Date:** 10 Oct 2026 · **Status:** ~~Approved by product owner~~ **Superseded by Decision 237** (11 Oct 2026) — a different, incompatible mechanism (system passcode + forced reset) was chosen instead when this exact question was re-asked the next day, without this entry having been surfaced at the time. Never built. · **Promotes:** Decision 206 from proposed design to approved

Decision 206's account-claim invitation design (new `AccountInvitation` entity, two unauthenticated token-gated endpoints, claim-link email reusing `NotificationDeliveryService`, a "Complete Your Registration" screen) is approved for build as specified there. This is the blocking dependency for Instructor Add Manually to work end-to-end.

### Recorded by

User, choosing "Build Decision 128 now" [renumbered 206] when asked how to unblock the v1.2 backlog's Instructor Add Manually item, 10 Oct 2026.

---

## Decision 212 — Address-lookup/geocoding provider: Google Places

**Date:** 10 Oct 2026 · **Status:** Approved by product owner
**Resolves:** the open gap `docs/v1.2-backend-backlog.md` flagged — zero geocoding/address-lookup provider confirmed anywhere in Spec 55 or this log, unlike the spec's other named infra gaps which all had a resolved vendor.

Address fields across Branch/Franchise/Instructor Add/Update forms will be backed by Google Places (autocomplete + validation). **Needs a Google Cloud API key provisioned by the user before this can be built** — not something a Developer session can provision itself.

### Recorded by

User, choosing "Google Places" when asked which provider should back the Address fields, 10 Oct 2026.

---

## Decision 213 — Confirmed currency list: modest expansion, starting with CAD

**Date:** 10 Oct 2026 · **Status:** Approved by product owner
**Resolves:** the mismatch flagged in `docs/v1.2-backend-backlog.md` — Branch/Franchise/School demo data across the redesign canvas is consistently Toronto/Vaughan-based (CAD), but CAD was never one of the 6 confirmed launch currencies (GBP/EUR/USD/BRL/AED/MYR).

The user's first answer ("we will add all the currencies") was broader than the yes/no asked, so it was checked again rather than assumed: full ISO 4217 support (~180 currencies, touching every Price/amount field, Stripe currency-support checks, and every currency-formatting call site) is materially bigger than adding CAD to the existing curated list. Re-asked, the user confirmed a modest expansion of the curated list — CAD specifically, matching the demo data, not a dynamic world-currency selector. Further named additions beyond CAD can be added the same way on request; none are added here without being named, per this project's standing rule against inventing unspecified scope.

### Recorded by

User, choosing "Modest expansion (recommended)" after the broader first answer was checked back, 10 Oct 2026.

---

## Decision 214 — Waiver signed-state: diff against the real Student roster, not an explicit Pending row

**Date:** 10 Oct 2026 · **Status:** Approved by product owner · **Depends on:** Decision 215 (real Student enrollment)
**Resolves:** the first of the three layered gaps Decision 125's own waiver-signed-state finding described, for `docs/v1.2-backend-backlog.md`'s Waivers section.

Asked for a recommendation between (a) diffing signed `WaiverSignature` rows against the real Student roster once it's real, or (b) writing an explicit `Pending`/`Unsigned` row per assignment up front: both approaches were checked and found to depend on the same underlying gap — writing a Pending row still requires knowing which Students to write one for, which still needs real enrollment data, so it doesn't avoid the dependency, it just moves where it's hit. Recommended, and approved: diff against the real roster (Decision 215) once built — no new write path, no stale-row risk if a Student later leaves the School.

### Recorded by

User, confirming the Developer recommendation given during the v1.2 backlog unblocking pass, 10 Oct 2026.

---

## Decision 215 — Build the real Student enrollment path now

**Date:** 10 Oct 2026 · **Status:** Approved by product owner
**Resolves:** the gap `WaiverSignatureRequestsProcessor`'s own header comment, Decision 95, and the project roadmap already flagged — no endpoint anywhere creates a `STUDENT` RoleGrant through the real API; every e2e test seeds one directly with a superuser Prisma client.

`SchoolsService.join()` already has the self-service path (Decision 96) and the Guardian-on-behalf-of branch (Phase 38) designed and precedented — this closes the gap by actually exercising that real path end-to-end rather than test-seeding around it, and unblocks both Decision 214 (Waiver signed-state) and Student Invite's enroll step.

### Recorded by

User, choosing "Yes, build it now (recommended)" when asked directly, 10 Oct 2026.

---

## Decision 216 — Waiver enforcement scope confirmed: any signed waiver at the School

**Date:** 10 Oct 2026 · **Status:** Confirmed by product owner, zero code change
**Resolves:** the `[UNRESOLVED]` note in `skills/ultm8-domain-rules/SKILL.md` §13 that Decision 125 had already found was actually resolved in code but not yet confirmed as intended.

`BookingsService` already checks at booking time whether the Student holds *any* `SIGNED` `WaiverSignature` at that School, not one scoped to a specific required Waiver (`Class` has no field linking it to one canonical Waiver — only the boolean `termsWaiverRequired`). Confirmed as the intended behavior, not an oversight — no code change needed, this closes the `[UNRESOLVED]` flag.

### Recorded by

User, choosing "Any signed waiver at the School (matches current code)", 10 Oct 2026.

---

## Decision 217 — Build all four Instructor missing fields (Address, a second Activities list, Certification upload, consent)

**Date:** 10 Oct 2026 · **Status:** Approved by product owner · **Depends on:** Decision 218 (upload pipeline) for Certification
**Resolves:** the Add/Update/Detail Instructor gaps `docs/v1.2-backend-backlog.md` catalogued — none of Address, a second Activities-distinct-from-Specializations list, a Certification file, or consent/terms checkboxes exist on `Instructor` today.

All four approved for build, a larger scope than the Developer recommendation (defer) given. Certification is a file upload, so it's sequenced behind Decision 218.

### Recorded by

User, choosing "Build all four now" when asked whether to build or defer, 10 Oct 2026.

---

## Decision 218 — File/image upload pipeline: S3-compatible object storage

**Date:** 10 Oct 2026 · **Status:** Approved by product owner
**Resolves:** the app-wide gap shared by Instructor/Student/Branch/Franchise photo fields and the new Instructor Certification field (Decision 217) — no real upload pipeline exists anywhere in ULTM8 today; every photo field is settable only as a plain URL string.

S3-compatible object storage, presigned upload URLs — the same pattern `WaiversController`'s existing `POST /waivers/:id/signature-upload-url` already uses, extended rather than building a second mechanism. **Needs a real S3 bucket (or equivalent) and access credentials provisioned by the user** before this can be built.

### Recorded by

User, choosing "S3-compatible object storage (recommended)", 10 Oct 2026.

---

## Decision 219 — Instructor belt/rank reuses the Student rank system

**Date:** 10 Oct 2026 · **Status:** Approved by product owner
**Resolves:** the gap flagged for Instructor's `beltRanking` field (free text only, e.g. "Black Belt, 3rd Dan") against the template's structured ranking dropdown.

Rather than a separate Instructor-only rank structure, Instructor profiles will carry the same Discipline/Rank/Stripe structure Students already have via `StudentRank`. A real design/migration pass is still needed to work out how an Instructor-shaped rank record attaches (Instructor isn't a Student), left to implementation.

### Recorded by

User, choosing "Yes, reuse the Student rank system", 10 Oct 2026.

**Status update (12 Oct 2026):** already built, before this decision was logged. Decision 188 (PR #142) gave instructors an `InstructorBelt` per style, chosen from the School's own Discipline/Rank/Stripe ladder (the same one students use) and verified by the owner; the old free-text `beltRanking` field is gone. No separate design pass is needed.

---

## Decision 220 — Build Student Measurements as real fields

**Date:** 10 Oct 2026 · **Status:** Approved by product owner
**Resolves:** Student Detail's Measurements fields (Weight Category, Kimono Size, Belt Size), which `docs/v1.2-backend-backlog.md` had flagged as having zero grounding anywhere in Spec 55, the domain-rules skill, or the schema.

Approved for build as real fields on `User` or `StudentRank` (implementation's call which), overriding the Developer recommendation to drop them for lack of grounding. Recorded per this project's own "ask rather than guess" rule — flagged as ungrounded before building, decision made directly with the product owner rather than silently dropped or silently built.

### Recorded by

User, choosing "Build them as real fields" over the Developer recommendation to drop, 10 Oct 2026.

---

## Decision 221 — Skip the IP-geolocation smart default on the Mobile Number picker

**Date:** 10 Oct 2026 · **Status:** Approved by product owner
**Resolves:** the Mobile Number searchable picker's "Based on your location" default (added 7 Oct), which `docs/v1.2-backend-backlog.md` flagged as Proposed/Illustrative with no IP-geolocation provider confirmed anywhere.

Drop the smart default; the picker keeps its fixed per-locale default. No vendor, no new cost.

### Recorded by

User, choosing "Skip the smart default (recommended)", 10 Oct 2026.

---

## Decision 222 — Build Notifications Snooze

**Date:** 10 Oct 2026 · **Status:** Approved by product owner
**Resolves:** the Snooze gap in Concept 3 (Priority Inbox) that Decision 126 had catalogued — no snoozed/deferred state exists on `Notification` today.

Approved for build: a `snoozedUntil` timestamp column plus a job to return it to the unread list when it elapses, overriding the Developer recommendation to drop it for now.

### Recorded by

User, choosing "Build it" over the Developer recommendation to defer, 10 Oct 2026.

---

## Decision 223 — Build real push notification SEND (FCM/APNs)

**Date:** 10 Oct 2026 · **Status:** Approved by product owner
**Resolves:** the gap `DeviceToken`'s own header comment flagged ("deliberately NOT built this phase") and the Push delivery rate / Read-within-24h placeholder tiles Decision 126 catalogued.

Approved for build, a larger scope than the two metric tiles alone: real FCM (Android)/APNs (iOS) dispatch, not just the device-token registration that already exists. **Needs real Firebase Cloud Messaging and Apple Push Notification service credentials provisioned by the user** before this can be built. The delivery-rate and read-within-24h metrics (plus a new `readAt` column for the latter) follow once SEND is real.

### Recorded by

User, choosing "Build real push SEND now (FCM/APNs)" over the Developer recommendation to defer both metric tiles, 10 Oct 2026.

---

## Decision 224 — Dashboard discipline grouping ships against raw `Class.activities` strings

**Date:** 10 Oct 2026 · **Status:** Approved by product owner
**Resolves:** how the Bookings-This-Week drill-down's day×discipline grouping should work, given `Class.activities` is a free-text string array, not a canonical Discipline FK (the same unreconciled gap `skills/ultm8-domain-rules/SKILL.md` §4 and Decision 90 already flag).

Ship the Dashboard drill-down now, grouping by whatever strings are actually in `Class.activities`, with the known caveat that spelling/casing isn't guaranteed canonical — rather than waiting on the larger, separate Decision 90 Discipline-FK fix.

### Recorded by

User, choosing "Ship against raw strings now (recommended)", 10 Oct 2026.

---

## Decision 225 — Curriculum video upload/caption integration folds into the Curriculum redesign scoping

**Date:** 10 Oct 2026 · **Status:** Approved by product owner
**Resolves:** whether to provision Cloudflare Stream/AWS Transcribe credentials (picked, Decision 101) now as a standalone item.

Rather than wiring video upload/caption dispatch as a parallel, separate effort, it folds into the Curriculum learner-facing redesign scoping work (Decision 227) already approved — the video integration is one part of that larger design, not independent of it.

### Recorded by

User, choosing "Fold into the Curriculum scoping work (recommended)", 10 Oct 2026.

---

## Decision 226 — Tenant offboarding (16 entities): approved to scope, design in progress

**Date:** 10 Oct 2026 · **Status:** Approved to scope by product owner — **design not yet written, not built**
**Resolves:** whether Branches/Franchises' missing Delete action should be addressed narrowly or as the larger, project-wide tenant-offboarding gap it's actually part of (16 entities share this per the decision log's existing notes).

Approved to scope the full tenant-offboarding design now (cascade behavior, soft-delete vs. hard-delete, data-retention implications — this also touches Decision 110's still-pending Waiver-retention question), rather than a narrower one-off Delete for just Branch/Franchise that would leave an inconsistent pattern against the other 14 entities. This entry records the scope decision; the actual design is a separate, dedicated pass, not written here.

### Recorded by

User, choosing "Scope full tenant offboarding now" over the Developer recommendation to keep deferring, 10 Oct 2026.

---

## Decision 227 — Curriculum learner-facing redesign: approved to scope, design in progress

**Date:** 10 Oct 2026 · **Status:** Approved to scope by product owner — **design not yet written, not built**
**Resolves:** whether the three Curriculum mockups' proposed redesign (turning the already-shipped admin Lesson CRUD into a learner-facing video-library browse experience — Category, Favorite, Playlist, WatchHistory, Comment, all new entities) should be scoped now, deferred, or narrowed to just video playback.

Approved to scope the full redesign now, at the same Architect tier as Decisions 58/101/104, rather than deferring it or building only video playback first. Decision 225's video upload/caption integration folds into this scoping work rather than running separately. This entry records the scope decision; the actual entity/relationship design is a separate, dedicated pass, not written here.

### Recorded by

User, choosing "Scope it now" over the Developer recommendation to defer, 10 Oct 2026.

---

## Decision 228 — Create/Update Membership Plan rebuilt as a full-page wizard; currency becomes a confirmed dropdown; two bugs fixed

**Date:** 10 Oct 2026 · **Status:** Developer-level implementation of a direction the user picked after dedicated research (competitor review + a direct Spec 55 verification) and a follow-up re-answer (wizard over single scrollable view); flagged items below are for Architect confirmation, not decided here. Renumbered from this branch's original "Decision 209," which collided with Decision 209 above (assigned independently on `master` first).

**Resolves:** the user asked to rebuild the Create/Update Membership Plan flow (until now a single modal, `MembershipPlanFormModal.tsx`) "with the best logic, following the logic of our system," after researching how competitors (Kicksite, PushPress, Mindbody, Zen Planner) structure the equivalent flow, with any new backend-facing findings logged for the dev team.

1. **Container: a dedicated full page, not a modal** — first of its kind in this app; every other entity (Franchises, Disciplines, Students, Branches, Instructors, Membership Plans itself) still uses a List page + popover Modal. Chosen over an enhanced modal because this form (12 fields, several server-enforced cross-field rules) is the largest in the app, and both Kicksite and PushPress treat the equivalent flow as a dedicated builder, not a quick popover. New routes `/membership-plans/new` and `/membership-plans/:id/edit`, both rendering the new `MembershipPlanFormPage.tsx`. `MembershipPlanFormModal.tsx` is retired.
2. **A multi-step wizard, not one scrollable view** — the user re-answered the earlier form-flow question and picked a wizard (closer to how Kicksite/PushPress structure the equivalent flow) over this app's existing "one scrollable form" convention. The same 5 field groups (Basics / Pricing & Access / Policies / Disciplines & Lessons / Visibility) become 5 steps, shown one at a time, with a clickable pill row that jumps directly to any step — not strictly linear, so Edit doesn't require clicking Next four times to reach one field. No field logic, validation, or DTO mapping changed by this — only the container. Conditional step-mounting meant an unmounted step's native `required` no longer blocked submission the way it did when every field was always on screen, so `handleSubmit` gained two explicit guards (Title/Price) reproducing the same checks client-side.
3. **Type-conditional field visibility** (a client-side guardrail only, not a new server restriction): `classesIncluded`/`scopedClassId` now show only for Class Pack/Friend Pass, matching the domain rules' own description of scoping as a Class Pack/Friend Pass mechanism; `expiryDurationDays` hides for Subscription (Stripe-cycle-driven, no stored day-count applies). Selecting Friend Pass also auto-sets price to 0 in the UI, reflecting a rule the server already forces.
4. **Currency becomes a 6-option dropdown** (GBP/EUR/USD/BRL/AED/MYR), replacing the old free-text field — verified directly against the Spec 55 `.docx` itself ("6 currencies observed: GBP, EUR, USD, BRL, AED, MYR," §11.2), not just `skills/ultm8-domain-rules/SKILL.md`'s summary (which never listed the six). Defaults to the School's own `defaultCurrency` on Create when that matches one of the six.
5. **`refundFeeDate` null-clear bug fixed** — `MembershipsService.updatePlan()`'s `dto.refundFeeDate ? new Date(...) : undefined` treated an explicit `null` the same as an omitted field, silently swallowing a clear attempt (the same class of gap Class's own `bookingEndAt`/`qrAttendanceEndAt` still have, left alone — those are their own, separate, unfixed gap). `UpdateMembershipPlanDto.refundFeeDate` is now nullable (added to `NULLABLE_ON_UPDATE`), and the service ternary now distinguishes `undefined` (leave unchanged) from `null` (clear) from a real date string. Regression test added (`memberships.e2e-spec.ts`).
6. **`classesIncluded` now locks to 1 client-side the instant a Class is scoped** — found via manual UI verification and a stress test of the finished wizard (1,000 simulated students purchasing across plan types, plus a true-concurrency double-purchase race, run locally against this branch, never committed): picking a Class in "Scoped to Class" while "Classes included" still held an earlier value >1 reached Save and only then hit the server's existing, correct rejection (a one-off Class has only one occurrence) — the hint text already called this "capped," but nothing enforced it before Save. Now mirrors the existing Friend-Pass price-lock pattern.
7. **"Duplicate" closed client-side, no new endpoint** — a row action on the List page navigates to the Add page with the source plan's values as router state, pre-filling the form (title suffixed " (copy)"). This is the exact alternative `docs/v1.2-backend-backlog.md` had already named as acceptable when it logged the gap.
8. **Found, not resolved — flagged for the Architect** (see `docs/v1.2-backend-backlog.md`'s Membership Plans section for the full writeup): (a) what happens to an already-active Stripe Subscription when a School edits price/type on that plan — PushPress explicitly builds a migrate-vs-grandfather choice for this, our system has none; (b) a genuine contradiction between Spec 55 §6.1 ("Weekly Pass... governed by an expiry date instead of a recurring billing cycle") and this same DTO's own field description ("Not used by WEEKLY_PASS") — left showing the field for Weekly Pass (the safer default of the two) rather than silently picking a side; (c) a platform-wide rate-limiting finding, unrelated to this page: `apps/api/src/app.module.ts`'s second, `'identity'`-named `ThrottlerModule` throttler is hardcoded to 1000 requests/minute and, for any route without a custom per-identity `@Throttle` tracker (e.g. `MembershipsController.purchase()`), falls back to being IP-keyed like the default throttler — but unlike the default throttler, it is not controlled by `THROTTLE_IP_LIMIT_PER_MINUTE`. A genuine burst past 1000 req/min from one IP (automated test tooling, or many real students buying passes from one shared School WiFi) will still 429 past that point even after raising the documented env var. Not altered here — out of scope for this page, and changing cross-cutting rate-limit configuration isn't a call to make unilaterally.
9. **Not built, deliberately** — no late-cancellation-fee *collection* flow for `cancellationCharge` (that mechanism is `[UNRESOLVED]` domain territory per the skill, separate from the already-resolved refund/credit mechanism); the field is kept, stored, with explanatory copy saying so.

### Verified

Full stress test run locally (Postgres/Redis stood up in-sandbox, not part of this diff): 1,000 simulated Students purchasing across 4+ plan types (concurrency 50) — all succeeded or correctly pended with zero unexpected errors; a true-concurrency 100-Student double-purchase race against the general-access uniqueness constraint (`Membership_one_active_general_access_per_school`) produced the expected outcome in all 100 cases (0 double-successes); a DB-level invariant query confirmed zero Students ever held two simultaneous Active general-access Memberships; the Cash/Bank "confirm payment" half of the purchase lifecycle was separately exercised (20/20 confirmations succeeded, correctly creating linked Active Memberships). All test data and driver scripts were deleted afterward — nothing from the stress test itself is part of this branch's diff. `npx tsc -p tsconfig.json --noEmit` clean on `apps/school-portal`.

### Recorded by

Developer (this session), per the user's instruction to view the built pages, stress-test the flow, fix anything found, and merge once logic is verified.

---

## Decision 229 — A coach can have one pending invite per branch, not one in all

**Date:** 11 Oct 2026 · **Status:** Product-owner decision (Gus) · **Clarifies:** Decision 183 item 2 ("the invite link: one per person"), which the code had always applied per branch. Found in the Phase 7 decision review.

1. **One pending invite per School, branch and email.** A second invite to the same email for the same branch is refused until the first is accepted, cancelled or expires.
2. **The same person can have a pending invite at each branch.** A coach can work at several branches (Decisions 168, 169), and each branch is its own invite, so inviting them to a second branch is allowed. In a School with no branches, this means one pending invite per person.
3. Gus was asked whether to make it strictly one per person and said *"no"*, keeping it as built; the wording here replaces "one per person" in Decision 183.

No code change; covered by `coach-invites.e2e-spec.ts`.

**Note on the commit title:** this decision was merged as commit `94d32ca` (PR #176), whose title still reads "Decision 210", its number before it was renumbered to 229. That commit is this decision, not Decision 210 above.

---

## Decision 230 — Timetable↔Class relationship: rolling-window auto-generation reconfirmed

**Date:** 11 Oct 2026 · **Status:** Approved by product owner · **Completes:** Decision 210, which found this already built; this entry is the formal ratification of keeping the design and window as-is.
**Resolves:** the v1.1/v1.2 open-decisions review's own item 2, reached independently of Decision 210 (logged the day before, in a different session) and arriving at the same conclusion.

Reviewed again during the v1.1/v1.2 open-decisions pass: `ClassOccurrenceGenerationProcessor` materializes a dated `Class` row for every active `TimetableSlot` occurrence, 4 weeks ahead, via a daily job; a "book from Timetable" endpoint only needs to resolve slot+date to that already-existing row, never generate one synchronously. External precedent (GymMaster's "Repeats" scheduling, Mindbody's template/instance endpoint split) confirms this matches how comparable products shape the same relationship. The 4-week window is kept as-is, not widened — no change to Decision 210's design, just a second, independent confirmation of it.

### Recorded by

User, reconfirming Decision 210's conclusion during the v1.1/v1.2 open-decisions review, 11 Oct 2026.

---

## Decision 231 — Branch field-level settings screen: build it

**Date:** 11 Oct 2026 · **Status:** Approved by product owner
**Resolves:** Decision 76's left-open screen design ("only the sidebar nav item and empty frame ids exist in Figma"), and the backlog's four Branch mockup fields shown as display-only mirrors of Franchise's own with no column to persist to.

Approved to build a dedicated Branch settings screen, reachable from the existing sidebar item, replacing today's modal-only edit path. Scoped tightly to Decision 76's already-confirmed profile fields, plus four new columns needed to back fields already drawn in the Branch mockups: `description`, `activities`/`facilities`, `defaultLanguage`, `type`. Explicitly excludes School's operational-policy fields (cancellation policy, waitlist window, ranks toggle) and anything payment-related — `PaymentAccount` stays School-level, unchanged, per existing unreopened decision. A competitor-practice comparison (Toast, GymMaster, Glofox) confirmed ULTM8's existing Decision 76 split already matches the norm for what a chain-level vs. per-location settings screen covers.

### Recorded by

User, choosing "Build it," 11 Oct 2026.

---

## Decision 232 — Franchise transfer: billing data policy, plus the leave/switch-Franchise feature itself approved for build

**Date:** 11 Oct 2026 · **Status:** Approved by product owner
**Resolves:** the undesigned question of what happens to a School's `PaymentAccount`/`MembershipPlan`/`FranchiseFeeCharge` history on leaving one Franchise for another or going independent — previously moot since no leave/switch path exists yet (Decisions 97, 98).

**Policy:** `PaymentAccount` and `MembershipPlan` carry over completely unchanged — both are already School-owned with no franchise linkage to sever. `FranchiseFeeCharge` history is retained as an immutable record of charges already billed against the old Franchise. The one real reconciliation point is the live Stripe subscription (`School.stripeFranchiseFeeSubscriptionId`): cancel the old one at departure, create a new one lazily against the new Franchise, or leave it null if the School goes independent. Consistent in spirit with Decision 110 (preserve history rather than clear it on a relationship change), not in mechanism — Decision 110 governs full account closure; this is a continuing School.

**Additional scope approved:** the product owner also wants the actual leave/switch-Franchise feature built on top of this policy, not just the policy recorded — `joinFranchise()` is explicitly one-way today (409 if a School already has a Franchise), so this is new, unbuilt capability. **Not part of this session's Phase 2/3 execution** — tracked here as its own approved-but-unscheduled backlog item, to be picked up as a separate piece of work.

### Recorded by

User, approving the Developer recommendation on the billing policy, and additionally requesting the leave/switch feature be built, 11 Oct 2026.

---

## Decision 233 — Four unlabeled dashboard stats: dropped from the redesign

**Date:** 11 Oct 2026 · **Status:** Decided by product owner (dropped, not deferred)
**Resolves:** `skills/ultm8-domain-rules/SKILL.md` §12.2's long-standing `[UNRESOLVED]` note on the Student/Coach Profile screens' four unlabeled numeric stats (870 / 120k / 354k / 3.8Gb).

No screenshot, Figma link, or stated meaning for these four numbers exists anywhere in the repository — checked `docs/ultm8-blueprint.html`, `deep-review/grading-prototype/screenshots/`, and every image file directly. Rather than guess at their meaning or chase down a missing original design file, the product owner chose to drop these four stats from the redesign entirely.

### What this does NOT resolve

Revisit only if someone can locate the original design file or otherwise explain what these numbers were meant to show.

### Recorded by

User, choosing to drop them rather than pursue the missing design reference ("lets drop it for now"), 11 Oct 2026.

---

## Decision 234 — Late-cancellation fee collection: charge the Student's saved payment method, off-session

**Date:** 11 Oct 2026 · **Status:** Approved by product owner
**Resolves:** `skills/ultm8-domain-rules/SKILL.md` §7's `[UNRESOLVED]` note on whether `Class.cancellationCharge` (and `MembershipPlan`/`TimetableSlot`'s equivalent fields) is actually *collected*, as distinct from the already-built credit-forfeiture mechanism.

`cancelBooking()`'s existing past-cutoff branch already withholds credit restoration; this adds a sibling action, not a replacement — when `cancellationCharge` is non-null, fire a new off-session Stripe PaymentIntent against the Student's saved payment method. Requires extending the existing Stripe integration with an off-session charge capability it doesn't have today (today's charge path is on-session only). Matches the norm across comparable products (ClassPass, Vagaro, Zen Planner) of billing a real new charge for a late-cancellation fee, distinct from credit forfeiture.

### What this does NOT resolve

Failure handling for a declined card, SCA friction, or a removed payment method must be explicit, not silently retried — left to whoever builds this, not designed here. The existing chargeback-pattern-restriction job only partially backstops the customer-relations/chargeback risk a surprise off-session charge carries.

### Recorded by

User, approving the Developer recommendation, 11 Oct 2026.

---

## Decision 235 — No-camera check-in fallback: rotating 6-digit code derived from the same signed Class token

**Date:** 11 Oct 2026 · **Status:** Approved by product owner
**Resolves:** `skills/ultm8-domain-rules/SKILL.md` §7's `[UNRESOLVED]` note that the Instructor/Staff override endpoint was the only non-camera check-in path, sized for occasional accessibility use, not a standing per-class alternative.

Extends the existing `QrTokenService` to also derive a short, human-typeable 6-digit code from the same signed Class token, rotating in lockstep with the QR — no new secret store needed. The Class-QR display screen shows this code as text alongside the QR. A new self-service screen/endpoint lets a Student type the code instead of scanning; it runs the same booking lookup, cutoff check, and time-bucket verification as the QR path, completing through the same transition, tagged with a new check-in-method value for audit trails. **Mandatory server-side rate limiting on wrong code submissions** — 6 digits is brute-forceable in hours without it. Matches accessibility precedent (University of York's six-digit check-in alternative). Keeps `INSTRUCTOR_MANUAL` as the true occasional-use staff fallback, giving consent-withdrawn or accessibility-affected Students a standing, self-service, camera-free option instead.

### Recorded by

User, approving the Developer recommendation, 11 Oct 2026.

---

## Decision 236 — Guardian consent-management screen promoted to approved and built; BASELINE withdrawal gated by step-up re-authentication

**Date:** 11 Oct 2026 · **Status:** Approved by product owner, built — recorded retroactively; this entry was missed when #189 merged, and every "(Decision 9, ...)" citation that PR's code/docs left behind (none of which referred to a real numbered entry in this log) is corrected to cite this one.
**Resolves:** the v1.1/v1.2 open-decisions review's item 9 — `skills/ultm8-domain-rules/SKILL.md` §14's confirmed gap that no Guardian-facing screen exposed `ConsentRecord`'s already-built withdraw/grant behavior, and the separate gap that only the Owner tier had step-up MFA (Decision 12), leaving Guardian's irreversible, account-revoking BASELINE withdrawal behind nothing but the device's own biometric re-lock.

1. **The consent screen itself** (`apps/student/src/guardians/MinorConsentScreen.tsx`/`ConsentTierRow.tsx`) is promoted from "candidate UI, pending approval" (drafted 22 Sep 2026, per `docs/TRACK-B-ROADMAP.md`) to approved and prioritized ahead of ordinary v1.2 backlog — a real, confirmed legal-compliance gap (GDPR Art. 7(3)/8, COPPA's 22 Apr 2026 deadline), not a nice-to-have.
2. **Step-up re-authentication** is required before BASELINE consent withdrawal: the Guardian re-enters their own passcode (`POST /auth/step-up/verify`, a new generic `StepUpService` in `AuthModule`) and the resulting short-lived proof gates `GuardiansService.withdrawConsent()`'s BASELINE path. CAMERA withdrawal — reversible, no account impact — does not require it; a plain confirm stays proportionate.
3. **Not built here, flagged as a separate follow-up:** the same approval also named step-up for "any charge against a saved payment method" as a second consumer of this mechanism. `StepUpService` is deliberately generic/reusable so that follow-up doesn't need a second implementation, but it isn't scoped or built yet.

### Recorded by

User, approving the Developer recommendation (screen + step-up, prioritized ahead of backlog), 11 Oct 2026; this log entry itself written up after the fact, 11 Oct 2026, on discovering PR #189 shipped citing a decision number that was never actually recorded here.

---

## Decision 237 — Instructor "Add Manually": real record created immediately, system passcode emailed, forced change on first login — supersedes Decision 206/211

**Date:** 11 Oct 2026 · **Status:** Approved by product owner
**Resolves:** the v1.1/v1.2 open-decisions review's item 1 — how a manually-added Instructor gets a real login. **Supersedes Decision 206 (proposed design) and Decision 211 (10 Oct 2026, approved for build)**, which had independently settled on a different, incompatible mechanism — an account-claim email invitation, where no `User`/`RoleGrant`/`Instructor` row exists at all until the invited person clicks a link and completes full registration themselves. That design was approved one day before this review, in a separate session, without this exact question having been re-asked; the two could not both stand.

1. **"Add Manually" creates a real Instructor record outright — no invite/acceptance step.** Only **Name and Email** are required at creation. `Address`, `Activities` (distinct from `specializations`), `Certification` upload, and consent checkboxes (Decision 217's same four fields) are all real schema columns, left blank at creation and filled in by the Instructor themselves after their first login, via `PATCH /instructors/me/profile`.
2. **First-login credential goes by email** (already wired, no new cost) — a server-generated temp passcode, not an invite link. `User.phone`/`dateOfBirth` are made nullable to allow this (Decision 1/230's own schema migration); `User.mustChangePasscode` forces a passcode change before any ordinary session is issued (`POST /auth/passcode-change/first-login`), via a narrow, single-purpose token that can call no other endpoint.
3. **Why this over Decision 211's design:** the product owner, asked directly in this session ("we don't need to have all the required [fields] to create an account, we can make them fill the information once they have logged to their accounts"), wanted the record to exist immediately — Decision 211's design doesn't do that; it defers the record's entire existence to a claim step. This session's choice was confirmed as the better fit for that explicit requirement, at the acknowledged cost of a deliberate, one-time departure from this codebase's usual "never transmit the raw passcode" discipline (mitigated by the forced change, not an additional expiry).
4. **WhatsApp as a future notification channel** for the first-login credential was raised and deferred — a separate, later decision, not a blocker here.

### What this does NOT resolve

Whether `AccountInvitation` (Decision 206's entity, never built) should still exist for Staff's own identical from-zero-invite gap — out of scope here; this decision only resolves Instructor "Add Manually".

### Recorded by

User, choosing "System passcode + forced reset" over Decision 211's account-claim-invitation design when asked directly during Plan Mode, 11 Oct 2026.

---

## Decision 238 — Saved payment methods: a real capability built from scratch, as full infrastructure (not scoped to Decision 234 alone), via hosted Stripe Checkout rather than an embedded SDK

**Date:** 11 Oct 2026 · **Status:** Approved by product owner
**Resolves:** a real, previously-unknown gap discovered while scoping Decision 234's implementation — `PaymentsService.charge()`/`subscribe()`'s own existing header comments already documented "no `GET /payments/methods`, no saved-card reuse anywhere yet" as a deliberate Phase 9 simplification, but Decision 234's own text ("charge the Student's saved payment method, off-session") assumed that capability already existed. It didn't: no Stripe Customer/payment-method id was persisted anywhere in this schema before this decision.

**Scope chosen, with full cost disclosed up front:** two options were put to the product owner — (A) a minimal version scoped only to Students already on a Subscription-type Membership (reusing the Customer `subscribe()` already creates), or (B) a real, general saved-payment-method capability usable by any Student regardless of membership type. **The product owner chose (B).**

1. **New `StudentPaymentMethod` table** — `(studentId, schoolId)` unique, storing only a Stripe Customer id (never persisted card details; brand/last4 are fetched live from Stripe for display). Scoped per School, not globally per Student — a Stripe Customer lives inside exactly one connected account (Decision 86's Direct-charge model), so a card saved at one School's Customer can never be reused at another School's.
2. **Collection mechanism: a hosted Stripe Checkout Session (`mode: 'setup'`), not an embedded Stripe Elements/card-field integration.** `apps/student` (the Student/Guardian app) has no Stripe SDK dependency at all and is plain Expo-managed with no custom native dev client (Decision 113) — an embedded SDK needs native module linking this app's current build setup doesn't have, and this session's own environment cannot build or run a native RN dev client to verify one either way. The hosted Checkout URL is opened in the device's own browser (`expo-web-browser`, a pure-JS Expo module needing no native rebuild), which auto-returns to the app via its already-registered `ultm8-student://` scheme. Confirmation of a saved card is via the `checkout.session.completed` webhook, never a client-side success callback alone — the same discipline every other Stripe confirmation in this codebase already follows.
3. **New Stripe primitives** on `PaymentsService`: `createSetupSession()`, `getMyPaymentMethod()`, `deleteMyPaymentMethod()`, and `chargeOffSession()` (the actual off-session charge, Decision 234's own direct dependency) — closing the "off-session charge capability it doesn't have today" gap Decision 234's own text names.
4. **Decision 234 (late-cancellation fee) is built on top of this**, in the same phase: `BookingsService.cancelBooking()` attempts `chargeOffSession()` when a past-cutoff Class has `cancellationCharge` set, recording the outcome (`CHARGED`/`FAILED`/`NO_SAVED_PAYMENT_METHOD`) onto the Booking — never blocking the cancellation itself, which must succeed regardless of whether the fee can actually be collected.

### What this does NOT resolve

Decision 236's own separately-flagged follow-up — step-up re-authentication before reusing a saved payment method for a real charge (e.g. a Membership purchase) — is now technically buildable on top of this, but is not built here; it remains its own tracked, separate piece of work.

### Recorded by

User, choosing option (B) — full saved-payment-method infrastructure, not the minimal Subscription-only version — after being given an explicit time/pros-and-cons comparison of both, 11 Oct 2026.

---

## Decision 239 — Decision 236's own follow-up, built: step-up gates a new "pay with saved card" purchase path, not just the one pre-existing automatic charge

**Date:** 11 Oct 2026 · **Status:** Approved by product owner, built
**Resolves:** Decision 236's own named follow-up — "step-up re-authentication before reusing a saved payment method for a real charge (e.g. a Membership purchase)" — and the matching line in `skills/ultm8-domain-rules/SKILL.md` §14/§18.

Scoping this turned up a real, previously-unflagged gap: before this decision, **nothing in this codebase let a Student actively choose to pay for anything by reusing their saved card.** `MembershipsService.purchase()`'s Stripe-paid branches always collected a fresh card (`PaymentsService.charge()`/`subscribe()`); the only consumer of `chargeOffSession()` (Decision 238's saved-card charge primitive) was the automatic, system-initiated late-cancellation fee (Decision 234), which has no interactive moment to prompt a passcode. So "step-up before reusing a saved card" had nothing to gate — closing the gap meant building the reuse-purchase path itself first, which the user was asked to scope explicitly (three options given: build the full purchase path + step-up; skip for now, leave flagged open; or build the step-up plumbing alone with nothing behind it). **The user chose the first.**

1. **`PurchaseMembershipDto` gains `payWithSavedCard`** — self-purchase only, scoped to CLASS_PACK/WEEKLY_PASS/TRIAL_MEMBERSHIP (one-time Stripe-paid plans). Explicitly rejected (400, before any step-up check or Stripe call) for: a Guardian-driven purchase (the saved-payment-method endpoints are self-only — a linked minor, who never logs in, can never have one to reuse), a SUBSCRIPTION plan (`PaymentsService.subscribe()`'s own pre-existing limitation — a throwaway Stripe Customer every call, never wired to `StudentPaymentMethod` — is a separate piece of work, not fixed here), and a Cash/Bank-provider School.
2. **Step-up re-authentication gates it** — the same generic `StepUpService` Decision 236 built, same `X-Step-Up-Token` header mechanism, checked before any Stripe call is made.
3. **The charge is synchronous**, unlike the fresh-card path: `chargeOffSession()` already confirms the PaymentIntent (`off_session: true, confirm: true`) and returns a known success/failure immediately — no client-side Stripe Elements confirmation step, no webhook wait. `MembershipsService.purchaseWithSavedCard()` records the Transaction and creates the Membership directly.
4. **A genuinely new correctness risk, closed, not left open:** the existing two-simultaneous-Active-general-access-Membership race (already guarded by a partial unique index) can now be lost *after* real money has already moved — `chargeOffSession()` runs before any DB write (same "an external Stripe call has no place holding a DB transaction open" discipline this codebase enforces everywhere else), so a rollback on collision cannot undo the charge the way the async webhook path's own `resolveMembershipCollision` does. Closed with an explicit, synchronous refund (`PaymentsService.refundOffSessionCharge()`) in that one case, rather than left as a flagged gap — this is new money-movement code, not a narrow pre-existing limitation being extended.
5. **Frontend (`apps/student`):** `MembershipPlanRow` offers "Pay with saved card" alongside "Purchase" whenever the Student has a saved card for that School and the plan qualifies, using the same `StepUpPrompt` component Decision 236's Guardian consent-withdrawal screen already built. This is, incidentally, the first real Stripe-money-moving purchase UI actually wired up end-to-end in `apps/student` — the fresh-card path (`requires_payment` outcome) remains unbuilt (Slice 4b, needs a Stripe Elements SDK this app doesn't have), but this one needs no client-side payment SDK at all, since the server already knows the outcome synchronously.

### What this does NOT resolve

Fixing `PaymentsService.subscribe()`'s own pre-existing "throwaway Customer every call" limitation, which blocks saved-card reuse for SUBSCRIPTION plans — flagged, not solved here, same as `PurchaseMembershipDto`'s own comment on it. Guardian-driven saved-card reuse for a linked minor — would need a design decision on whose card that even means, not built or scoped here.

### Recorded by

User, choosing to build the full purchase path (not skip, not plumbing-only) after being told explicitly that nothing existed yet for step-up to gate, 11 Oct 2026.

---

## Decision 240 — Every mobile-number field gets a real country-picker `PhoneField`, via `libphonenumber-js`'s "min" metadata — a pure input-UX upgrade, no DTO/backend change

**Date:** 12 Oct 2026 · **Status:** Approved by product owner, built
**Resolves:** every phone/mobile-number field in both `apps/school-portal` and `apps/student` was plain free text, with no country-code picker and no client-side validation — relying on the user to type a correctly-formed E.164 string by hand. For `RegisterScreen`/`RegisterPage`'s `phone` specifically, that field determines whether OTP/SMS delivery works at all for an international user. The product owner asked explicitly for "the best and most accurate" approach, worldwide — not a curated subset of launch markets.

1. **Library: `libphonenumber-js`, "min" metadata build** (`import … from 'libphonenumber-js'`, which this version's own package re-exports as an alias of `/min` — confirmed by diffing the two entry files before picking one, not assumed). The alternative `/mobile` build (complete metadata, mobile-numbers-only, stricter `isValid()`) was considered and rejected: this one `PhoneField` is reused for both login/OTP mobile numbers **and** School/Franchise/Branch business contact numbers, which aren't confirmed to always be mobile lines — `/mobile`'s stricter validation risked flagging a genuine landline contact number as invalid. `/min` is also the package's own documented default.
2. **Two parallel implementations, same logic, no shared runtime dependency across the web/native boundary:** `packages/ui/src/components.tsx` exports a web `PhoneField` (a searchable country-flag/dial-code combobox, composing to E.164 via `AsYouType`), and `apps/student/src/components/ui.tsx` (that app's one `components/ui` file — not a directory) exports an RN equivalent, country picker as a `Modal`+`FlatList` (no new Picker dependency). Both embed an identical, frozen `[ISO code, English name, calling code]` array for every country `libphonenumber-js`'s "min" metadata supports (245 entries, generated once via `getCountries()` + Node's `Intl.DisplayNames`) rather than computing country names at runtime — `Intl.DisplayNames` isn't guaranteed on every Hermes build.
3. **Always emits a plain E.164 string** (`"+15551234567"`, or `''` until a country is chosen and a digit typed) — confirmed against every DTO that already validates a `phone`/`mobileNumber`/`contactPhone` field server-side (`RegisterDto`, `CreateInstructorDto`/`UpdateInstructorDto`, `LookupInviteCandidateQueryDto` all already use `@IsPhoneNumber` → E.164 only; `CreateSchoolDto`/`CreateFranchiseDto`/`CreateBranchDto` and their `Update*` variants validate `mobileNumber`/`contactPhone` as plain free text, so a stricter E.164 input only tightens what reaches them, never conflicts). **No DTO or backend change anywhere.**
4. **Default country: the caller's own best locale guess, never a hardcoded single country** — browser `navigator.language`/`navigator.languages` on the web, device locale via `Intl.DateTimeFormat().resolvedOptions().locale` on `apps/student` (no new `expo-localization` dependency — Hermes's own bundled ICU already resolves this against the real device locale). Falls back to no pre-selected country (forcing an explicit choice) when no usable region subtag is found, rather than guessing wrong.
5. **Fields converted:** `apps/student` — `RegisterScreen`, `ForgotPasscodeScreen`, `VerifyOtpScreen`, `ResetPasscodeScreen`. `apps/school-portal` — `RegisterPage`/`ForgotPasscodePage`/`ResetPasscodePage`/`VerifyOtpPage` (the mirrored Staff-side auth flow), `CreateSchoolPage`/`SchoolPage` (`mobileNumber`), `FranchiseFormModal` (`mobileNumber`), `BranchFormModal` **and** `BranchSettingsPage` (`contactPhone` — Decision 231 moved Branch *editing* to a dedicated settings page that `BranchFormModal` no longer serves, found by re-checking `BranchesPage`'s own routing rather than trusting the original field list), `InstructorFormModal` (`phone`), and `StaffPage`'s invite-candidate lookup (`phone` — an *existing* user's phone, looked up by exact E.164 match; not in the original field list, found by re-grepping after the listed fields were done).
6. **Deliberately left alone:** `apps/student`'s `ProfileScreen` shows `phone` read-only (`UpdateUserDto` deliberately excludes both `email` and `phone` — login/OTP identifiers, not a bare profile edit, per that DTO's own header comment) — confirmed against the DTO before leaving it, not assumed from the screen's own comment alone. `CompleteInstructorProfilePage`/`CreateInstructorManuallyDto` collect no phone at all (by design, per that DTO's own header comment) — nothing to convert.
7. **Not a login-identifier format change for any existing user:** `apps/student`/`apps/school-portal` login is by **email** + 6-digit passcode (Decision 72), never by phone — confirmed directly in `LoginScreen`/`LoginPage` before treating this as safe. Phone is used only for OTP delivery (registration, forgot-passcode) and the Staff-invite lookup, so this upgrade cannot break anyone's ability to log in.

### What this does NOT resolve

No existing Playwright spec in `apps/school-portal/e2e` exercised any of the converted phone/mobile fields before this change (re-verified by grep across every spec file) — so none needed updating to keep passing, but none gained new coverage either. Net-new e2e coverage for these fields (across 9+ forms, several needing a real OTP/SMS round trip this test environment has no provider for) is flagged as a follow-up, not built here.

### Recorded by

User ("the best and most accurate... this needs to be genuinely accurate internationally, not a curated subset of launch markets"), approving `libphonenumber-js` directly, 12 Oct 2026.

---

## Decision 241 — Currency list expanded from the old hardcoded 6 to every currency Stripe supports (~135/139 ISO 4217 codes)

**Date:** 12 Oct 2026 · **Status:** Approved by product owner, built
**Resolves:** Spec 55 §11.2's own "6 currencies observed" line (GBP, EUR, USD, BRL, AED, MYR), carried forward into `apps/api/src/settings/constants/currencies.ts`'s canonical `CURRENCIES` list and `skills/ultm8-domain-rules/SKILL.md` §1 — never actually confirmed as a deliberate ceiling, just the sample set the Figma designs happened to show. Every payment in this product already routes through Stripe (Decision 86's Direct-charge model, and no other payment rail exists or is planned), so the product owner was told explicitly that Stripe's own supported-currency set is the practical ceiling, and approved building to that instead of the sample-6.

1. **Canonical list:** `apps/api/src/settings/constants/currencies.ts`'s `CURRENCIES` constant now holds 139 fiat ISO 4217 codes (BTC, which Stripe also lists as a settlement currency, excluded — out of this task's fiat/ISO-4217 scope). Same `{code, name}` shape as the old 6-entry list, so no DTO or API-client shape change was needed — only this constant and the frontend pickers that render from `GET /settings/currencies`.
2. **Sourcing, disclosed:** `docs.stripe.com`/`support.stripe.com` were unreachable from this session's sandboxed network (DNS failure on every stripe.com-family host), and the `stripe` npm package (apps/api's own dependency) does not bundle a currency list — its Node SDK types `currency` as a plain `string`, not an enum. The list was instead retrieved from a public, open-source mirror reachable via `raw.githubusercontent.com` — WooCommerce's `woocommerce-gateway-stripe` plugin's `WC_Stripe_Currency_Code` class, whose own header comment cites `https://docs.stripe.com/currencies` as its source, cross-checked against that same file's separately maintained Stripe-documented zero-decimal/three-decimal currency lists. Flagged for the Architect to re-verify directly against Stripe's own docs if/when this environment can reach them.
3. **No `@IsIn`/enum validation existed on any `currency`/`defaultCurrency`/`currencyOverride` DTO field before this** (re-verified by grep across every School/Branch/Franchise/MembershipPlan/User DTO) — every one was already plain free-text `@IsString()`/`@MaxLength()`. So this change needed no backend validation-decorator change; only the canonical list + Swagger description text ("one of the 6 confirmed currencies" → "an ISO 4217 code from the Stripe-supported currency list, ~135 currencies") on `CreateSchoolDto`/`UpdateSchoolDto`/`CreateFranchiseDto`/`UpdateFranchiseDto`/`UpdateUserDto`.
4. **Frontend pickers, web (`packages/ui`):** a new `CurrencyField` searchable combobox, same ARIA-1.2 editable-combobox pattern and popover mechanics as Decision 240's `TimezoneField` (which solved the identical "long list needs search" problem for IANA zones) — but taking `options` as a prop instead of owning a static list, since the currency list comes from `GET /settings/currencies`, not a runtime `Intl` API. Replaces the plain `<select>` on `CreateSchoolPage`/`SchoolPage`/`FranchiseFormModal`/`BranchFormModal`/`BranchSettingsPage`, all of which already fetched the real list via `useCurrencies()`. `MembershipPlanFormPage` is the one exception found: it had its own independent, hardcoded 6-entry `CURRENCIES` array that never called `GET /settings/currencies` at all — a pre-existing staleness bug, not just a count bump — now wired to the same `useCurrencies()` hook as every other form.
5. **Frontend picker, mobile (`apps/student`):** a new `SearchablePickerField` (Modal + search `TextInput` + `FlatList`, same pattern `PhoneField`'s own country picker already used for its 245-country list) replaces `ProfileScreen`'s Currency `ChipPicker` — a chip row at ~135 entries would wrap into an unusable wall of buttons. Language stays a `ChipPicker` (still only 4 entries).
6. **Tests:** `apps/api/test/settings.e2e-spec.ts`'s `GET /settings/currencies` assertion (previously pinned to exactly the old 6 codes) now asserts shape (3-letter codes, no duplicates, non-empty names) and that the full set — including the previous 6 — is present, rather than an exact count, so a legitimate future addition/removal doesn't need the test rewritten again.

### What this does NOT resolve

Whether `School.defaultCurrency`/`Branch.currencyOverride`/`User.currency`/`MembershipPlan.currency` should ever become a real validated enum instead of free text (several existing code comments already flag this as an open gap, predating this decision) — not changed here; this decision only expands which values the *picker* offers, not the field's underlying validation.

### Recorded by

User, after being told explicitly that Stripe's own supported-currency set is the practical ceiling since every payment routes through Stripe, 12 Oct 2026.

---

## Decision 242 — Notifications page: Broadcast/compose, Snooze, and the Read-within-24h metric, all three built as scoped

**Date:** 12 Oct 2026 · **Status:** Approved by product owner, built
**Resolves:** `docs/v1.2-backend-backlog.md`'s "Notifications page" section flagged three gaps against this module's real, narrow API surface (`GET /notifications/me`, `PATCH /notifications/:id/read`, `GET /notifications/me/counts`) — no endpoint for Staff to author a Notification, no snoozed/deferred state anywhere in the schema, and no timestamped read event to compute a time-to-read metric from. The product owner was given explicit trade-offs for each and approved all three as scoped below — nothing more (Delete and Push delivery rate, both shown on the same concept mockups, remain the backlog's own open items).

1. **Broadcast/compose** — `POST /schools/:schoolId/notifications/broadcast`, School-Owner-gated same as Waiver/MembershipPlan CRUD. Three audience scopes: **All Students** (default), **one Branch** (via the real `StudentHomeBranch` model, Decisions 139/148 — intersected with an active `STUDENT` RoleGrant, since a home-Branch row can outlive the enrollment that created it), and **one Class's real roster** (every Booking against that Class, any status — the same shape `BookingsService.findAllForClass` already uses, deliberately not re-derived). Enqueues through the existing `notification-fanout` queue only, reusing `WaiverSignatureRequestsProcessor`'s own per-recipient job-dedup pattern (`notificationId`/`jobId` derived from one `broadcastId` + each recipient). Lives in its own module (`NotificationBroadcastModule`), not inside `NotificationsModule` — `NotificationsModule` is already imported BY `TenantsModule` (for `NotificationDeliveryService`), so importing `TenantsModule` back into it for `TenantAuthorizationService`/`SchoolsService` would be a genuine circular module dependency with no `forwardRef` precedent anywhere in this codebase; a separate module importing `TenantsModule` + `QueueModule`, imported by nothing, avoids that entirely.
2. **Snooze** — new `Notification.snoozedUntil DateTime?` column; `PATCH /notifications/:id/snooze` takes either an explicit `until` timestamp or a `minutes` duration (a Developer-level presentation choice, not a business rule — the backlog's own note flagged needing *a* decision on shape, not a specific one). `GET /notifications/me/counts`'s `unread` total live-excludes a currently-snoozed Notification (`snoozedUntil` in the future) — computed the same "don't wait on a sweep job for correctness" way `Membership.status`'s own live-computed expiry already works in this codebase. A new scheduled `notification-unsnooze-sweep` job (same registration/retry shape as `booking-no-show-processing`) separately clears an elapsed `snoozedUntil` in storage, so the column itself doesn't keep claiming "still snoozed" long after the live computation already disagrees.
3. **Read within 24h** — new `Notification.readAt DateTime?` column, set the first time `PATCH /notifications/:id/read` fires and never overwritten after (`NotificationsService.markRead`). `GET /notifications/me/counts` gains `readWithin24hPercent` (null until the caller has read at least one Notification — an unread Notification is excluded from both the numerator and denominator, never counted as a miss), plus `readWithin24hCount`/`readTotalCount` for transparency.
4. **Frontend (`apps/school-portal`):** `NotificationsPage.tsx`'s row action menu is now a real `RowActionsMenu` (replacing the old always-visible "Mark read" `Button`) with working Mark read + Snooze items and a new "Snoozed" status badge; a School-Owner-only "Broadcast to Students" header action opens `BroadcastNotificationModal.tsx`; the stats ribbon gains a third "Read within 24h" tile alongside Total/Unread.

### What this does NOT resolve

Delete (`DELETE /notifications/:id`) and Push delivery rate — both shown on the same concept mockups this backlog entry references — were explicitly out of scope for tonight's approval and remain open, per the backlog doc's own updated entry.

### Recorded by

User, after being given explicit trade-offs for each of the three features, 12 Oct 2026.

---

## Decision 243 — Track B Slice 4b (fresh-card membership purchase): a hosted Stripe Checkout Session (`mode: 'payment'`), not a native PaymentSheet dev client — extends Decision 238's `mode: 'setup'` pattern

**Date:** 12 Oct 2026 · **Status:** Approved by product owner, built
**Resolves:** `docs/TRACK-B-ROADMAP.md`'s Slice 4b — `MembershipsService.purchase()`'s fresh-card Stripe path returns `{ outcome: 'requires_payment', clientSecret, transactionId }`, a PaymentIntent client secret meant for Stripe Elements/PaymentSheet confirmation. `apps/student` is plain Expo-managed with no custom native dev client (Decision 113) and has no Stripe native SDK dependency at all (Decision 238's own header comment), so that outcome has been a dead end from this app since Slice 4a shipped — shown honestly as "online payment isn't available in the app yet" rather than built against a guess.

**Real precedent already existed in this exact codebase for exactly this situation**: Decision 238 built a hosted Stripe Checkout Session (`mode: 'setup'`) for saving a card — opened in the device's browser via `expo-web-browser`, confirmed via the `checkout.session.completed` webhook, no native SDK needed at all. The product owner approved extending this same pattern to a one-time fresh-card purchase, instead of adopting `@stripe/stripe-react-native`'s PaymentSheet and the native-dev-client workflow change the roadmap's own Slice 4b research had flagged as the real open decision.

1. **New `PaymentsService.createPurchaseCheckoutSession()`** — a Checkout Session in `mode: 'payment'` (not `'setup'`), with an inline `price_data`/`product_data` line item for the plan's exact amount/currency/title (same simplification `charge()`/`subscribe()` already use — no persisted MembershipPlan↔Stripe Product mapping). Same hosted-browser, same `ultm8-student://` auto-return scheme as Decision 238, different success/cancel paths (`membership-purchase/complete`/`cancel`).
2. **Deliberately reuses the EXISTING `payment_intent.succeeded` webhook handler** (`StripeWebhookProcessingProcessor.handlePaymentIntentSucceeded`) as the completion signal — **no change to `stripe-webhook-processing.processor.ts` at all.** Verified directly against the installed Stripe SDK's own type definitions before relying on this: a `mode: 'payment'` Checkout Session creates its underlying PaymentIntent SYNCHRONOUSLY at Session-creation time (`Session.payment_intent` is a real, expandable field the instant `sessions.create()` returns — the identical shape `subscribe()`'s own `expand: ['latest_invoice.payment_intent']` already relies on). `createPurchaseCheckoutSession()` expands and returns that PaymentIntent id, and `MembershipsService`'s new `purchaseViaHostedCheckout()` stashes it on the Transaction at creation time — exactly the shape the pre-existing `charge()`/`requires_payment` branch already produces. Once the Student completes payment on the hosted page, Stripe fires `payment_intent.succeeded` for that same PaymentIntent, already matched, collision-resolved (the two-simultaneous-Active-Membership race), and turned into a Membership by the handler that already exists.
3. **Deliberately NOT a new `checkout.session.completed` branch for `mode: 'payment'`**, despite that being the shape Decision 238's own `mode: 'setup'` flow needed: Stripe fires BOTH `checkout.session.completed` and `payment_intent.succeeded` for a successful card Checkout, and building a second Membership-creation path keyed off the Session would duplicate `handlePaymentIntentSucceeded`'s own logic for no benefit, while opening a real risk of the two deliveries racing each other — a second source of truth, not a safer one. A Setup Intent (Decision 238's own case) has no Transaction/Membership of its own to settle, which is why that flow genuinely needed the Session-completion event and this one doesn't.
4. **`PurchaseMembershipDto.useHostedCheckout`** — scoped identically to Decision 236's `payWithSavedCard` (CLASS_PACK/WEEKLY_PASS/TRIAL_MEMBERSHIP only; SUBSCRIPTION and a Cash/Bank-provider School both rejected 400, before any Stripe call), mutually exclusive with `payWithSavedCard`. Unlike `payWithSavedCard`, **not** rejected for a Guardian-driven purchase — the hosted Checkout page opens in whoever is calling the endpoint's own browser session (the Guardian's, in practice), the same "completes it in their own app session" shape the SUBSCRIPTION/fresh-card branches already rely on; no saved-payment-method lookup is involved, so `payWithSavedCard`'s self-only restriction doesn't apply.
5. **Response gains a new outcome**, `requires_checkout`, with `checkoutUrl` (alongside the existing `clientSecret` for `requires_payment`) — a natural sibling to `requires_payment`/`pending_confirmation`/`active`, not a bolted-on parallel field.
6. **`apps/student`'s `MembershipPlanRow`**: "Purchase" now always sends `useHostedCheckout: true` (this app has no other way to complete a Stripe-paid purchase), and on `requires_checkout` opens `checkoutUrl` via the exact same `WebBrowser.openAuthSessionAsync` call Decision 238's card-saving flow already uses, same `ultm8-student://` scheme. Mirrors that same screen's own documented choice exactly: one refetch (here, invalidating the My Memberships query cache via a new `useInvalidateMyMemberships()` hook) right after the browser session ends, accepting a brief staleness window — the real confirmation is the async webhook — rather than an infinite poll/retry loop. A SUBSCRIPTION plan still returns `requires_payment` (unchanged, still a dead end in this app) — `PaymentsService.subscribe()`'s own pre-existing "throwaway Customer every call" limitation, same scope boundary `payWithSavedCard` already respects, not fixed here.

### What this does NOT resolve

Same two items Decision 239 already flagged, untouched by this decision: `PaymentsService.subscribe()`'s "throwaway Customer every call" limitation (blocks a hosted-Checkout or saved-card path for SUBSCRIPTION plans alike), and Guardian-driven saved-card reuse for a linked minor (a design question about whose card that even means). Also unresolved: `AcademyMembershipPlanDto`'s own pre-existing lack of a `requiresOnlinePayment`/provider signal (Slice 4a's own flagged follow-up) — a tap on "Purchase" for ANY Stripe-backed plan still runs the real server-side `purchase()` branch and creates a live Checkout Session before the client can pre-filter; this was already true for `requires_payment` and remains true for `requires_checkout`, not worsened or improved by this decision.

### Recorded by

User, approving the extension of Decision 238's hosted-Checkout pattern to a one-time purchase instead of adopting a native PaymentSheet dev client, 12 Oct 2026.

---

## Decision 244 — Notifications keep no hard-delete; every Notification stays a permanent record

**Date:** 12 Oct 2026 · **Status:** Confirmed by product owner
**Resolves:** whether `DELETE /notifications/:id` should exist — flagged as explicitly out of scope by Decision 242's own "What this does NOT resolve" note, and shown disabled-styled on the Notifications concept mockups this whole redesign has been building against.

No delete endpoint is built. A Notification behaves the same way a Waiver signature or a Transaction already does in this codebase — a permanent, append-only record of something that happened, never user-deletable. Snooze (Decision 222) already covers "get this out of my unread list without destroying it," which was the actual user-facing need the mockup's disabled Delete button was gesturing at. No code change — this decision closes the open question against the already-shipped, delete-free behavior.

### Recorded by

User, choosing "Keep as permanent record, no delete" over adding a real `DELETE /notifications/:id`, 12 Oct 2026.

---

## Decision 245 — GDPR/LGPD data residency and per-user erasure: scoped as a technical design exercise, not yet built, not legal advice

**Date:** 12 Oct 2026 · **Status:** Scoped by product owner request — **design only, nothing built, requires legal review before any of this is implemented**
**Resolves:** the systemic tracking gap `docs/ULTM8-MASTER-ROADMAP.md` has carried since Decision 110 explicitly excluded it ("An individual Student/User's 'erase my personal data' request is a different legal mechanism... a different trigger... a different technical shape") — this entry gives that gap its own first design pass, at the product owner's explicit request, with the explicit caveat that none of the below is legal advice and real counsel must review the actual retention-period and residency requirements before this is built against any real EU/Brazil user.

**This decision records technical design OPTIONS, not a chosen implementation** — nothing here authorizes building any of it yet.

1. **Per-user erasure (GDPR Art. 17 / LGPD Art. 18, right to erasure).** Two real technical shapes exist in this codebase's own precedent:
   - **Anonymize-in-place** (same shape Decision 110 already uses for School/Franchise soft-archive, extended to a single `User` row): null out `firstName`/`surname`/`email`/`phone`/`dateOfBirth`/`passcodeHash`/any R2-stored photo, replace with a stable placeholder (`"Erased User"` + a retained internal id for FK integrity), but leave `Transaction`/`WaiverSignature`/`Booking`/`StudentRank` rows intact and still linked — satisfies "erase personal data" while preserving the financial/legal/audit trail every one of those tables already exists to protect (payment records, signed legal documents, grading history). This is the standard approach SaaS platforms with billing/legal-record obligations use, since GDPR Art. 17(3)(b)/(e) and LGPD Art. 16 both carve out exceptions for legal/contractual retention obligations — exactly the carve-out a real lawyer needs to confirm applies to each specific row type here.
   - **Hard-delete the User row and cascade:** simpler to reason about, but breaks referential integrity on every table above (a Transaction with no User would be a corrupted financial record, not a compliant one) — not recommended without first building a parallel "erasure log" that is itself a financial/legal record outliving the erased User, which is more engineering, not less.
   - **Recommendation if/when this gets built:** anonymize-in-place, gated behind a new Platform-Admin-mediated action (same authorization tier as Decision 110's close-account action), with its own confirmation step and an audit row recording who erased whom and when (the erasure log itself is the one thing that must NOT be erasable).
2. **Data residency.** Spec 55 §11.6 already commits to AWS (RDS/ElastiCache/Fargate) as the confirmed infra target, but no region has ever been chosen in any decision-log entry — `infra/terraform/` has no region-pinning today. Two shapes: a single-region deployment (simplest, but may not satisfy an EU customer's residency requirement) vs. a region-per-tenant-market architecture (Franchise or School carries a `dataRegion` field, provisioning routes to the matching AWS region's database) — the second is a substantial infra/deployment redesign, not a schema tweak, and should not be started speculatively before a real customer contract requires it.
3. **What this does NOT resolve:** which specific markets/customers actually require either of these (that's a sales/legal question, not an engineering one), the actual retention periods required by GDPR/LGPD for financial records in this specific business (payment processors and most jurisdictions require 5-7 years minimum for transaction records — a lawyer must confirm the real number, not this document), and whether `Waiver`'s own still-pending retention period (Decision 110's one remaining open piece) should be decided together with this or separately.

### Recorded by

User, choosing "Scope it as a technical design exercise" over deferring entirely or holding for legal counsel first, 12 Oct 2026.

---

## Decision 246 — Student Measurements built: three real nullable `String` fields on `User`, free text, wired into both existing profile-edit surfaces

**Date:** 12 Oct 2026 · **Status:** Approved by product owner, built
**Resolves:** Decision 220's own "implementation's call which [model]" — the model/shape choice Decision 220 deliberately left open when approving Student Detail's Measurements fields (Weight Category, Kimono Size, Belt Size) for build.

1. **Model placement: `User`, not `StudentRank`.** `weightCategory`, `kimonoSize`, `beltSize` — three new nullable `String?` columns, camelCase matching every other `User` field's convention. Person-level physical attributes that don't vary by Discipline, so `User` (ULTM8's shared base identity) is the right home; `StudentRank` is per-Student-per-Discipline grading data and would be the wrong home — a Student's kimono size doesn't change between their Judo and Karate enrollments.
2. **Shape: free-text `String?`, not an enum or a typed unit.** Nothing in Spec 55, `skills/ultm8-domain-rules/SKILL.md`, or this schema grounds any enum, unit system, or canonical code list for any of the three — exactly the gap `docs/v1.2-backend-backlog.md` had flagged (Fully Proposed). Free text is a developer-level presentation choice, not an invented business rule, same convention already used elsewhere in this codebase for an ungrounded field shape (e.g. Decision 222's Snooze shape) and the same shape this model's own existing `gender`/`nationality`/`language`/`currency` columns already use for the identical reason. `@MaxLength(50)` on all three — a reasonable bound, not a confirmed limit.
3. **Both existing Student profile-edit surfaces wired, via the SAME change.** `UpdateUserDto` gains all three fields (`@IsOptional() @IsString() @MaxLength(50)`), and `UserResponseDto` gains them as the read side. Because `UpdateStudentProfileDto` (the Staff-on-behalf-of-a-Student DTO, `PATCH /schools/:id/students/:studentId/profile`) already `extends UpdateUserDto` outright, and both that endpoint and the Student's own self-service `PATCH /users/me` already share `UsersService.updateProfileFor()`, adding the three fields to `UpdateUserDto` once wires BOTH surfaces — no second DTO, no second service method, no drift risk between them. This is the same reasoning `UpdateStudentProfileDto`'s own header comment already gives for reusing `UpdateUserDto` wholesale instead of hand-copying a field list.
4. **Frontend:** `StudentUpdatePage.tsx` (`apps/school-portal`, Staff-on-behalf-of) and `ProfileScreen.tsx` (`apps/student`, the Student's own self-service profile editor) both gain the three fields as plain text inputs. Wiring the self-service surface too (not just the Staff one) was a judgment call, not mandated by Decision 220's wording — made because a Student editing their own kimono/belt size on their own profile is a practical, everyday edit, no different in kind from the gender/nationality/address fields that screen already lets them change themselves.
5. **Migration** `20261112000000_student_measurements` — three nullable `TEXT` columns added to `"User"`, no GRANT/RLS change needed (a table-level grant already covers `User`; adding nullable columns needs no new grant, same reasoning `20261107000000_branch_settings_fields` already gives for the same situation on `Branch`).
6. **`packages/api-client` regenerated** from the live OpenAPI export. New e2e coverage added to `users.e2e-spec.ts` (self-service) and `student-profile-update.e2e-spec.ts` (Staff-on-behalf-of): each field round-trips set → read back → cleared with an explicit `null`, a `@MaxLength(50)` rejection case, and an explicit check that cross-tenant isolation is unaffected (plain `User` columns under the existing RLS policies — no new cross-tenant surface).
7. **`docs/v1.2-backend-backlog.md`'s Measurements entry** updated from "Fully Proposed" to DONE, dated.

### Recorded by

Developer, exercising the "implementation's call" latitude Decision 220 explicitly granted for the model/shape choice; the choice disclosed here (free text on `User`, both edit surfaces wired) rather than made silently, per this project's own "flag an ungrounded gap, don't fill it silently" rule, 12 Oct 2026.

## Decision 247 — White-label app distribution: one shared app, School selected after install — not a per-tenant App Store listing

**Date:** 12 Oct 2026 · **Status:** Approved by product owner — architecture decided, nothing built yet
**Resolves:** the Apple 4.2.6 ("Minimum Functionality")/4.3 ("Spam") template-farm compliance risk that has blocked `MobileAppPublishingModule`/`packages/build-pipeline`, Track B Phase 9, and `SubscriptionPlansModule`'s deferred `whiteLabelApp` entitlement since it was first flagged in `docs/ULTM8-MASTER-ROADMAP.md`. Apple's policy explicitly targets exactly the pattern `skills/ultm8-app-publishing/SKILL.md` had assumed — many interchangeable apps differing only in branding/content, submitted from one shared codebase — and has a documented history of mass-removing exactly this shape of app without individual warning (gym-chain/fitness-SaaS "white-label app factories" are the canonical example).

**Decision:** one single app, submitted once, in the App Store. A Student/Guardian/Staff member picks (or is routed to) their own School after install — via a join code, an email-domain match, or a simple School search/select screen — rather than each School getting its own separate listing/icon. In-app theming (colors, logo, School name shown in headers) still applies per-tenant once a session is scoped to a School; what does NOT exist is a separate App Store Connect entry, bundle id, or app icon per School.

1. **Why this over the alternatives considered:** a true per-School native-app fleet is the highest-risk option — it is the exact pattern Apple's policy is written to catch, and avoiding rejection would require either genuine per-app functional differentiation (not just branding) or Apple's Custom Apps enterprise program, which is designed for internal company distribution, not a consumer-facing minor/guardian-data app. A PWA ("Add to Home Screen") sidesteps App Store review entirely but was not chosen — it gives up native push-notification quality and some camera/QR-scan UX polish this product already depends on (QR check-in, step-up re-auth flows). The one-shared-app model is the approach established fitness/gym-SaaS platforms (Mindbody, Glofox, and similar) actually ship today, confirming it is a proven, non-speculative pattern for this exact business shape.
2. **What this decision does NOT do:** it does not design the actual School-selection UX (join code vs. search vs. domain-match), does not resolve how/whether a School still gets ANY visual distinction (app icon badge, splash screen) within the single-app constraint, and does not touch `MobileAppPublishingModule`/`packages/build-pipeline`'s own still-fully-unbuilt status — those remain genuinely unbuilt and need their own dedicated build pass, now unblocked to start, but not scoped by this entry.
3. **Downstream effect:** `skills/ultm8-app-publishing/SKILL.md`'s existing entitlement model, publishing pipeline, and `TenantAppConfig` design assumed the per-tenant-app shape and need a fresh pass reconciling them against this decision before any of that module gets built — flagged here, not resolved here.

### Recorded by

User, choosing "One shared app, School picked after install" over a true per-tenant app fleet or a PWA, when presented with Apple's specific policy risk and the market precedent, 12 Oct 2026.

---

## Decision 248 — Track B native Stripe PaymentSheet: deferred, hosted Checkout stays the shipped path

**Date:** 12 Oct 2026 · **Status:** Confirmed by product owner
**Resolves:** whether to additionally build `@stripe/stripe-react-native`'s native PaymentSheet in-app card form for Track B's fresh-card membership purchase, now that Decision 243's hosted-Checkout path (opens in the device browser via `expo-web-browser`, no native SDK) already ships end-to-end tonight.

Deferred. The native PaymentSheet would be a UX improvement only (staying in-app instead of one browser hand-off) — not a functional gap, since Decision 243's path already works fully. Building it requires moving `apps/student` off Expo's fully-managed workflow onto a custom dev client (EAS Build, slower over-the-air update story going forward) — a real, one-time infrastructure cost not currently justified by a UX-polish-only improvement. Revisit only if a separate feature independently forces the native-dev-client move, so that infrastructure tax is paid once for a real reason, not twice.

### Recorded by

User, choosing "Defer — hosted Checkout is good enough for now" over taking on the native dev-client migration now, 12 Oct 2026.

---

## Decision 249 — WEEKLY_PASS DOES use `expiryDurationDays`; the DTO's "Not used by WEEKLY_PASS" comment was simply wrong

**Date:** 12 Oct 2026 · **Status:** Confirmed by product owner
**Resolves:** `docs/v1.2-backend-backlog.md`'s flagged contradiction between Spec 55 §6.1 (Weekly Pass "governed by an expiry date instead of a recurring billing cycle," implying `expiryDurationDays` applies) and `CreateMembershipPlanDto.expiryDurationDays`'s own field description ("Not used by WEEKLY_PASS").

**Verified directly against the actual runtime code before asking:** `MembershipsService.createMembershipAndReturn()` (memberships.service.ts, the line computing `expiryDate: plan.expiryDurationDays ? new Date(Date.now() + plan.expiryDurationDays * 24*60*60*1000) : undefined`) already applies `expiryDurationDays` uniformly across every plan type, with no WEEKLY_PASS exception anywhere in that path. The actual behavior already matches Spec 55's reading — only the DTO's field-description comment (and `MembershipPlanFormPage.tsx`'s field-visibility reasoning, if it still cites the old claim) was wrong. No behavior change; this decision authorizes correcting the stale comment/doc text, not a code change.

### Recorded by

User, choosing "Confirm Spec 55's reading" after being shown the actual runtime code already matches it, 12 Oct 2026.

---

## Decision 250 — Push notification delivery: route both iOS and Android through FCM

**Date:** 12 Oct 2026 · **Status:** Approved by product owner — architecture decided, still blocked on real credentials
**Resolves:** which delivery architecture `DeviceToken`'s real SEND implementation (Decision 223) should target, while the product owner provisions the real Firebase/APNs credentials that decision already flagged as a prerequisite.

Both platforms route through Firebase Cloud Messaging — FCM can deliver to APNs under the hood for iOS, so the backend needs one integration point (one SDK, one credential set) instead of maintaining a separate direct-APNs client alongside FCM for Android. This is the standard, well-supported pattern for a cross-platform app and was chosen over maintaining two independent native pipelines, which would only be justified by a specific reason to avoid routing iOS push through Firebase — none exists here.

**Still blocked:** Decision 223's own prerequisite stands — real FCM and Apple Push Notification service credentials, provisioned by the product owner (a Firebase project, and an Apple Developer Program membership if one doesn't already exist), are required before any of this can be built against a real device.

### Recorded by

User, choosing "Route both iOS and Android through FCM" while the real credentials are still pending, 12 Oct 2026.

---

## Decision 251 — Staff "Add Manually": same pattern as Instructor (Decision 237) — real record created immediately, temp passcode emailed, forced change on first login

**Date:** 12 Oct 2026 · **Status:** Approved by product owner, built
**Resolves:** Decision 237's own "What this does NOT resolve" section, which explicitly flagged this exact follow-up: "Whether `AccountInvitation`... should still exist for Staff's own identical from-zero-invite gap." Re-asked directly, the product owner's answer mirrors Decision 237 exactly: "Yes — same pattern as Instructor: real User+RoleGrant created immediately, temp passcode emailed, forced change on first login."

1. **Mirrors Decision 1/230/237's Instructor "Add Manually" exactly** — a real `User` + `RoleGrant` (role: `BRANCH_STAFF`) created immediately from just a first name, surname, email, and branch, with no invite/acceptance step. "Staff" is not a separate `Role` or a profile table the way `Instructor` is its own table — it IS a `RoleGrant` row with `role: 'BRANCH_STAFF'` (`schema.prisma`'s `Role` enum has no separate `STAFF` value). So this closes the gap with only a `User` + `RoleGrant`, no third profile row the way Instructor's own flow also creates an `Instructor` row.
2. **`branchId` is required outright**, not conditional on whether the School has branches the way Instructor's own flow is — `StaffPage.tsx`'s own existing `needsBranch` logic already treats `BRANCH_STAFF` as always needing a branch, and `RoleGrantsService.create()`'s own existing `dto.role === 'BRANCH_STAFF' && !dto.branchId` 400 check already enforces the same rule for an existing-user grant. `CreateStaffManuallyDto.branchId` makes this a validation-layer guarantee (`@IsUUID()`, no `@IsOptional()`), not a service-layer check.
3. **First-login credential mechanism is untouched, reused as-is** — the same server-generated 6-digit temp passcode (bcrypt-hashed, `BCRYPT_ROUNDS = 12`), `User.mustChangePasscode`, and narrow passcode-change-only JWT (`POST /auth/passcode-change/first-login`) Decision 237 already built for Instructor. Nothing in `auth.service.ts`/`jwt.strategy.ts` changed — this is genuinely shared infrastructure, already role-agnostic.
4. **Lives on `RoleGrantsService` directly** (`createStaffManually()`), not a new module/controller — `RoleGrantsService` already owns all Staff CRUD (its own `GRANTABLE_ROLES = ['INSTRUCTOR', 'BRANCH_STAFF']`), so adding this method there is the most consistent placement, not a new concern needing its own home. New endpoint: `POST /schools/:schoolId/role-grants/add-manually` — follows the existing `GET /schools/:schoolId/role-grants/invite-candidate` route's own `schools/:schoolId/role-grants/...` shape (Decision 116), same School-Owner gate, same 20/hour-per-account throttle tier as `InstructorsController`'s own add-manually route.
5. **New `CreateStaffManuallyResponseDto` extends `RoleGrantResponseDto`** (not `InstructorResponseDto`'s firstName/surname/status shape) — a judgment call, since the task gave either option: the RoleGrant row this creates IS the Staff record (no profile table), and this also matches what `StaffPage.tsx`'s own existing "look up a user's grants" table already renders (`RoleGrantResponseDto`'s `userFirstName`/`userSurname`, joined from the User relation). `email`/`emailSent` added on top for the frontend's success banner.
6. **Frontend:** new `apps/school-portal/src/roleGrants/AddStaffManuallyModal.tsx`, a second "Add staff manually" entry point on `StaffPage.tsx` beside the existing invite-by-email/phone form (which previously dead-ended with "No ULTM8 account found," full stop) — same non-blocking `emailSent` banner pattern `InstructorsPage.tsx` already uses for its own Instructor "Add Manually" flow.
7. **Tests:** `apps/api/test/staff-add-manually.e2e-spec.ts` mirrors `instructors.e2e-spec.ts`'s own "Add Manually" coverage (happy path, duplicate email 409, non-owner 403, missing/cross-tenant branchId 400, full login-through-forced-passcode-change smoke test) minus the third-profile-row assertions. `apps/school-portal/e2e/staff-add-manually.spec.ts` mirrors `instructors.spec.ts`'s own Playwright coverage, modeled closely on it.

### What this does NOT resolve

Nothing further — this was the one remaining piece Decision 237 itself named as unresolved for Staff, and it is now closed the same way.

### Recorded by

User, confirming "Yes — same pattern as Instructor" when Decision 237's own flagged follow-up was re-asked directly, 12 Oct 2026.

---

## Decision 252 — Entity-level tenant offboarding built for the 7 entities with no delete/archive mechanism: Branch, Class, TimetableSlot, Instructor, Rank, Waiver, Lesson

**Date:** 12 Oct 2026 · **Status:** Product-owner design decisions made directly this session (via AskUserQuestion), then built
**Resolves:** Decision 226's own scoping ("approved to scope the full tenant-offboarding design now... the actual design is a separate, dedicated pass, not written here") for 7 of the 16 entities Decision 110 originally named — the remaining 9 (School, Franchise, MembershipPlan, Discipline, Skill, and the others Decision 110 lists) are untouched by this entry; School/Franchise already have Decision 110's own whole-tenant close-account flow, and MembershipPlan already has its own simpler archive (this session's earlier build).

### The product owner's design, as given this session

1. **Scope:** all 7 entities get a direct "Delete" action, usable while the School stays open — this is NOT Decision 110's whole-tenant close-account flow; it is a School Owner removing one Branch/Class/etc. while everything else keeps running.
2. **Semantics:** soft-archive, same 90-day retention pattern used elsewhere in this project.
3. **Dependents:** block deletion if the entity has active dependents — never cascade-archive, never orphan.

### Judgment calls made while building this (each flagged to the product owner, not silently guessed)

1. **"The same 90-day pattern" — read as the FULL `archivedAt`/`purgeAt`/`purgedAt` trio + a real purge job** (School/Franchise's own shape, Decision 110), not `MembershipPlan`'s simpler bare-`archivedAt`-no-purge shape (this session's own earlier, separate build). The codebase has two different existing "archive" shapes; the product owner's answer didn't specify which, and the trio is the more literal, more complete reading of "the same 90-day retention pattern."
2. **Per-entity "active dependents" rule — verified against the real schema, not assumed from the starting hint, and the safest conservative reading taken where the hint and the schema disagreed:**
   - **Branch:** any Class, Instructor profile, or Student (`StudentHomeBranch`) pointing at it — PLUS any active (non-revoked) `RoleGrant` scoped to it, added beyond the original hint because `RoleGrant.branchId` is `ON DELETE CASCADE` (verified): purging an archived Branch that still had an active Branch-Staff/Instructor role grant would otherwise silently destroy that person's access, not just remove a Branch.
   - **Class:** any `UPCOMING` Booking or active (`WAITING`/`NOTIFIED`) `WaitlistEntry`. `Booking.classId` is independently `ON DELETE RESTRICT` — ANY Booking ever made against a Class (even long-Completed/Cancelled) will block the eventual hard-purge regardless of this check, so a Class with real history simply never purges; it stays archived.
   - **TimetableSlot:** any `UPCOMING` Booking against a Class generated from it (`Class.timetableSlotId` — Booking never references TimetableSlot directly; Decision 230 reconfirms the generation relationship this relies on).
   - **Instructor:** any still-ending-in-the-future Class, or any `ON` TimetableSlot, assigned by `userId` (not this profile row's own `id` — `Class`/`TimetableSlot.instructorId` are `User` FKs, per that model's own schema comment). Archiving never touches the underlying `User` or their `INSTRUCTOR` RoleGrant.
   - **Rank:** reuses Decision 198's own `deleteRank()` dependents check VERBATIM (holders, grading history via `PromotionEvent`, instructor-declared via `InstructorBelt`) rather than the narrower "just `StudentRank.currentRankId`" starting hint — for consistency with the already-approved "safe to remove" definition for this exact entity, since Decision 198 already established it and a Rank blocked from deletion should be equally blocked from archiving.
   - **Waiver:** ANY `WaiverSignature` row at all, signed or the Unsigned-at-assignment-time rows this session's own earlier build introduced — independently DB-enforced too (`WaiverSignature.waiverId` is `ON DELETE RESTRICT`, verified).
   - **Lesson:** no real dependents today, stated explicitly rather than silently omitted — nothing in this schema FKs to Lesson except its own owned `LessonSkill`/`LessonContent` (cascade away with it); the learner-facing Curriculum redesign that would eventually add real Lesson-referencing entities (Decision 227) is still only scoped, not built.
3. **Rank and Lesson already had a hard-`DELETE` from Decision 198** (Lesson unconditional, Rank conditional on the same three checks). This build's own archive/unarchive pair **coexists with, rather than replaces**, those endpoints — a School Owner now has both a reversible archive and the pre-existing permanent delete for these two entities specifically. Not discovered until mid-build (the task's own framing assumed all 7 entities had zero mechanism today, which was true for 5 of them but not these 2) — flagged here rather than silently built around.
4. **Waiver is never hard-purged, at any `purgeAt`, by `EntityOffboardingPurgeProcessor`** — mirrors Decision 110's own School-level purge job, which already refuses to delete a School that still owns Waiver rows (signed `WaiverSignature` rows are legal records; Decision 110 part 1 explicitly defers Waiver's own retention period pending real legal input). The purge sweep finds and logs Waiver rows past `purgeAt` but never deletes them — an explicit, named skip, not a silent no-op or an accident of a caught FK error.
5. **Rank's purge-time safety is re-derived, not trusted from archive time** — `PromotionEvent.fromRankId`/`toRankId` are `ON DELETE SET NULL` and `InstructorBelt.rankId`/`stripeTierId` are `ON DELETE CASCADE` (verified), neither a DB `RESTRICT` the purge job's plain delete-and-catch-P2003 pattern would catch. The purge job re-runs the same holders/history/declared check immediately before deleting, rather than trusting the archive-time state still holds 90 days later (a new StudentRank/PromotionEvent/InstructorBelt row could in principle be created against an already-archived Rank in the interim, since this build does not retrofit an `archivedAt` check into the grading engine's own promote/declare write paths — see item 7 below).
6. **List-page "excluded by default" vs. "shown inline, badged" — two different treatments, by necessity, not inconsistency.** Branches/Classes/Timetable/Instructors/Waivers pages hide archived rows by default behind a "Show archived" toggle. The Disciplines ladder editor (Rank) and Curriculum's lesson tables show archived rows INLINE instead (same badged-not-hidden convention `MembershipPlansPage` already established) — hiding them would have broken each page's own existing reorder endpoint, which requires every item of the set to be sent exactly once (`reorderRanks`/`orderCategoryLessons`'s own validation): hiding an archived belt/lesson from the reordered list while that list is saved would either silently drop it from the ladder/category order or need extra bookkeeping this build did not add. Disclosed deviation, not an oversight.

### What this does NOT resolve — flagged, not silently built around

- **Nothing stops a NEW dependent from being created against an already-archived parent** outside the 7 entities' own archive-time check — e.g. nothing blocks a fresh Booking against an archived Class, a fresh StudentRank/PromotionEvent against an archived Rank (closed specifically for Rank's own purge path, item 5 above, but not for the interactive grading-engine write paths themselves), or a fresh RoleGrant/StudentHomeBranch against an archived Branch. This mirrors Decision 110's own School-level archived state, which is explicitly "read-only" only for the mutation endpoints already wired to `assertSchoolNotArchived`/`assertFranchiseNotArchived`, not a blanket global write freeze — retrofitting every other module's create paths to check the referenced entity's own `archivedAt` was out of this build's scope.
- **Archiving an Instructor profile does not prevent that person from still being picked as `instructorId` on a new Class/TimetableSlot** — `Class`/`TimetableSlot.instructorId` are `User` FKs validated via the active `INSTRUCTOR` RoleGrant (`assertValidInstructor`), never this profile row's own `archivedAt`. The School Portal's Instructor picker dropdowns (`ClassFormModal`/`TimetableSlotFormModal`) are therefore unfiltered by archival state — a cosmetic/UX gap, not a dependents-check correctness gap.
- **`Class`/`TimetableSlot`/`Instructor`'s own purge path has no anonymize-in-place fallback** the way School/Franchise's purge job does — an FK-restrict there is simply logged and skipped, retried on the next day's sweep forever. These 7 entities carry no PII-redaction requirement comparable to School/Franchise's own close-account flow, so there is nothing to anonymize into.

### Built

**api:** migration `20261112000001_entity_offboarding_7_entities` (archivedAt/purgeAt/purgedAt + indexes on all 7 tables; the matching `ultm8_jobs` grants/RLS policies the new purge sweep needs — Instructor and Lesson needed their first-ever `ultm8_jobs` grant; Rank's sweep additionally needed `PromotionEvent`/`InstructorBelt` SELECT). `BranchesService`/`ClassesService`/`TimetableService`/`InstructorsService`/`RanksService`/`WaiversService`/`CurriculumService` each gain `archive()`/`unarchive()` (School-Owner-gated, `assertSchoolNotArchived`, TOCTOU-safe conditional `updateMany` re-checked at write time — same race `TenantLifecycleService`'s own header comment already documents finding and fixing for School/Franchise — idempotent, 409 on active dependents) and matching `POST .../{id}/archive` / `.../unarchive` controller routes; each entity's list endpoint gains an `includeArchived` query flag (excluded by default). New shared `entity-offboarding-purge.processor.ts`/`EntityOffboardingPurgeScheduler` (daily sweep, `entity-offboarding-purge` queue) — see that file's own header comment for the full three-way-outcome account (plain delete / FK-restrict skip / Rank's own re-derived safety / Waiver's unconditional skip). `packages/api-client` regenerated.

**school-portal:** Branches/Classes/Timetable/Instructors/Waivers pages gain a "Show archived" toggle and an Archive/Unarchive row action; the Disciplines ladder editor and Curriculum's lesson tables show archived rows inline (badged) with their own Archive/Unarchive buttons, alongside Rank's/Lesson's pre-existing Delete.

**Tests:** `tenant-offboarding-7-entities.e2e-spec.ts` (29 tests — happy-path archive/unarchive, School-Owner-only gate, blocked-by-active-dependents 409, idempotency, cross-School isolation, per entity) and `entity-offboarding-purge.e2e-spec.ts` (12 tests — plain-delete, FK-restrict skip, Rank's own re-derived-safety skip, Waiver's unconditional never-purged skip, not-yet-due, already-purged).

### Recorded by

User, via direct AskUserQuestion answers on scope/semantics/dependents this session, 12 Oct 2026; every item under "Judgment calls" and "What this does NOT resolve" above is the Developer's own disclosed reasoning once those answers were checked against the real schema, not a further product-owner decision.

---

## Decision 253 — Tenant offboarding "remaining gap" claim corrected; Membership confirmed never-deletable, same as Waiver

**Date:** 13 Oct 2026 · **Status:** Confirmed by product owner
**Resolves:** a planning-doc miscount, caught before any code was written against it. A punch list this session produced claimed "9 of 16 entities still have no delete/archive action (Membership, Transaction, PaymentAccount, Booking, RoleGrant, +others)." Verified directly against real code before building anything further — that claim was wrong on every count.

### What was actually verified, file by file

- **Discipline and Skill already have real hard-delete** (`RanksService.deleteDiscipline()`/`deleteSkill()`) with their own dependents checks (holders, grading history, Class/TimetableSlot style references, linked Lessons) — not a gap at all, despite Decision 252's own text listing them among "the remaining 9."
- **School and Franchise** already have Decision 110's whole-tenant close-account flow (`TenantLifecycleModule`) — a different mechanism (closing the whole tenant) from a per-row delete, but not a missing mechanism.
- **MembershipPlan** already has its own simpler bare-`archivedAt` archive (this session's earlier build, Decision 228's own item 8 follow-up area).
- **Transaction, PaymentAccount, Booking, and RoleGrant were never named anywhere** — not in Decision 110's own original text, not in any code comment carrying the "general tenant offboarding is `[UNRESOLVED]`" marker Decision 110 introduced. A repo-wide grep for that marker, re-run after Decision 252's build, confirms it. These four were the punch list's own invention, not a real, previously-flagged gap.
- **The only entity still genuinely carrying Decision 110's original `[UNRESOLVED]` marker, untouched by Decision 252, is `Membership`** (the enrollment/purchase record — distinct from `MembershipPlan`) — `MembershipsService`'s own comment, unchanged since Decision 110, confirmed by direct read.
- Three now-stale comments (TimetableSlot, Class, Lesson) still claimed "no delete method" after Decision 252 gave each of them a real archive()/unarchive() pair — fixed directly (comment-only, no behavior change), not left to mislead the next session.

### Decision

**`Membership` is never deletable or archivable via a new mechanism — treated the same as `Waiver`'s own exception**, not given a Decision-226/252-style soft-archive. A `Membership` row is a real purchase/billing record, directly linked to its originating `Transaction` (Stripe payment history, refund/dispute state) — deleting or purging one would destroy financial audit trail the same way purging a signed `Waiver` would destroy a legal record, which is exactly why Decision 110 carved Waiver out in the first place. `Membership`'s own natural lifecycle (`ACTIVE`/`EXPIRED`, force-expiry on dispute loss or Subscription cancellation, Decisions 111/122) already covers "this Membership is over" without needing a separate delete/archive action layered on top.

### What this does NOT resolve

This closes item 7 of the punch list as "no further build needed," not as "fully audited forever." If a genuine need to purge old `Membership`/`Transaction` rows surfaces later (e.g. a real data-retention policy), it deserves its own decision with real legal input, the same way Waiver's own retention period still does — not a silent extension of this entry.

### Recorded by

User, choosing "Treat like Waiver — never delete" over building a new soft-archive mechanism or a narrower list-filter-only option, 13 Oct 2026.

---

## Decision 254 — Curriculum learner-facing redesign + video/caption integration, built (Decisions 101, 225, 227)

**Date:** 13 Oct 2026 · **Status:** Confirmed by product owner
**Resolves:** Decision 227's own scoping approval ("design not yet written, not built") — now actually built; and Decision 225's folding-in of Decision 101's long-unbuilt video/caption vendor integration (Cloudflare Stream + AWS Transcribe) into this same effort, rather than as a standalone item.

### Scope answers (direct AskUserQuestion with the product owner, this session)

1. **Membership gating:** a Student may favorite/comment/track-watch-progress-on/add-to-playlist a Lesson it may *watch* — reuses the exact `LessonAccess`/`isLocked` rule `shapeLessonResponse` already applies (Decisions 154, 190, 195: free Lessons to everyone at the School, non-free Lessons gated by the caller's own live Memberships whose plan includes that Lesson's Discipline). No new gating concept introduced.
2. **Video/caption integration:** build the real Cloudflare Stream + AWS Transcribe code now, same as every other not-yet-provisioned vendor in this codebase (Twilio Verify, Cognito, SES, R2) — warn-on-missing-config, fail-on-first-actual-use, genuinely unverified against a live account until real credentials exist.

### What was built

**api:** migration `20261113000000_curriculum_favorites_playlists_watch_comments` — five new tables (`Favorite`, `WatchHistory`, `Playlist`, `PlaylistItem`, `Comment`), each with its own RLS policies (Comment needed three explicit `FOR SELECT`/`FOR INSERT`/`FOR DELETE` policies, not one bare `USING`, to avoid a real privilege-escalation bug caught on review before the migration was ever applied — see that migration's own header). `CloudflareStreamService` (`createDirectUploadUrl`, `isVideoReady`, `getPublicPlaybackUrl`) and `TranscribeService` (`startTranscriptionJob`, `getCompletedSubtitleUrl`), both following the established "warn on missing env, throw on first use" constructor-guard convention. `CurriculumService` gains `assertCanWatchLesson` (the shared gate for every new action below — 404 on a Lesson that doesn't exist, is archived, or doesn't belong to the caller's own `:schoolId` route param; 403 if locked) plus the full set of Favorite/WatchHistory/Playlist/PlaylistItem/Comment methods and a `requestVideoUploadUrl` (staff-only). `VideoProcessingPollScheduler`/`Processor` (new `video-processing-poll` queue, 5-minute cron) polls Cloudflare Stream readiness and drives AWS Transcribe's job lifecycle, flipping `Lesson.captionStatus` (PENDING → PROCESSING → READY/FAILED) — the same 4-state enum Decision 101 already defined, now actually driving a real state machine rather than sitting unused. `LessonResponseDto` gains `playbackUrl` (computed server-side via `CloudflareStreamService.getPublicPlaybackUrl`, null unless `captionStatus` is READY and the Lesson is unlocked) — added during this build's own review pass once the apps/student video player surfaced that no client previously had any way to get an actual playback URL at all. A real, previously-undiscovered routing bug was also found and fixed here: `addFavorite`/`removeFavorite`/`upsertWatchProgress`/`createComment`/`findComments` were initially routed under `schools/:schoolId/...` without ever binding or verifying `:schoolId` in the controller — fixed to thread it through and 404 on a cross-tenant mismatch, matching the "cross-tenant mismatch is a 404" convention Decision 252 already established and the real precedent (`WaiversController.findSignatures`) that does this correctly. `packages/api-client` regenerated (twice — once after the initial build, once after the schoolId fix).

**school-portal:** `VideoUploadModal.tsx` (raw browser PUT straight to Cloudflare Stream, not through this app's own backend) wired into `CurriculumPage.tsx` with a `captionStatusBadge()` helper and an "Upload video" row action shown only while `captionStatus` is PENDING or FAILED.

**student:** `LessonVideoPlayer.tsx` (`expo-video`, not `expo-av` — confirmed directly against this Expo SDK's own bundled-module manifest that `expo-av` has been dropped entirely; caption tracks deliberately not wired into the player this slice, see "What this does NOT resolve" below), `LessonDetailScreen.tsx` (description, video, Favorite toggle, Add-to-Playlist picker, comment thread — all gated on `lesson.locked`), `PlaylistsScreen.tsx`/`PlaylistDetailScreen.tsx` (create/rename/delete, add/remove items, up/down reorder — adjacent-swap, matching the school-portal's own established reorder-UI convention), a "Continue watching" section and a favorited-star indicator on `LessonsScreen.tsx`/`LessonRow.tsx`.

**Tests:** `curriculum-learner-redesign.e2e-spec.ts` (24 tests — Favorite/WatchHistory/Playlist/Comment/video-upload-url, including explicit REGRESSION cases locking in the cross-tenant schoolId fix). `apps/student`'s own pre-existing 86-test jest suite re-verified green against this build (no new tests added there, per this slice's own scope decision — see below).

### Judgment calls, disclosed

1. **`playbackUrl` is null for anything short of fully READY**, even though the underlying Cloudflare asset may already be playable before AWS Transcribe finishes — consistent with `LessonVideoPlayer`'s own existing captionStatus-gated UI, not a new restriction invented for this field.
2. **Caption tracks (`captionTrackRef`) are not wired into the `expo-video` player.** `expo-video` surfaces subtitle tracks it finds embedded in the HLS manifest itself, not via a separate track-URL prop — confirming this actually works requires first confirming `CloudflareStreamService`/the transcription pipeline actually muxes AWS Transcribe's output into the manifest's own subtitle group, a real backend investigation outside this slice's scope. The native player's own caption UI still applies to whatever tracks the manifest happens to expose on its own.
3. **No tests were added for the new `apps/student` UI**, per this slice's own explicit scope decision (verification leaned on `tsc --noEmit` plus re-running the app's full pre-existing suite) — unlike the `apps/api` e2e coverage, which was written and verified as part of this same build.
4. **Guardian-viewing-a-linked-minor's Lessons/Favorites/WatchHistory/Playlists is explicitly not built** — `useLessonsForEnrolledSchools`'s own header comment flags this as a real, pre-existing gap (nothing client-visible resolves which School(s) a linked minor is enrolled at), not something newly introduced or newly closed by this effort.
5. **Playlist items don't link into `LessonDetailScreen`** — `PlaylistItemResponseDto` doesn't carry the full `Lesson` shape that screen needs via route params, and there is no student-facing "get one Lesson by id" endpoint to refetch it from. Disclosed, not fixed, in this slice.
6. **Per-playlist item counts are omitted from `PlaylistsScreen`** — would cost one extra request per playlist to show a number; left as a deliberate simplicity call.

### What this does NOT resolve

- **The entire Cloudflare Stream / AWS Transcribe integration remains genuinely unverified against a real vendor account** — same posture as every other not-yet-provisioned vendor in this codebase (Twilio Verify, Cognito, SES, R2). `getPublicPlaybackUrl`'s own header comment separately flags that Cloudflare's "customer code" subdomain value is assumed, not confirmed, to equal the account id used for API auth.
- **A failed video PUT (network blip, bad/expired upload URL, no real credentials) leaves the Lesson stuck in PROCESSING with no rollback** — `VideoUploadModal.tsx`'s own header comment discloses this as a known, unfixed workflow gap; `requestVideoUploadUrl` writes `videoRef`/flips to PROCESSING before the PUT itself even starts.
- **Nothing retrofits the "may this caller watch this Lesson" gate into any pre-existing endpoint** — only the five new learner-facing actions (favorite, watch-progress, comment, playlist-add, video-upload-url) use `assertCanWatchLesson`; the pre-existing Lesson read endpoints keep their own, separately-established locking behavior unchanged.

### Recorded by

User, via direct AskUserQuestion answers on Membership gating and the video/caption build-now decision, 13 Oct 2026; every item under "Judgment calls" and "What this does NOT resolve" above is the Developer's own disclosed reasoning, cross-checked by independently re-running `tsc`/the full e2e and jest suites rather than trusting either delegated build's self-report.

---

## Decision 255 — Multi-School coach/Branch Staff switcher built; `useOwnedSchoolId`'s identical gap found but deliberately left for its own decision

**Date:** 13 Oct 2026 · **Status:** Built
**Resolves:** Decision 184 item 4's own named follow-up — "a coach at several Schools sees the first one for now (no School switcher yet)" — on both `apps/school-portal` and `apps/student`'s Coach dashboard.

1. **No backend change** — the JWT already carries every active grant (`RoleGrant`, not a role column, is the source of truth for multi-School membership — `ultm8-domain-rules` §3/§6.1/§8.3, `[CONFIRMED]`), and every coach/grading endpoint is already School-scoped by its own `schoolId` request param. This was purely a client-side "which School is currently being read" gap: `useCoachSchoolId()` took whichever grant happened to sort first, with no way to see or act on a second one.
2. **Built on both platforms, same mechanism:** an explicit, persisted "active School" selection (sessionStorage on the School Portal, matching `sessionStorageTokenStore`'s own tab-scoped reasoning; AsyncStorage on `apps/student`, since a School id isn't a secret the way the access/refresh token is) that `useCoachSchoolId()` now prefers when it names a School the caller still actually holds a grant at, falling back to the first (stable-sorted) School otherwise — every existing caller (`useGradingSchoolId`, `CoachDashboardPage`/`CoachDashboardScreen`, `GradingBoardPage`, etc.) picks this up with no call-site changes. A new `SchoolSwitcher` (School Portal: `TopBar`; `apps/student`: the Coach dashboard screen, the one screen that needs it since every other coach screen receives `schoolId` as a navigation param from there) renders only when the caller actually holds 2+ distinct Schools' worth of INSTRUCTOR/BRANCH_STAFF grants — invisible for the common single-School case.
3. **Found, not fixed: `useOwnedSchoolId` (School Portal) has the identical first-match bug** — nothing in the schema stops a `User` holding `SCHOOL_OWNER_MANAGER` at more than one School (no `@@unique([userId, role])` on `RoleGrant`), and that hook's own existing code comment ("a display hint only... the API re-checks") never mentioned the ordering gap the way Decision 184 item 4 did for coaches. Deliberately NOT folded into this build — it's a different, not-yet-approved piece of scope (an Owner's "which School" switch plausibly wants different placement/affordances than a coach's), flagged here for its own future decision rather than guessed at silently.

### What this does NOT resolve

The `useOwnedSchoolId` gap above, and extending either switcher to `apps/platform-admin` or any other realm — neither was in scope.

### Built

**School Portal:** `AuthContext.tsx` (`useCoachSchoolId`/new `useCoachSchoolIds`, sessionStorage-backed active selection, cleared on logout), `schools/schoolQueries.ts` (new `useSchoolNames`, one query per School via `useQueries` — the same fan-out `useSchoolSkillGroups` already established), new `coach/SchoolSwitcher.tsx`, wired into `layout/TopBar.tsx`.
**apps/student:** `auth/AuthContext.tsx` (same shape, AsyncStorage-backed), `coach/coachQueries.ts` (new `useSchoolNames`, same fan-out pattern), new `SchoolSwitcher` in `coach/CoachDashboardScreen.tsx` using the existing `SearchablePickerField`.

**Tests:** School Portal — Playwright `e2e/coach-school-switcher.spec.ts` (4 new: single-School sees nothing, two-School switch sticks across navigation, option labels, a School Owner with a second coached School never sees it); `fixtures.ts`'s `addPerson` grant-role union widened to include `SCHOOL_OWNER_MANAGER` for that last test. `apps/student` — 2 new cases in `coach/coachScreens.test.tsx` (no switcher at one School; switching at two calls `setActiveCoachSchoolId`).

### Recorded by

Developer, building Decision 184 item 4's own already-approved follow-up; the `useOwnedSchoolId` finding is disclosed reasoning, not a further product-owner decision, 13 Oct 2026.

---

## Decision 256 — Shared marketing footer: scope resolved (standard B2B shape, all three apps, placeholder links), built

**Date:** 14 Oct 2026 · **Status:** Confirmed by product owner, built
**Resolves:** `docs/v1.2-backend-backlog.md`'s "Shared marketing footer" entry and `docs/decisions/DRAFT-global-search-and-footer-scoping.md` §B — both flagged this as needing a v1.1 scoping conversation before any build; that draft's own "next available number" note (246) is now stale, since 246 was since used for Student Measurements.

### Scope answers (direct AskUserQuestion with the product owner, this session)

1. **Does an authenticated staff portal get a marketing-style footer at all?** Yes — option (b) from the draft, "standard B2B SaaS footer" (copyright + Terms/Privacy/Support), not (a) minimal or (c) fuller-marketing.
2. **Which app(s)?** All three — `apps/school-portal` (the original ask), plus `apps/platform-admin` and `apps/student`, both out of the draft's original scope.
3. **Terms/Privacy/Support content:** none of these pages exist yet (confirmed — not found anywhere in this repo), and the product owner hasn't supplied real URLs or a company legal name. Ships with all three links visible but disabled ("Terms of Service (coming soon)", etc.) — the same "visible but not live, reads as not-built rather than broken" convention `TopBar.tsx`'s Global Search input already established, not a dead link pointing nowhere. Copyright line uses "ULTM8" (the brand name already used everywhere else in this codebase — `AppShell`'s own `brand` prop on every Shell — not an invented new legal name) and a dynamically-computed year, not a hardcoded one.

### What was built

**`packages/ui`:** `AppShell` gained a new `legalFooter?: ReactNode` prop — a separate slot from the pre-existing `footer` prop (which renders inside the sidebar, currently just Log Out); `legalFooter` renders once at the bottom of the main content column, same "once per AppShell" scope as `header`. New exported `LegalFooter` component + `LEGAL_FOOTER_LINKS` constant (`components.tsx`) — the ONE place to edit once a real Terms/Privacy/Support page exists: flip that entry's `enabled` to `true` and set its real `href`, nothing else in the component changes. New `.ultm8-shell__legal-footer*` CSS classes (`components.css`).

**`apps/school-portal`, `apps/platform-admin`:** both `Shell.tsx` now pass `legalFooter={<LegalFooter />}`.

**`apps/student`:** has no `AppShell`/persistent-footer concept (a plain navigation stack) — gained its own near-identical `LegalFooter.tsx` (same copyright/disabled-links shape, plain `Text`/`View` instead of DOM) rendered below the "Log out" button on `HomeScreen.tsx`, the closest equivalent to "once per app shell." Kept in sync with `packages/ui`'s copy by hand — there's no shared non-UI package both already depend on that would justify a third location for three small constants (`apps/student` doesn't depend on `@ultm8/ui`, which is DOM-only).

### Judgment calls, disclosed

1. **Copyright year is computed (`new Date().getFullYear()`), not hardcoded** — avoids yearly staleness; this is an engineering default, not invented legal content.
2. **The two footer implementations (web vs. `apps/student`) are hand-duplicated, not shared** — three small constants don't justify a new cross-platform package; each file's own header comment cross-references the other so a future content change isn't made in only one place by accident.
3. **Links render as disabled `<span>`/`Text`, never a real `<a>`/touchable**, even once `enabled` flips true for one entry but not the others — intentional per-link granularity (a real Support mailto could go live before Terms/Privacy pages exist, for example).

### What this does NOT resolve

- **No real Terms of Service, Privacy Policy, or Support page/URL exists yet** — this only stops the app from looking unfinished in the meantime; the actual pages and their copy (company legal name, required jurisdiction-specific language) still need to come from the product owner directly, especially since Decision 245 shows GDPR/LGPD compliance work is already in motion.
- **The per-School/Franchise white-label "customizable footer" angle** the original mockups' own comments gestured at is still out of scope — deliberately deferred to the white-label initiative (Decision 247), not designed here.
- **The two "Get the app" QR tiles** the mockups showed are not part of this build — `apps/student` still isn't published to an app store.

### Verified

`packages/ui`, `apps/school-portal`, `apps/platform-admin`, `apps/student`: `tsc --noEmit`, all clean. Both web apps' production `vite build` succeeded. New Playwright spec `apps/school-portal/e2e/legal-footer.spec.ts` (1 test, signed-in Dashboard render, confirmed via an actual screenshot before removing the ad-hoc capture call) and new `apps/student/src/components/LegalFooter.test.tsx` (1 test); apps/student's full suite re-verified green (21 suites, 112 tests).

### Recorded by

User, via direct AskUserQuestion answers on footer scope, app coverage, and link content, 14 Oct 2026.

---

## Decision 257 — School Portal's footer upgraded to the richer, per-School shape (option c), with real per-School settings; platform-admin/apps/student keep Decision 256's simpler one

**Date:** 14 Oct 2026 · **Status:** Confirmed by product owner, built
**Resolves:** a follow-up to Decision 256, same day — the product owner shared a reference design (a fuller marketing-style footer: Programs/Company/Support/"Get the app" columns, a zip search, social icons) and asked for the School Portal's footer to match it, but populated with the signed-in School's own real information rather than static ULTM8 marketing copy.

### Scope answers (direct AskUserQuestion with the product owner, this session)

1. **Richness:** full layout matching the reference (not just a visual-style pass on Decision 256's simpler footer) — School Portal only. `apps/platform-admin` and `apps/student` keep Decision 256's shape unchanged (neither has a single "current School" context: Platform Admin spans every School, and a Student/Guardian may be enrolled at several).
2. **Content model:** real, per-School settings — "we need to create a footer back end and settings so we can feed the correct information to each school footer." Not static.
3. **Programs column:** this School's own Disciplines (already-existing data, `GET /schools/:id/disciplines` — no new field).
4. **Company column:** real links to this School's already-built Instructors/Branches pages, plus a new free-text "About us" field (not a link — nothing to link to).
5. **Support column:** Contact = this School's own email/phone (new fields). Terms of Service/Privacy Policy stay the fixed, platform-wide placeholder links from Decision 256 — a School isn't a separate legal entity publishing its own Terms of Service for this software.
6. **Social links:** Facebook, Instagram, TikTok, YouTube, X (Twitter) — five platforms, each independently optional.
7. **Brand label:** the footer's own "ULTM8" brand text becomes the signed-in School's own name (`School.name`, already exists). The copyright line stays "© {year} ULTM8" — a judgment call, disclosed below, not asked directly: a software copyright notice names the platform operator, not each tenant, consistent with Terms/Privacy staying platform-wide for the same reason.
8. **Empty-field behavior**, clarified mid-build: every per-School field (`footerAboutUs`, Contact, each social URL) hides its own line/icon ENTIRELY when unset — never an empty state or placeholder. Terms of Service/Privacy Policy are the one exception (always shown, disabled-for-now, per Decision 256).

### What was built

**api:** Migration `20261114000000_school_footer_settings` — 8 new nullable `String` columns directly on `School` (`footerAboutUs`, `footerContactEmail`, `footerContactPhone`, `footerFacebookUrl`, `footerInstagramUrl`, `footerTiktokUrl`, `footerYoutubeUrl`, `footerTwitterUrl`), following the exact convention Decision 231 (Branch field-level settings) established for this codebase: typed columns directly on the tenant entity, not a separate settings table or JSON blob — confirmed via research before building, since no generic/reusable tenant-settings pattern exists anywhere in this schema. Pure additive `ALTER TABLE`, no new RLS policy (the existing `school_tenant_isolation` policy already covers every column on `School`). `CreateSchoolDto`/`UpdateSchoolDto`/`SchoolResponseDto` extended field-for-field, reusing the existing `PATCH /schools/:id` endpoint (`assertSchoolOwner`) rather than a new one — same "`null` clears, omitted leaves unchanged" convention every other optional `School` field already uses.

**school-portal:** `AppShell` (`packages/ui/src/components.tsx`) restructured — `legalFooter` now renders as a full-width band below the ENTIRE shell (sidebar included) rather than confined inside the main content column (a bug found and fixed mid-build, flagged directly by the product owner against a screenshot: the first version ran the footer only under the main column, indented past the sidebar). New `SchoolFooter.tsx` (school-portal-local, not exported from `packages/ui` — it's School-specific, unlike the generic `LegalFooter`) reads the current School via the existing `useGradingSchoolId()` (owner's, else coach's — the same resolution `VerifyBeltsNotice` already uses) + `useSchool`/`useDisciplines`, replacing `<LegalFooter />` in `Shell.tsx`. New `FooterSettingsCard` on `SchoolPage.tsx` (own local form + save action, same pattern as the existing `FranchiseAffiliationCard` below it) using `@ultm8/ui`'s existing `Field`/`TextField`/`TextArea`/`PhoneField`.

**Tests:** `apps/api/test/tenants.e2e-spec.ts` gained one new case (set/kept-when-omitted/cleared-with-null/rejected-when-malformed for all 8 fields, mirroring the file's own existing identical-shape test for `timezone`) — 53/53 passing. `apps/school-portal/e2e/legal-footer.spec.ts` rewritten for the new footer (real School data renders, every unset field hides entirely, the settings form round-trips into what the Dashboard footer shows, and the full-width-band layout itself) — 3/3 passing, confirmed against an actual rendered screenshot both before and after the full-width layout fix, not just assertions.

### Judgment calls, disclosed

1. **Copyright line stays "© {year} ULTM8," not the School's own name** — only the top brand label changes. Reasoning in scope answer 7 above; flagged here explicitly since it wasn't asked as its own direct question.
2. **Social icons are plain circular badges with 1–2 letter abbreviations** (f / IG / TT / YT / X), not pixel-accurate brand logo SVGs — this codebase has no icon library dependency anywhere, and hand-rolling five accurate trademarked logos was judged disproportionate to this slice; each links out to the real URL once set regardless.
3. **QR tiles are plain dashed-border placeholder boxes, not real/generated QR codes** — `apps/student` still isn't published to an app store (Decision 256's own disclosed gap), so a real, scannable-looking QR code would point nowhere; this makes that explicit rather than implying something that works.
4. **The zip search stays purely decorative** — no cross-School "find a school" search exists anywhere in this codebase (that's Global Search, §A of the still-open `DRAFT-global-search-and-footer-scoping.md`, unrelated and unscoped).

### Verified

`packages/ui`, `apps/school-portal`, `apps/platform-admin`: `tsc --noEmit`, all clean (student untouched by this slice — no `@ultm8/ui` dependency). Both web apps' production `vite build` succeeded. `apps/api`: `tsc --noEmit`, full unit suite (490/490), `tenants.e2e-spec.ts` (53/53, including the new footer-fields case). `apps/school-portal`: full Playwright regression suite on chromium-desktop (115/116 — the one failure, `branch-photo-upload.spec.ts`, is a pre-existing, unrelated R2-upload gap in this sandbox, confirmed failing identically before this slice's changes).

### Recorded by

User, via direct AskUserQuestion answers on footer richness, per-field content mapping, and social platforms (plus one follow-up message specifying TikTok/YouTube/X); the full-width layout bug was flagged directly by the product owner against a screenshot of the first build. Judgment calls above are the Developer's own disclosed reasoning.

---

## Decision 261 — Transaction and PaymentAccount confirmed never-deletable, same treatment as Membership/Waiver

**Date:** 14 Oct 2026 · **Status:** Confirmed by product owner
**Resolves:** a second planning-doc miscount this session, caught before any code was written against it — same pattern Decision 253 already corrected once. An audit this session produced a "8 remaining entities with no archive/delete mechanism" list naming Transaction, PaymentAccount, Booking, and RoleGrant (+4 others). Verified directly against real code before building anything: that list was wrong on two of its four named entities.

### What was actually verified, file by file

- **RoleGrant already has a real revoke mechanism** — `DELETE /users/:userId/role-grants/:roleGrantId` (`role-grants.controller.ts`), setting `revokedAt`. Not a gap.
- **Booking already has a real cancel mechanism** — `PATCH /bookings/:id/cancel` (`bookings.controller.ts`), setting `status: CANCELLED`. Not a gap.
- **Transaction** (`schema.prisma`) — no `archivedAt`, no delete/archive endpoint anywhere. A genuine code-level gap, but never previously decided one way or the other — not named anywhere in Decision 110's own original text or any `[UNRESOLVED]`-marked comment.
- **PaymentAccount** (`schema.prisma`) — same: no `archivedAt`, no delete/deactivate endpoint, despite a `PaymentAccountStatus.DE_ACTIVE` enum value existing that nothing in the codebase ever sets. Also never previously decided.

### Decision

**Both `Transaction` and `PaymentAccount` are never deletable or archivable via a new mechanism — the same treatment Decision 253 already gave `Membership`.** `Transaction` is an immutable financial ledger row (Stripe payment/refund/dispute history) — deleting or purging one destroys audit trail the same way purging a `Membership` or signed `Waiver` would. `PaymentAccount`'s own natural lifecycle is "a School/Franchise replaces it by connecting a new one," not deleting the old record — the connected-account correlator itself has no meaning to erase without also erasing the Transaction/FranchiseFeeCharge history that references it via foreign key.

### What this does NOT resolve

Same scope limit Decision 253 already stated for Membership: this closes "no further build needed" for now, not "fully audited forever." A real data-retention policy for either table, if one is ever needed, deserves its own decision with real legal input — not a silent extension of this entry. `PaymentAccountStatus.DE_ACTIVE` remains unused; whether it should ever be wired up (e.g. to reflect a disconnected Stripe account without deleting the row) is a separate, smaller question this entry doesn't decide either way.

### Recorded by

User, choosing "Treat both like Membership — never deletable" over building a new deactivate-only mechanism for PaymentAccount, 14 Oct 2026.

## Decision 262 — School Portal refresh-token logic built, closing the identical gap `apps/student` already fixed

**Date:** 14 Oct 2026 · **Status:** Confirmed by product owner, built
**Resolves:** a real, previously-flagged gap — `packages/auth`'s own header comment had documented since Phase 3 that apps/api's login returned no refresh token, forcing a full re-login every 15 minutes. That underlying backend gap was closed separately (AuthModule now issues and rotates a real refresh token, `POST /auth/refresh`/`POST /auth/logout` both work, and `apps/student` already wired into it) — but `apps/school-portal` never adopted any of it: `sessionStorageTokenStore` had no refresh-token storage at all, and `apps/school-portal/src/api.ts` never passed `onUnauthorized` to `createApiClient`, so a School Portal session still silently died at the 15-minute mark with zero recovery.

### Built

Mirrors `apps/student`'s own working implementation exactly, adapted for `sessionStorage` instead of `expo-secure-store`:

- `packages/auth` — `sessionStorageTokenStore` (tenant realm only, not `platformAdminSessionStorageTokenStore` — Platform Admin's own login never issues a refresh token) gains `getRefreshToken()`/`setRefreshToken()`, with `clear()` now removing both keys together.
- `apps/school-portal/src/auth/sessionRefresh.ts` (new) — the same `setUnauthorizedHandler`/`handleUnauthorized` bridge module apps/student's own file already established, needed because `api.ts`'s client is a module-level singleton created before `AuthProvider` mounts.
- `apps/school-portal/src/api.ts` — `apiClient` now passes `onUnauthorized`; a second, deliberately plain `authClient` (no retry middleware) is used for the three direct credential-exchange calls (login/refresh/logout) to avoid a self-recursive retry loop on their own genuine 401s.
- `apps/school-portal/src/auth/AuthContext.tsx` — `login()` now persists the refresh token it was already being handed; `logout()` best-effort revokes it server-side before clearing both tokens; new `refreshSession()` registered as the `onUnauthorized` handler on mount.

### What this does NOT resolve

Reactive only, same as `apps/student`'s own still-open item — refreshes after a request 401s, not proactively ahead of the 15-minute expiry. No change to the underlying JWT-storage tradeoff `packages/auth`'s own header comment already reasons through (sessionStorage, XSS-readable by design, not addressed here).

### Recorded by

User ("Complete it .. let me know what you need from my side"), this item needing no further input — a confirmed, previously-flagged gap with an already-working pattern (`apps/student`) to mirror, not a new design decision.

## Decision 259 — MembershipPlan new-member billing strategy: Fresh cycle (default) vs. Prorate to a shared renewal day, School-Owner-set per plan

**Date:** 14 Oct 2026 · **Status:** Confirmed by product owner, built
**Resolves:** a direct question to the product owner — today, every new Student's Membership billing is anchored to their own signup date (verified directly against `PaymentsService.subscribe()`: no `billing_cycle_anchor`/`proration_behavior` is ever set, so Stripe charges the full price immediately and renews monthly from that same day, with no shared renewal date across Students on a plan). The product owner asked for a choice here, mirroring the Migrate/Grandfather pattern membership-plan price changes already use.

1. **A per-plan setting, not a per-signup prompt** — the School Owner picks once, in `MembershipPlanFormPage`, which of two strategies new signups on this SUBSCRIPTION plan use: **FRESH_CYCLE** (default, the pre-existing behavior, byte-for-byte unchanged) or **PRORATED_TO_SHARED_CYCLE** (every new Student is prorated from their signup day through the next occurrence of a fixed `billingCycleAnchorDay`, then renews on that day every month after).
2. **Stripe's own `billing_cycle_anchor_config` does the proration math** — confirmed directly against the installed SDK's own type definitions (`SubscriptionCreateParams.BillingCycleAnchorConfig`) before building, rather than computing the stub-period amount by hand: passing `{ day_of_month: N }` at Subscription-creation time makes Stripe bill a prorated stub invoice immediately for the gap between now and the next occurrence of day `N`, then recur on that fixed day every month after.
3. **`billingCycleAnchorDay` capped at 1-28**, not Stripe's own allowed 1-31 — sidesteps every month's own day-count/Feb-29 edge cases entirely rather than handling them, since nothing in the product ask required a specific day beyond 28.
4. **No backend migration path for an existing plan's EXISTING subscribers** — this only affects NEW signups going forward, same scope as the question asked. Switching a plan's strategy (or its anchor day) never touches any already-active Membership's own Stripe Subscription.

### What this does NOT resolve

The same underlying gap for one-time (non-SUBSCRIPTION) plan types doesn't exist — WEEKLY_PASS/CLASS_PACK/FRIEND_PASS/TRIAL_MEMBERSHIP have no recurring billing cycle to anchor at all, confirmed via `assertValidNewMemberBillingStrategy`'s own SUBSCRIPTION-only gate.

### Built

**api:** Migration `20261114000001_membership_plan_new_member_billing_strategy` — `MembershipPlan.newMemberBillingStrategy` (new enum, default `FRESH_CYCLE`) + `billingCycleAnchorDay` (nullable `Int`). `MembershipsService.assertValidNewMemberBillingStrategy()` (new) — validated against the already-resolved NEXT combination in both `createPlan`/`updatePlan`, same discipline `assertValidPlanShape` already established. `PaymentsService.subscribe()` gains an optional `billingCycleAnchorDay` param, passed through from `MembershipsService.purchase()` only when the plan's strategy is `PRORATED_TO_SHARED_CYCLE`. `MembershipPlanResponseDto` extended field-for-field. `packages/api-client` regenerated.

**school-portal:** `MembershipPlanFormPage.tsx` — a new "New member billing" control in the Pricing & Access step (SUBSCRIPTION only), same two-button-choice shape the existing Migrate/Grandfather prompt already established, with a "Renewal day of month" field shown only while Prorate is selected; blocks Save client-side (same pattern as the price-change prompt) when Prorate is selected with no day set.

**Tests:** `payments.service.spec.ts` (2 new — `billing_cycle_anchor_config` omitted/passed correctly). `membership-plan-archive-and-price-change.e2e-spec.ts` (8 new — default, valid creation, SUBSCRIPTION-only gate, 1-28 range, PATCH switching both directions, PATCH-leaves-untouched). `apps/school-portal/e2e/membership-plans.spec.ts` (2 new — full create/switch/clear round-trip, hidden for non-SUBSCRIPTION types).

### Recorded by

User, confirming "Option a, per-plan setting — build both" after being shown current behavior and two concrete design options for the shared-cycle anchor; the Franchise fee-rate migration this same conversation also approved is tracked as its own, separate piece of work (Decision 99's own follow-up), not folded into this entry.

## Decision 260 — Franchise fee-rate migration, built: MIGRATE_NEXT_CYCLE and MIGRATE_IMMEDIATE, replacing the outright rejection once franchise-fee billing has started

**Date:** 14 Oct 2026 · **Status:** Confirmed by product owner, built
**Resolves:** Decision 99's own "what this does NOT resolve" — changing a Franchise's `flatFeeAmount`/`perHeadcountRate` once at least one member School already has a standing franchise-fee Stripe Subscription. `FranchisesService.update()` previously rejected this outright with a 409 (Stripe Prices are immutable once created, so a naive change would silently diverge from what Stripe actually charges) — deferred, not decided against, per that decision's own text.

1. **Two named strategies, Franchise Owner's choice** — mirroring MembershipPlan's existing Migrate/Grandfather precedent in shape, not content (there is no "Grandfather" equivalent here — both options always do real Stripe work):
   - **MIGRATE_NEXT_CYCLE** — the new rate takes effect starting each affected School's own next billing period; the already-committed current period keeps billing at the OLD rate.
   - **MIGRATE_IMMEDIATE** — the new rate takes effect right now.
2. **FLAT and PER_HEADCOUNT are NOT mechanically symmetric** — verified directly against the installed Stripe SDK's own types before building, not assumed:
   - FLAT: a flat recurring Price's billing impact is always forward-looking. MIGRATE_NEXT_CYCLE swaps the Subscription Item's Price now with `proration_behavior: 'none'` — nothing about already-elapsed days changes, only the next invoice. MIGRATE_IMMEDIATE uses `proration_behavior: 'always_invoice'` — a real, immediate prorated charge for the remaining days of the current period.
   - PER_HEADCOUNT (metered): Stripe always bills a metered item's WHOLE period at whichever Price is attached when that period's invoice is generated — it has no concept of splitting one period's usage by date across two Prices. MIGRATE_IMMEDIATE swaps the Price right now, disclosed to the Franchise Owner (and confirmed with the product owner before building, via direct AskUserQuestion) as re-rating the Franchise's ENTIRE current period's already-accrued usage at the new rate, not just the days remaining — a genuine Stripe billing constraint, not a choice made by this code. MIGRATE_NEXT_CYCLE instead defers the swap via a delayed background job, past that Subscription Item's own `current_period_end`, so the already-committed period still bills at the OLD rate.
3. **A new Price is always created, never an existing one mutated** (Stripe Prices are immutable) — FLAT gets one new Price per School (each FLAT School already has its own ad-hoc Product, `ensureSubscription`'s own established shape); PER_HEADCOUNT gets exactly ONE new Price shared across every affected School, pointing at the Franchise's EXISTING Stripe Billing Meter (Meters aren't re-created) — persisted onto `Franchise.stripeUsagePriceId` so a School joining afterward also gets the new rate automatically.
4. **A rate change with zero Schools already billing needs no strategy and no decision row** — same "nothing to migrate" shape `MembershipsService.updatePlan()` already established for a price edit with zero active subscribers; the rate simply changes.
5. **School Portal UI**: `FranchiseFormModal` gained the same required two-button prompt shape `MembershipPlanFormPage`'s own price-change prompt already established, fed by a new `GET /franchises/{id}/billing-status` endpoint (queried up front, same "query, don't guess" precedent as `GET /membership-plans/{id}/active-count`) rather than guessing client-side whether a strategy will be required.

### What this does NOT resolve

`status: COMPLETED` on a MIGRATE_NEXT_CYCLE/PER_HEADCOUNT row means every affected School's deferred swap was successfully SCHEDULED, not that it has executed yet — the deferred job's own eventual success/failure is logged, not reflected back onto that row (would need either a child-row model or a wider status enum). The deferred job fires a disclosed 15-minute buffer past `current_period_end`, not an exact guarantee against Stripe's own invoice-generation timing. Whether a School should be notified when its Franchise's rate changes remains unresolved, same as Decision 99 already left it.

### Built

**api:** Migration `20261114000002_franchise_fee_rate_change` — new `FranchiseFeeRateChange` model (enums `FranchiseFeeRateChangeStrategy`/`FranchiseFeeRateChangeStatus`), RLS mirroring `MembershipPlanPriceChange`'s own Franchise-Owner-only + `ultm8_jobs`-all-commands shape. `FranchisesService.update()`'s former `ConflictException` replaced with a `feeRateChangeStrategy`-required `BadRequestException`, disclosing the PER_HEADCOUNT/MIGRATE_IMMEDIATE re-rate risk directly in the error message. New `FranchiseFeeRateMigrationProcessor` (`franchise-fee-rate-migration` queue, two job names: `migrate` and the PER_HEADCOUNT/MIGRATE_NEXT_CYCLE-only `deferred-swap`), new `FranchiseFeeBillingService` methods (`createReplacementMeteredPrice`, `createReplacementFlatPrice`, `swapSubscriptionPrice`). New `GET /franchises/{id}/billing-status`.

**school-portal:** `FranchiseFormModal.tsx` — the required strategy prompt, shown only when `schoolsAlreadyBillingCount > 0` AND a rate field actually changed; `useFranchiseBillingStatus` query hook.

**Tests:** `apps/api/test/franchise-fee-rate-migration.e2e-spec.ts` (6 new, real BullMQ/Redis + real Postgres, Stripe mocked — every strategy/feeModel combination, plus the no-PaymentAccount failure path and the deferred job's own scheduling verified directly against the real queue without waiting out its buffer). `apps/api/test/tenants.e2e-spec.ts` (1 updated — the old 409 test now asserts the new 400). `apps/school-portal/e2e/franchise-fee-rate-change-prompt.spec.ts` (2 new).

### Recorded by

User, via direct AskUserQuestion answers earlier in this same conversation: "Option 1 and 2" (build both strategies, Franchise Owner's choice) and "Allow it, disclosed as full-period re-rate (Recommended)" for the PER_HEADCOUNT/MIGRATE_IMMEDIATE semantics specifically. The exact mechanics (deferred-job vs. Stripe Subscription Schedule for MIGRATE_NEXT_CYCLE/PER_HEADCOUNT, the new-Price-not-mutation approach, the UI's up-front billing-status query) are the Developer's own disclosed implementation choices, consistent with what was approved.

## Decision 263 — Track B (apps/student) proactive token refresh on app launch, built

**Date:** 14 Oct 2026 · **Status:** Confirmed by product owner, built
**Resolves:** `docs/TRACK-B-ROADMAP.md`'s own flagged "Not yet" item under the session-refresh work: the reactive refresh path (401 → `refreshSession()` → retry) already closed the "session dies mid-use" gap, but `AuthContext`'s on-launch effect still applied whatever token `SecureStore` held unconditionally, even one that had expired while the app was closed — the first real API call would then 401 and the reactive path would silently fix it, but only after that failed request, with a brief flash/delay.

### Built

`apps/student/src/auth/tokenExpiry.ts` (new) — `isAccessTokenExpiredOrNearExpiry()`, decoding the stored token's own `exp` claim with a small 30-second buffer (so a request firing a second or two after the check doesn't itself race the token's real expiry). `AuthContext`'s on-launch effect now checks this before applying the stored token; a token already past it (or within the buffer) is refreshed via the SAME `refreshSession()` the reactive path already uses — before `loading` ever clears — rather than briefly applied as a known-stale token. Not a second refresh mechanism, and no foreground scheduling/timer while the app stays open — still checked only at launch, matching the scope the roadmap doc's own note already described ("closes the actual gap... without the extra complexity of... scheduling ahead of it").

### What this does NOT resolve

A live, in-foreground session still only ever refreshes reactively (on a 401), not on a scheduled timer ahead of the 15-minute TTL — unchanged, same as before. `apps/school-portal`'s own identical on-launch gap doesn't exist in the same shape (a browser tab's `sessionStorage` doesn't survive being closed the way a mobile app's `SecureStore` does across a cold launch) — School Portal's own refresh-token fix (Decision 262) is reactive-only by design, not a remaining gap this entry leaves open.

### Tests

`src/auth/tokenExpiry.test.ts` (6 cases, the pure decision function in isolation). `src/auth/AuthContext.test.tsx` (3 cases, new — a non-expiring token applied as-is with no refresh call; a near-expiry token refreshed before `loading` clears, applying the rotated token; a dead refresh token at launch ending cleanly in `logout()`). Full `apps/student` jest suite re-run (23 suites/121 tests, no regressions).

### Recorded by

User ("Complete it .. let me know what you need from my side"), this item needing no further input — a confirmed, previously-flagged gap with no open design question, closed by extending the already-approved reactive-refresh mechanism (Decision in that same roadmap section) rather than a new one.

## Decision 264 — Push notification SEND built (Decision 223/250's own prerequisite), still non-functional without real FCM credentials

**Date:** 14 Oct 2026 · **Status:** Built; genuinely blocked on real FCM credentials, same as Decision 223/250 already flagged
**Resolves:** the last of four items the product owner asked to be completed together this session ("Complete it .. let me know what you need from my side" — Transaction/PaymentAccount: Decision 261; school-portal refresh-token logic: PR #252; Track B proactive refresh: Decision 263; this is the fourth, push SEND). The product owner delegated the specific build approach directly ("tell me what's the best solution") rather than picking between the three options offered — this decision records that choice and what was actually built.

### The choice made (Developer's recommendation, delegated to by the product owner)

Build everything buildable without live FCM credentials, following this codebase's own established "warn on missing config, don't throw at construction, fail on first actual use" convention (R2ClientService/CloudflareStreamService/NotificationDeliveryService) — rather than waiting on credentials to build anything, or building a placeholder that can't be verified later. Stub only the one thing that genuinely cannot exist without a real Firebase project: the live outbound FCM call itself.

### What was built

**api:** `PushNotificationService` (`src/notifications/push-notification.service.ts`) — Firebase Admin SDK (not a hand-rolled OAuth2/JWT client; FCM's HTTP v1 API requires a signed Google OAuth2 token per call, exactly what `firebase-admin` exists to handle, the same "use the vendor's own SDK rather than reinvent its request-signing" reasoning `R2ClientService` already applies to `@aws-sdk/client-s3`). Both platforms route through one FCM integration point (Decision 250 — FCM bridges to APNs under the hood for iOS). `send()` reports any token FCM marks unregistered/invalid as stale, so the caller can delete it rather than retry it forever. Wired into `NotificationFanoutProcessor` (`src/jobs/notification-fanout.processor.ts`) as a SECOND, deliberately best-effort channel alongside the existing email send — unlike email, a push failure (including "not configured," the real state in every environment today) is caught and logged, never allowed to fail/retry the whole job, since that would otherwise make every single notification retry forever while credentials remain unprovisioned. Migration `20261114000003_push_notification_send` grants `ultm8_jobs` SELECT + DELETE on `DeviceToken` — exactly the trigger that model's own RLS comment had been flagging since Decision 95 ("add it once a future phase actually implements push dispatch"). New env vars `FCM_PROJECT_ID`/`FCM_CLIENT_EMAIL`/`FCM_PRIVATE_KEY` (a service account's credentials, not an API key).

**apps/student (Track B):** `pushRegistration.ts` — the client half `NotificationsScreen.tsx`'s own header comment had flagged as deliberately not built (Decision 95), now closed. Requests OS notification permission, then calls `expo-notifications`' `getDevicePushTokenAsync()` directly (NOT Expo's own push token/push service) — Decision 250 commits the backend to one FCM integration point, reached only once this app's native build carries a real Firebase project's config files (`google-services.json`/`GoogleService-Info.plist`), which don't exist in this environment. Registers the resulting token via the already-built, already-tested `POST /notifications/device-tokens`. Wired into `AuthContext.tsx` at both places a session is established (login, and an already-valid session on launch) — not on every reactive 15-minute token refresh, to avoid redundant calls. `expo-notifications` added as a dependency; `app.json` gained its plugin entry.

### What this does NOT resolve

- **Still blocked on real credentials** — Decision 223/250's own "Still blocked" note stands exactly as before. Nothing here changes that; it only moves everything that CAN be built without them from "not built" to "built and tested, inert until the vendor account exists" — the same posture `R2ClientService`/`CloudflareStreamService` are already in for their own vendors.
- **Delivery-rate and read-within-24h push metrics** (Decision 223's own named follow-up, "follow once SEND is real") — still deliberately deferred; this decision resolves SEND only, as Decision 223 itself scoped.
- **Multi-user-same-device re-registration** (e.g. a shared family phone, a Guardian and a Student both signing in) — hits the device-token endpoint's existing 409 on a second user registering the same token; `pushRegistration.ts` swallows it like any other failure rather than actively deregistering the previous user's token on logout. Flagged in that file's own header comment, not built this phase.
- **`platform` on `DeviceToken` stays informational only** — both platforms dispatch through the one FCM call regardless of its value (Decision 250).

### Recorded by

Developer, per the product owner's own delegation ("tell me what's the best solution") on push notifications, as the fourth and final item of the four-part "Complete it" request this session (alongside Decisions 261/263 and PR #252).

## Decision 258 — `useOwnedSchoolId`'s multi-School ordering bug (flagged by Decision 255) closed the same way

**Date:** 14 Oct 2026 · **Status:** Built
**Resolves:** Decision 255's own "What this does NOT resolve" item — a School Owner holding `SCHOOL_OWNER_MANAGER` at more than one School got whichever grant happened to sort first, with no way to see or switch to the other, the identical shape of gap Decision 255 already fixed for coaches/Branch Staff.

1. **Same mechanism as Decision 255, deliberately a separate active-selection state** — `useOwnedSchoolIds()` (new) + a `sessionStorage`-backed `activeOwnedSchoolId` in `AuthContext.tsx`, under its own key (`ultm8.activeOwnedSchoolId`), not sharing the coach key. Decision 255's own text flagged this as "a different, not-yet-approved piece of scope," reasoning a multi-School Owner's switch might want different placement/affordances than a coach's — in practice the two turned out to need the exact same mechanism and the exact same `SchoolSwitcher` component, so they're unified there, but kept as independent state because the same person could in principle both own one School and coach at a different one, and each side has to resolve on its own.
2. **`SchoolSwitcher.tsx` now covers both roles, picking whichever applies** rather than rendering two controls — `Shell.tsx`'s own existing `isCoachOnly = !useOwnedSchoolId() && ...` already means a caller who owns at least one School always gets the Owner nav, never the Coach one, so the two modes are mutually exclusive in practice. No change needed to `Shell.tsx`, `TopBar.tsx`, or any of the ~30 pages that call `useOwnedSchoolId()` directly — same "fix the hook once, every caller picks it up" shape as Decision 255.
3. **No backend change** — same reasoning as Decision 255: every Owner-gated endpoint is already School-scoped by its own `schoolId` param, and `TenantAuthorizationService` re-checks server-side regardless of what the client claims.

### What this does NOT resolve

Nothing further — this was the one remaining piece Decision 255 itself flagged as deliberately out of scope, closed the same way it predicted it would be.

### Built

`apps/school-portal/src/auth/AuthContext.tsx` (new `useOwnedSchoolIds`, rewritten `useOwnedSchoolId`, new `activeOwnedSchoolId`/`setActiveOwnedSchoolId`), `apps/school-portal/src/coach/SchoolSwitcher.tsx` (generalized to resolve Owner-vs-coach mode and render whichever applies).

**Tests:** new `apps/school-portal/e2e/owner-school-switcher.spec.ts` (4 tests — single-School Owner sees nothing, two-School switch sticks across navigation, option labels, an Owner of one School who also coaches at a second never sees the coach switcher instead), plus the full coach-switcher regression (`coach-school-switcher.spec.ts`) and a broad Owner-page Playwright regression pass (dashboard, branches, instructors, students, classes, timetable, membership plans, waivers, franchises, notifications, staff-add-manually, coach-dashboard, grading-board, branch-staff — all green; two `franchises-filter.spec.ts` failures traced to test-isolation noise from running many spec files in one worker, confirmed unrelated by re-running that file alone, clean).

### Recorded by

Developer, closing Decision 255's own named follow-up; no new product-owner decision was needed since the approach (same mechanism, same component, separate state) was already implied by that decision's own reasoning, 14 Oct 2026.

## Decision 265 — Grading-data erasure groundwork for account deletion (Decisions 134/141): the grading-specific piece only, no endpoint, no account-deletion job built

**Date:** 15 Oct 2026 · **Status:** Confirmed by product owner, built
**Resolves:** item 5 of the "Left for later" list `docs/grading-integration/hardening/README.md` recorded, per Gus's own request on 12 Oct 2026, to revisit at the end of that phase — "Deleting an account with its grading data." Research for this item found the premise had shifted: there is no account-deletion mechanism anywhere in this codebase (not even a stub — the only trace of the "account-deletion-processing job" SKILL.md §14 names is a single `logger.log()` line inside Guardian-consent-withdrawal saying erasure isn't built yet), so Decisions 134/141 had been written assuming a broader job that was never actually built. Decision 245 (12 Oct 2026) separately scoped the FULL GDPR/LGPD erasure picture and explicitly says that design "doesn't authorize building it yet" pending legal review.

Given that, two real options existed: (A) build a genuine `DELETE /users/me`, feature-flagged off, covering both the grading piece and Decision 245's own "anonymize-in-place" recommendation for the rest of the account — but that means partially building something Decision 245 itself says isn't authorized yet; or (B) build only the grading-specific erasure logic, narrowly scoped to Decisions 134/141, with no public route at all — pure groundwork for whenever a real account-deletion job (and the legal review behind it) actually exists. The product owner chose (B).

1. **Decision 141 (a deleted Instructor shows "Former instructor" on other students' history) needed zero new code** — found already fully built and tested: `PromotionEvent.performedById`/`voidedById`/`noteEditedById`, `SkillSignOffLog.changedById`, and `PromotionEventNoteLog.changedById` are all `onDelete: SetNull`, and the school-portal's `StudentGradingPage.tsx` already renders a null `performedById` as "Former instructor" (verified by the existing `ranks.e2e-spec.ts` test for this exact case). Deleting an Instructor's own `User` row already does the right thing today, mechanically.
2. **Decision 134 (a deleted Student's own grading data is deleted with the account) is what actually needed building** — `StudentRank.studentId -> User` has no `onDelete` (defaults to RESTRICT), so a Student's `User` row can't be deleted while any `StudentRank` exists. New `GradingErasureService.eraseGradingDataForDeletedAccount(studentId)` (`apps/api/src/ranks/grading-erasure.service.ts`) hard-deletes every `StudentRank` row for that Student across every discipline, explicitly deleting `StudentRankSkillStatus` and `PromotionEvent` first (both reference `StudentRank` with no cascade), then the `StudentRank` rows themselves — `PromotionEventNoteLog`/`SkillSignOffLog` cascade automatically at the DB level, confirmed empirically rather than assumed (a Postgres `ON DELETE CASCADE` trigger runs independently of the deleting role's own grants/RLS on the child table, the same behavior `EntityOffboardingPurgeProcessor`'s own header comment already documents). Not called by anything yet — exported from `RanksModule` so a future account-deletion job can inject it.
3. **A dedicated `ultm8_grading_erasure` Postgres role, not the shared `ultm8_jobs`** — a first draft granted DELETE on these three tables to `ultm8_jobs` directly, which broke a real, already-shipped security invariant: `grading-ready-notification.e2e-spec.ts`'s "the jobs role may only mark a student as notified, nothing else in grading" test (Decision 178.5). `ultm8_jobs` is ONE role shared by every background job, not one per job, so widening it for this not-yet-used feature would have also widened it for the already-shipped grading-notifications sweep. Fixed the same way `ultm8_discovery`/`ultm8_platform_admin` were each kept separate from `ultm8_app`/`ultm8_jobs` (Decision 94): a new dedicated role (new `PrismaGradingErasureService`, new `DATABASE_URL_GRADING_ERASURE`), narrowly granted SELECT+DELETE on exactly `StudentRank`/`StudentRankSkillStatus`/`PromotionEvent`, plus the minimum `RoleGrant` columns needed only to evaluate those tables' own pre-existing PUBLIC `_school_staff_or_self` policies (the same "FOUND ON CI" wrinkle `ultm8_discovery`'s own migration already hit) — confirmed empirically, not assumed, including a second real gotcha caught the same way: Postgres's DELETE privilege model also requires SELECT on any column a WHERE clause references, which the first fixed draft (dedicated role, but SELECT only granted on StudentRank) still missed on the other two tables.

### What this does NOT resolve

Nothing about Decision 245's broader GDPR/LGPD erasure picture (data residency, the full anonymize-in-place design for Transaction/Waiver/Membership/etc., retention periods) — that stays exactly as Decision 245 left it, design-only, pending legal review. No `DELETE /users/me` endpoint exists after this decision either; a future account-deletion job still needs to be built (and legal review completed for the rest of the account) before `GradingErasureService` is ever actually called.

### Built

`apps/api/src/ranks/grading-erasure.service.ts` (new `GradingErasureService`), `apps/api/src/common/prisma/prisma-grading-erasure.service.ts` (new `PrismaGradingErasureService`), `apps/api/src/common/prisma/prisma.module.ts` (registered + exported), `apps/api/src/ranks/ranks.module.ts` (registered + exported, not injected by anything yet), migration `20261115000000_grading_erasure_jobs_grant` (new `ultm8_grading_erasure` role + grants), `DATABASE_URL_GRADING_ERASURE` added to `.github/workflows/ci.yml`, `.devcontainer/docker-compose.yml`, `apps/api/.env.example`. No endpoint, no OpenAPI/`packages/api-client` change.

**Tests:** new `apps/api/test/grading-erasure.e2e-spec.ts` (3 tests, real Postgres — no grading data is a no-op; a full history (StudentRankSkillStatus/PromotionEvent/cascaded PromotionEventNoteLog+SkillSignOffLog, across two disciplines) is hard-deleted; another Student's data at the same School is untouched). Full `apps/api` e2e suite re-run (79 suites/902 tests, zero regressions, including `grading-ready-notification.e2e-spec.ts`'s Decision 178.5 test passing unmodified).

### Recorded by

User, choosing Option B (grading logic only, no endpoint) over building the full `DELETE /users/me` with Decision 245's anonymize-in-place recommendation, after being shown that no account-deletion mechanism exists at all today and that Decision 245 itself says its design isn't authorized to build yet, 15 Oct 2026.

---

## Decision 266 — School-selection UX for Apple 4.2.6/4.3 compliance (Decision 247), built

**Date:** 15 Oct 2026 · **Status:** Approved by product owner, built
**Resolves:** the gap Decision 247 itself explicitly left open — that decision settled the *architecture* (one shared app, no per-tenant App Store listing, a School picked after install) but named the actual School-selection UX, and whether a School gets any visual distinction, as undesigned. `docs/ULTM8-MASTER-ROADMAP.md`'s own synthesis table named this "Product (School-selection UX), then Developer" as the next step.

Three product questions were put to the product owner and answered directly, not inferred:

1. **How does someone find their School?** Both a join-code entry AND a name search — not one or the other.
2. **Does a School get any visual distinction inside the single shared app?** Light theming post-login — a single accent color (and logo) pulled in once a session is scoped to a School, not a full per-School app shell.
3. **Does picking a School gate signup, or come after it?** Pick the School first, then sign up — matches how a join code is handed out at the physical School, and avoids a signed-up-but-schoolless intermediate state.

### What was built

**Backend** (`apps/api`): `School.joinCode` (new, 8-character, unambiguous-alphabet unique code) and `School.accentColor` (new, nullable hex). `joinCode` uses a Postgres-function `@default` (not a constant) specifically so Prisma keeps it OPTIONAL on `SchoolCreateInput` — the alternative (a required field) would have broken every one of the dozens of e2e fixtures across the suite that create a `School` row directly via a raw superuser PrismaClient, bypassing `SchoolsService`. A new, genuinely public (unauthenticated) `PublicAcademiesController` — `GET /public/schools/search?q=` and `GET /public/schools/by-code/:code` — reuses the existing `ultm8_discovery` mechanism (Decision 94) that already powers the authenticated `/academies` discovery routes, rather than a new DB role; that migration's own column-level GRANT on `School` is widened to include `joinCode` (confirmed, not assumed, that a `WHERE` lookup needs SELECT on the column it filters by — same lesson Decision 265's own migration already documented). IP-throttled tighter than the app-wide default, since this is the first genuinely unauthenticated surface in the API. A new Owner-gated `POST /schools/:id/join-code/regenerate` lets a School reset a leaked/shared code.

**Frontend** (`apps/student`): a new `SchoolPickScreen` (search + join-code toggle, one screen, not two destinations) sits ahead of the existing `AuthNavigator` in `RootNavigator`'s now three-way branch, gated on a new persisted `pendingSchoolPick` (AsyncStorage, survives a restart, deliberately NOT cleared by `logout()` — it's intent, not a session artifact). Picking a School only records that intent; `AppNavigator`'s own initial-route logic routes a freshly-signed-in Student with a still-unfinished pick straight to the *existing* `JoinSchoolScreen` (home branch, current belt — Decisions 139/168/209/137/147), which clears the pending pick on success. No new join mechanism was built on the frontend — SchoolPickScreen chooses WHICH School; JoinSchoolScreen (already shipped) does the actual joining.

A new `SchoolThemeProvider`, mounted only inside the authenticated `AppNavigator`, feeds the signed-in Student's School `accentColor` into the shared `Button` component (the single most-repeated accent-colored surface) — deliberately scoped to a Student enrolled at EXACTLY ONE School (Students have no single "active School" concept the way coaches have `activeCoachSchoolId`, per `useEnrolledSchoolIds`'s own long-standing header comment; this item's approved scope didn't ask for one either, so a multi-School Student simply sees the plain default theme rather than an invented "current School").

### What this does NOT resolve

- **`MobileAppPublishingModule`/`packages/build-pipeline` remain fully unbuilt** — this decision is the School-selection UX Decision 247 itself deferred; it does not touch the actual App Store submission pipeline or `skills/ultm8-app-publishing/SKILL.md`'s own flagged "reconciliation pass" against the old per-tenant-app entitlement model.
- **No per-Branch theming** — `accentColor` is School-only, deliberately not mirrored onto `Branch` the way `logoUrl`/`bannerUrl` are (Decision 76's usual mirroring precedent) — nothing in this item's scope asked for it.
- **No "active School" concept for multi-School Students** — a Student enrolled at more than one School sees the plain default theme, not a guessed or forced one. Revisit only if a real need for that concept shows up.
- **Theming is applied to one component (`Button`), not retrofitted across the app** — "light theming post-login" was read as a narrow, bounded touch, not a systemic rewrite of every `theme.fillAccent` call site across the ~28 files that reference the static token file.

### Built

**Backend:** `apps/api/prisma/schema.prisma` (`School.joinCode`, `School.accentColor`), migration `20261115000001_school_join_code_and_accent_color`, `apps/api/src/academies/public-academies.controller.ts` (new), `apps/api/src/academies/dto/school-search-query.dto.ts` (new), `apps/api/src/academies/academies.service.ts` (`search()`, `findByJoinCode()`), `apps/api/src/academies/academies.module.ts`, `apps/api/src/tenants/schools/{create,update,school-response}.dto.ts`, `schools.service.ts` (join-code generation + `regenerateJoinCode()`), `schools.controller.ts`. `packages/api-client` regenerated.

**Frontend:** `apps/student/src/academies/SchoolPickScreen.tsx` (new), `publicSchoolQueries.ts` (new), `apps/student/src/navigation/SchoolPickNavigator.tsx` (new), `RootNavigator.tsx` (three-way branch), `AppNavigator.tsx` (initial-route redirect), `types.ts` (`SchoolPickStackParamList`), `apps/student/src/auth/AuthContext.tsx` (`pendingSchoolPick`), `apps/student/src/academies/JoinSchoolScreen.tsx` (clears the pending pick), `apps/student/src/theme/SchoolThemeContext.tsx` (new), `apps/student/src/components/ui.tsx` (`Button` consumes it). A new global `apps/student/jest.setup.js` AsyncStorage mock was needed — `Button` now transitively imports `AuthContext`, which broke a dozen previously unrelated test suites that had never needed that mocked before.

**Tests:** new `apps/api/test/public-academies.e2e-spec.ts` (6 tests, real Postgres, every request sends no Authorization header); `tenants.e2e-spec.ts` extended (join-code round-trip + regeneration, Owner-only gate). Full `apps/api` e2e suite re-run (80 suites/896 tests, zero regressions). `apps/student`: new `schoolPick.test.tsx` (5 tests), `AuthContext.test.tsx` extended (4 tests covering `pendingSchoolPick` persistence/clear/logout-survival). Full `apps/student` suite re-run (25 suites/135 tests, zero regressions) and `tsc --noEmit` clean on both apps.

### Recorded by

User, answering the three scoping questions directly (join-code AND search; light theming post-login; pick School before signup) after being shown Decision 247's own explicit "undesigned" gap and the concrete engineering tradeoffs (no existing join-code mechanism, no theming infrastructure, no public discovery endpoint) found by direct code research before any of this was built, 15 Oct 2026.

---

## Decision 267 — Three vendor-credential-gated features deliberately deferred to v1.3: push notification delivery, Curriculum video, geocoding/IP-geo

**Date:** 16 Oct 2026 · **Status:** Approved by product owner
**Resolves:** scopes three items this log and `CLAUDE.md` had been tracking as "built but non-functional pending real credentials" — they are not being built further or chased for provisioning in the current version; they're explicitly pushed to the next version.

### Decision

None of these are abandoned — each is fully built on the engineering side and only needs real third-party credentials/provisioning to go live. The product owner chose to defer that provisioning (and any further work gated on it) to v1.3 rather than treat it as current-version blocking work:

1. **Push notification delivery (FCM/APNs)** — `PushNotificationService` and `apps/student`'s device-token registration are built end to end (Decision 223/264); it warns and no-ops without real Firebase/APNs credentials. No further action until v1.3.
2. **Curriculum video (Cloudflare Stream + AWS Transcribe)** — `CloudflareStreamService`/`TranscribeService`, the upload endpoint, `VideoProcessingPollScheduler`, and the full `apps/school-portal`/`apps/student` UI are built (Decision 227/254); unverified only against a live Cloudflare/AWS account. No further action until v1.3.
3. **Geocoding/IP-geo** — the provider is already decided (Google Places, Decision 212; IP-geo itself was separately decided to be skipped entirely, Decision 221) — this was NOT actually an open vendor decision, contrary to how it had been tracked. All that remains is provisioning a Google Cloud API key and then building the Google Places integration itself (never started — no reference to it exists anywhere in `apps/school-portal`/`apps/api` yet). Both the provisioning and the integration work are deferred to v1.3.

### Effect

- `docs/v1.2-backend-backlog.md`, `docs/TRACK-B-ROADMAP.md`, and `CLAUDE.md`'s "Current phase" section should describe these three as "deferred to v1.3," not as open/blocking gaps in the current version.
- "v1.3" here is an informal milestone label the product owner used, the same way `docs/v1.2-backend-backlog.md`'s own filename is informal (`CLAUDE.md`'s Versioning section: version numbers/tags are only ever assigned by the user, and this decision does not create or imply a `v1.3` git tag).
- Does not touch any of this log's other still-open items (#42–44, #47–48 in the session's own task tracking) — those remain separately open, not implicitly deferred by this decision.

### Recorded by

User, choosing to defer all three vendor-credential-gated items to v1.3 rather than continue tracking them as current-version gaps, 16 Oct 2026.

---

## Decision 268 — GDPR/LGPD erasure scope: both jurisdictions, not just one

**Date:** 16 Oct 2026 · **Status:** Approved by product owner
**Resolves:** the market-scope question Decision 245 itself left open ("which specific markets/customers actually require either of these... that's a sales/legal question, not an engineering one").

### Decision

The per-user erasure mechanism (Decision 245's anonymize-in-place design) will be built to satisfy **both GDPR (Art. 17) and LGPD (Art. 18)** from the start, not scoped to a single market first. The two laws share the same practical shape (verifiable, revocable erasure with a carve-out for legal/financial retention obligations), and Decision 245's own design already satisfies both simultaneously — restricting to one market now and generalizing later would redo the same engineering work twice for no savings.

### What this does NOT resolve

This is a scope decision only — it does not authorize building the erasure endpoint itself. Decision 245's own "doesn't authorize building it yet, pending legal review" status is unchanged; this decision just settles which jurisdictions that future build should cover once it is authorized.

### Recorded by

User, approving the Developer's recommendation (build GDPR+LGPD-compatible from the start) after being shown both laws share the same mechanism, 16 Oct 2026.

---

## Decision 269 — Waiver/Transaction retention periods: 7 years for Transactions, age-of-majority+6 for minors' Waivers

**Date:** 16 Oct 2026 · **Status:** Approved by product owner, pending real legal sign-off
**Resolves:** Decision 110's own still-open "Waiver's own retention period is explicitly left open pending real legal input" item, and the parallel Transaction-retention question Decision 245 named but left unanswered.

### Decision

- **Transaction records**: retained 7 years from the transaction date — matches typical payment-processor/tax-authority retention norms.
- **Waiver signatures**: retained 7 years after the signing Student's last activity at the School (departure/archive) for an **adult** signer; for a **minor** (Guardian-signed), retained until the minor's 18th birthday **plus 6 years** — because in most relevant jurisdictions, an injury-claim statute of limitations for a minor doesn't start running until they reach the age of majority, so a flat post-departure window isn't defensible for a minor's own waiver.

**Explicitly not legal advice.** These are directional, market-norm placeholders chosen because something concrete unblocks `EntityOffboardingPurgeProcessor`'s standing Waiver-purge skip (Decision 110 part 4) — a real lawyer should confirm or correct both numbers before they're treated as final, especially the minors figure.

### What this does NOT resolve

Does not itself change `EntityOffboardingPurgeProcessor` — that processor still finds-and-logs-but-never-deletes `Waiver` rows past `purgeAt` (Decision 110 part 4's explicit, named skip). Wiring the processor to actually purge once past this new retention window is a separate follow-up engineering task, not done as part of recording this number. Also does not resolve Decision 245's broader GDPR/LGPD erasure build itself (see Decision 268 above) — this is the retention-period input that build will eventually need, not the build itself.

### Recorded by

User, approving the Developer's recommended figures (7yr Transactions; age-18+6yr for minors' Waivers) after being shown the minors statute-of-limitations issue a flat retention window doesn't account for, 16 Oct 2026.

---

## Decision 270 — RoleGrant authority matrix: Owner/Manager may grant another Owner/Manager; Franchise Owner and direct Student/Guardian grants remain rejected

**Date:** 16 Oct 2026 · **Status:** Approved by product owner
**Resolves:** one edge of the RoleGrant authority matrix Decision 80 left fully open ("every other role/grantor combination... is still genuinely unconfirmed and is rejected (403) rather than built from a guess").

### Decision

Of the three unconfirmed combinations put to the product owner, only one is approved to build:

1. **Approved — a School Owner/Manager may grant another Owner/Manager role within their own School.** A real, common need (co-ownership, succession) scoped to resources the grantor already fully owns — low risk.
2. **Rejected (stays 403) — a Franchise Owner granting roles at its Schools.** A Franchise Owner acting on a School it doesn't directly operate day-to-day is a bigger authority question than this decision was scoped to settle — Decision 80's own standing note ("Franchise Owner granting/approving anything beyond its own resources is genuinely unconfirmed") stands, deliberately not resolved here.
3. **Rejected (stays unbuilt) — a direct RoleGrant-based path to grant Student or Guardian roles.** Students/Guardians already have a working self-service path (join code + registration, Decision 96/266); a second, Owner-initiated path to grant the same role would be redundant complexity with no identified need behind it.

### What this does NOT resolve

The full matrix is still not fully confirmed — only this one additional edge. #2 and #3 above remain explicitly open, not silently decided by omission; a future decision would be needed to revisit either.

### Built

Not yet — this decision authorizes building #1 (`RoleGrantsService.create()`'s grantor/role check needs a new allowed combination added); the actual code change is a follow-up task, not done as part of recording this decision.

### Recorded by

User, approving the Developer's recommendation (approve only the Owner→Owner/Manager case) after being shown the scope risk in the other two, 16 Oct 2026.

---

## Decision 271 — NFR targets: no customer-facing SLA yet; internal engineering bar only (99.5% uptime, p95 < 500ms), revisit once real traffic exists

**Date:** 16 Oct 2026 · **Status:** Approved by product owner
**Resolves:** `docs/ops/NFR-TARGETS.md`'s own named gap — no uptime/SLA, latency, or scale number had ever been set anywhere in this repository.

### Decision

No formal, customer-facing SLA is adopted at this stage — consistent with ordinary pre-launch B2B SaaS practice (a real SLA commitment typically follows real paying customers, not precedes them). Instead, an **internal-only** engineering sanity bar is adopted: **~99.5% uptime, p95 API latency under 500ms** — not published anywhere, not contractual, and explicitly to be revisited with real numbers once there is real production traffic to size against (per `NFR-TARGETS.md`'s own stated reasoning: nothing is deployed yet to validate a number against).

### What this does NOT resolve

Does not set a concurrent-user/throughput budget, an RPO/RTO figure, or a job-queue-latency target — `NFR-TARGETS.md`'s other named gaps stand unchanged. Does not change any `infra/terraform/` default sizing; those remain the "smallest sensible defaults" they already were.

### Recorded by

User, approving the Developer's recommendation (no SLA yet, internal target only) after being shown that nothing is deployed to validate a harder commitment against, 16 Oct 2026.

---

## Decision 272 — Domain-rules terminology: drop the stale "User" CMS label; unify activities/discipline into one controlled list

**Date:** 16 Oct 2026 · **Status:** Approved by product owner
**Resolves:** both terminology gaps `skills/ultm8-domain-rules/SKILL.md` had flagged `[UNRESOLVED]`/`[UNRESOLVED, TERMINOLOGY]`.

### Decision

1. **The "User" grouping label in the translations CMS is dropped.** It never mapped to any real role (Student/School/Admin do) and nothing in the product needs it — an unused label only invites confusion later.
2. **`School.activities`, `Instructor.specializations`, `Class.activities`, and the `Style`/`Discipline` entity should draw from one shared controlled list**, not remain independent free-text-ish fields. Today a School could record "Judo" while a Class spells it "judo" or "Jiu-Jitsu" — this already quietly degrades the search/filter and public-discovery features this session built (Decision 266/Apple-compliance's own search endpoint among them).

### What this does NOT resolve

Item 2 is a scope/direction decision, not a completed migration — reconciling four separate fields/entities into one controlled list is a real schema and data-migration effort (which entity becomes the canonical source, how existing free-text values map onto it, what happens to values that don't cleanly match) that needs its own dedicated design pass before being built, not implied by approving the direction here. Item 1 (dropping the CMS label) is small enough to build directly as a follow-up task.

### Recorded by

User, approving both of the Developer's recommendations (delete the stale label; unify the controlled list) 16 Oct 2026.

---

## Decision 273 — School Portal translation: built-in text with Platform Admin overrides, 15 languages

**Date:** 20 Oct 2026 · **Status:** Approved by product owner
**Resolves:** the School Portal's language picker saved a preference but changed no text (`TopBar.tsx`: "this app has no translation runtime yet"), and Spec 55 §11.1's observed list of 4 languages.

### Decision

1. **Text source: built in, with server overrides.** The portal ships its own text for every language, so it always renders. A row in the existing `Translation` table (edited in the Platform Admin Translations tool) for the same locale replaces the built-in text for that key, mapped as `${screen}.${labelKey}`. A missing translation falls back to English, never to blank text.
2. **15 languages:** English (UK), Portuguese (BR), Spanish, Arabic (the original 4), plus French, German, Italian, Dutch, Polish, Russian, Turkish, Japanese, Korean, Chinese (Simplified) and Thai. Arabic is the only right-to-left language; the portal switches layout direction for it.
3. Non-English text is a first draft and needs a native-speaker review before real users rely on it.

### What this does NOT resolve

The student app (`apps/student`) and Platform Admin are not translated (both deferred for this testing round). Dates and money follow the picked language, except English (UK), which keeps following the browser's own settings and the existing money format as before. Server-generated text is translated on the portal side, not by the API: every API error message is extracted into `apps/school-portal/src/i18n/server/` with a translation per language (an untranslated one shows a translated general message for its HTTP status instead of the English), and the titles and bodies the background jobs write into Notifications are matched and translated the same way. A School's broadcast, which a person wrote, is shown as written. The user asked for nothing to show in English once a language is picked (20 Oct 2026); names the API stores in English (template belt names, generated stripe names) remain data and are not rewritten.

### Recorded by

User (Code), choosing option 1 of two offered (built-in plus overrides vs server-only) and approving the proposed 15-language list, 20 Oct 2026.

---

## Decision 276 — Addresses are structured and country-first (market-standard address form)

**Date:** 21 Oct 2026 · **Status:** Approved by product owner
**Resolves:** every address in the product (School, Branch, Franchise, Instructor profile, and a person's own `User` address) was one free-text box. The product owner asked for addresses to work the way most worldwide apps do: "Let's set it as per market standards, country field etc."

### Decision

1. **Country first, then that country's fields.** Every address form starts with a Country picker; the country decides which of city / state-or-region / postal code are shown, what each is called (ZIP code, Postcode, Eircode, CEP, PIN code; State, Province, County, Emirate, Prefecture…), which are required, and what a valid postal code looks like. Countries with a short fixed list of regions (US, CA, AU, AE, BR, MY) get a dropdown. The rules follow the per-country address metadata Google publishes for its own address forms (libaddressinput), hand-trimmed for ~45 countries covering the platform's launch currencies; every other country gets a forgiving default (street and city required, region and postal code optional, no format check), so no country is ever blocked. The country defaults to the browser's locale (a new Branch defaults to its School's country).
2. **Stored as structured columns, with the old text kept in step.** `User`, `Franchise`, `School`, `Branch` and `Instructor` each gain `addressLine1`, `addressLine2`, `addressCity`, `addressRegion`, `addressPostalCode`, `addressCountry` (ISO 3166-1 alpha-2). The existing `address` column stays and is rebuilt by the API as one line in the country's own order ("Unter den Linden 1, 10117 Berlin, Germany") whenever the structured fields are written, so every existing reader — Academies discovery, the School footer, platform-admin, `apps/student` — keeps working unchanged.
3. **API contract.** Write DTOs take a nested `postalAddress` object (`null` clears the address). The API enforces the same per-country rules as the form and answers 400 naming the field (`postalAddress.postalCode …`). The legacy `address` string is still accepted (`apps/student`'s profile and registration still send it); it clears the structured columns so the two can never disagree. Responses carry the six flat columns next to `address`.
4. **Existing data is not rewritten.** The migration is purely additive. A record saved before this decision keeps its text; the School Portal shows it in line 1 with a note and asks for the country the next time someone edits it. An untouched legacy address is left out of the save, so it never blocks editing the rest of a form.
5. **One shared rule file.** `packages/ui/src/postalAddress.ts` (pure TypeScript) is used by the portal; `apps/api/src/common/address/postal-address.ts` is a byte-identical copy (apps/api doesn't import workspace packages), and a unit test fails if they drift.

### What this does NOT resolve

- **Google Places autocomplete** (Decision 212) is still not connected: it needs a Google Cloud API key with the Places API enabled, which hasn't been provisioned, and it stays deferred to v1.3 (Decision 267). `AddressFields` already accepts an `autocomplete` provider (suggest + resolve), so connecting Places means writing that one adapter and passing it in — no form or API change.
- **`apps/student`** (Track B) still uses its own single address field; it keeps working through the legacy `address` path. Bringing the country-first form to the mobile app is separate work.
- The form's text is English, collected in one `ADDRESS_TEXT` object so the translation layer (Decision 273) can supply translations through the `text` prop.

### Recorded by

User ("Let's set it as per market standards, country field etc."), 21 Oct 2026, after the recommendation to follow the Shopify/Stripe/Airbnb country-first pattern.

---

## Decision 277 — Notifications: users can Delete one or "Clear all read"; a soft delete that keeps the record

**Date:** 21 Oct 2026 · **Status:** Approved by product owner
**Resolves:** the Delete item `docs/v1.2-backend-backlog.md` ("Notifications page") still listed as open, and Decision 242's note that Delete was out of scope. **Amends Decision 244** (no delete): the record-keeping half of 244 stands, the "never user-deletable" half does not.

### Decision

1. Each notification's ⋮ menu on the School Portal Notifications page gets **Delete** (with a confirmation), and the page header gets **Clear all read**, which removes every notification the user has already read. Unread notifications are never touched by Clear all read, snoozed or not.
2. Both are a **soft delete**: a new `Notification.deletedAt` column is set and the row is hidden, never erased. Payment, waiver and other alerts stay on record, which is the part of Decision 244 that still holds. There is still no hard delete: `ultm8_app` has no DELETE grant on `Notification`, and none is added.
3. API: `DELETE /notifications/:id` (204, self-only, a 404 for someone else's row or one already deleted) and `POST /notifications/me/clear-read` (returns `{ cleared }`). A deleted notification leaves `GET /notifications/me` and the Total/Unread counts of `GET /notifications/me/counts`, and `PATCH :id/read` / `PATCH :id/snooze` on it are a 404.
4. The Read-within-24h metric keeps counting deleted notifications that were read. They were read, and otherwise every Clear all read would reset that metric to empty. A Developer-level choice, flagged here for review.

### What this does NOT resolve

- No restore/undo, and no "deleted items" view. Nothing reads a deleted row back today; an admin-facing view or a restore action would be a new decision.
- No automatic clean-up of old notifications (other products clear them after 30 to 90 days). Not requested.
- `apps/student` gets the API behaviour (deleted rows disappear from its list too) but no Delete button of its own yet.
- The new School Portal text (Delete, Clear all read, the two confirmations and their error messages) is English only until the translation layer (Decision 273, PR #266) merges; it then needs adding to that catalogue.

### Recorded by

User ("Go for the notification change"), approving the recommendation to add Delete and "Clear all read" as a hide-not-erase soft delete, 21 Oct 2026.

---

## Decision 278 — Global Search in the School Portal header: names across five types, through each type's own list endpoint

**Date:** 21 Oct 2026 · **Status:** Approved by product owner
**Resolves:** §A of `docs/decisions/DRAFT-global-search-and-footer-scoping.md` (the header's disabled "Search (coming soon)" box, `v1.2-backend-backlog.md`'s "Global search" item), including its three open questions.

### Decision

1. **Scope: option (a).** One header box searches Students, Instructors, Classes, Branches and Franchises. Results are grouped by type, up to 5 per type, and each opens that record's existing page (`/students/:id`, `/instructors/:id`, `/classes/:id`, `/branches/:id`, `/franchises/:id`).
2. **Match: case-insensitive substring on names only.** Students and Instructors: first name, surname, or the full name "first surname" ("jo" finds "John"). Classes: title. Branches and Franchises: name. Never email or phone. The box waits for 2 characters and 250 ms after the last keystroke.
3. **Who sees what: the sidebar's own rule.** A type is searched only if the person's sidebar offers its page (`Shell.tsx`). Today that means School Owners/Managers get all five, and a coach or Branch Staff member who doesn't own the School (`COACH_NAV`) gets none, so the box isn't shown to them. Separately, the server still applies each list endpoint's own, unchanged authorization: the search can only narrow a list the caller could already read.
4. **Archived records are excluded.** Students, Instructors, Classes and Branches already leave them out by default (Decision 226's `archivedAt`; for Students, the roster's default "Active" filter). `GET /franchises` lists closed (archived) Franchises by default, and that default is unchanged; it gains an optional `excludeArchived` param (default `false`, parsed as an explicit `true`/`false`), which the search box sends so the server leaves closed Franchises out. The open question the draft parked on Decision 226 is answered by what Decision 226 actually shipped.
5. **Backend: approach 2, no new endpoint.** `GET /schools/:id/students`, `GET /schools/:schoolId/instructors`, `GET /schools/:schoolId/branches` and `GET /franchises` gain an optional `search` param, the same shape `GET /schools/:schoolId/classes` already had (at most 200 characters); on all five it is trimmed and blank means no filter (Classes' `search` gained the same trimming). Branches, Franchises and Classes add one Prisma `contains` + `mode: 'insensitive'` condition to their existing RLS-scoped query, with `%`, `_` and `\` escaped first (`escapeLike`), so those characters match themselves rather than acting as LIKE wildcards. Students and Instructors names live on `User`, whose RLS visibility doesn't cover every row these lists show (Decision 117), so their match runs on the rows the endpoint has already authorized: the Students roster is filtered after its unchanged query; for Instructors, the unchanged scoped query gives the profiles' user ids, `resolveUserNames` reads the names of exactly those ids, and the matching ids become one more condition on the paginated query. The portal fires the five requests in parallel.

### Relation to Decision 116

Decision 116 chose "exact email or phone match only, never a name search" for the Staff invite lookup, which reads Users the caller has no relationship with yet. That stays as it is. This decision allows name search **only inside lists the caller can already see at their own School** (and the Franchises they own); it is never a lookup across tenants or of Users outside those lists.

### What this does NOT resolve

No search over other records (Curriculum, Membership Plans, Transactions, Waivers), no fuzzy or accent-insensitive matching, and no search for coaches or Branch Staff: if their sidebar gains any of these pages, the box should follow it. Only Franchises the caller owns are ever listed.

### Recorded by

User (product owner), agreeing to the recommended option (a) with approach 2, substring name matching, sidebar-mirroring role scoping and archived records excluded, 21 Oct 2026; built the same day.

---

## Decision 279 — New Schools start with a 60-minute waitlist claim window (was 120)

**Date:** 21 Oct 2026 · **Status:** Approved by product owner
**Changes:** the default Spec 55 §6.1 / domain rules §10 give for `School.waitlistClaimWindowMinutes` (120 minutes). The product owner changed it directly; this is a default value only, not a change to how the waitlist works.

### Decision

New Schools default to **60 minutes**. Only one person is offered a freed seat at a time, so a shorter window lets more people on the list get a chance before class (a seat freed four hours before class reaches up to four people instead of two). It isn't shorter because students are told only in the app until push/SMS delivery is live (Decision 267); revisit 30 minutes once it is.

Existing Schools keep the window they already have (the migration changes the column default only), and owners can still set any value of 1 minute or more on the School page. The deadline is still capped at the class start time.

### Recorded by

User, approving the recommendation of 60 minutes ("go for it .. and then merge it"), 21 Oct 2026.

---

## Decision 280 — Brazilian Jiu-Jitsu: Kids and Adult on one linked ladder, split by an editable age (default under 16)

**Date:** 21 Oct 2026 · **Status:** Product-owner decision · **Resolves:** how kids move up to the adult belts, and how the Grading Board separates them (raised while reviewing the New Portal grading screens)

### Decision

1. **One linked ladder.** Kids and Adult are not separate styles. A Brazilian Jiu-Jitsu style keeps the one ladder the IBJJF templates already build (Decision 131): White Belt, the kids belts (Grey/White to Green/Black), then the adult belts.
2. **Kids are split by age.** A student under the style's **"Kids until age"** is Kids; from that age they are Adult. The default is **under 16** (the IBJJF adult age). It is a setting in Grading → Settings (and Settings → Grading), and coaches can change it as well as the owner. The product owner's words: *"THE UNDER 16 RULES, however coaches will be able to edit the age too"*.
3. **The Grading Board shows a Kids · Adult switch** inside the style.
4. **Kid → Adult is a normal promotion, with a nudge.** Nothing moves on its own. When a student on a kids belt reaches the age, they show under Adult with a **"Ready for Adult belts"** tag. The coach promotes them as usual and picks the adult belt in "Promote to" (e.g. Green Belt → Blue Belt). It is recorded on the history like any grade.
5. **Adults skip the kids belts.** For an Adult student, the next rank after White Belt · 4 Stripes is **Blue Belt**, not Grey/White Belt, and it is not recorded as a skip.

### Effect

Needs a schema and engine change: the age on the style, a "kids belt" flag on a belt, and the next-rank rule in item 5. See `docs/v1.3-backend-backlog.md` §3.20.

### Still open

- **Which coaches can change the age.** Is it any coach with grading access, or a new permission on the Permissions page?
- **Which rank's requirements apply when a grade skips ranks.** The built API hard-blocks a skip when the next rank's required skills aren't signed off. It doesn't say whether the target rank's own requirements apply.

### Recorded by

User, answering the Kids/Adult questions on the New Portal grading screens, 21 Oct 2026.

---

## Decision 281 — Kids and Adult stay separate programs; a Kids student can be graded into the Adult program (corrects Decision 280)

**Date:** 21 Oct 2026 · **Status:** Product-owner decision · **Supersedes:** Decision 280 items 1, 2 and 5

Decision 280 combined Kids and Adult into one linked ladder. That was a misreading. The product owner's words: *"before we have the kids and the adult program separate, this is correct. What I did ask was to be able to grade from kids to adult, not to combine them."*

### Decision

1. **Two separate programs.** Each has its own ladder:
   - **Adult:** White, Blue, Purple, Brown, Black.
   - **Kids:** White, then the kids belts.
   
   Both programs sit under one discipline, Brazilian Jiu-Jitsu. Screens show them as a **Kids · Adult** switch next to the discipline.
2. **Grading Kids → Adult.** For a Kids student, "Promote to" lists their next kids ranks, then an **"Adult program"** group with the adult ranks. Picking an adult rank moves the student to the Adult program at that rank. Their history records **"Moved to Adult program"**. This works from the board (single and bulk) and from the Ranks tab.
3. **The age setting is only a reminder** (Decision 280 items 2 and 4, reworded). From **"Ready for Adult from age"** (default 16, editable by the owner and coaches), a Kids student gets the **"Ready for Adult program"** tag. Nothing moves on its own.
4. **Decision 280 item 5 is withdrawn.** It existed only because of the combined ladder.

### Still open

- **The default adult rank** for a kid at the top of the kids ladder. The sample uses the first adult rank above White Belt (Blue Belt). This is a placeholder, not a confirmed rule.
- **Whether a coach may grade a kid into Adult before the age.** The design allows it, because the age is only a reminder. Confirm.
- **What carries over on the move.** This covers classes, skills and history. The design treats it like any grade: counting restarts, sign-offs are wiped (Decision 128 item 16) and history is kept.
- Decision 280's open item on which coaches can change the age.

### Recorded by

User, correcting the combined ladder on the New Portal grading screens, 21 Oct 2026.

---

## Decision 282 — Bulk promote has no limit a coach can see; the portal sends 200 at a time

**Date:** 21 Oct 2026 · **Status:** Product-owner decision · **Builds:** Spec 55 Section 7 (bulk-grading batch cap), Decision 130

The stress test (20 academies, 300–500 students, 50–90% graded at once) found the School Portal sent every ticked student in one request. Over 200 students, the API refused the whole batch. The product owner asked: *"Since when we have limit, who has agreed with that, we should not have a limit."*

Where the 200 came from: Spec 55's logic review of 27 Aug 2026 put a fixed cap on each bulk-grading **request** (e.g. 200 students), *"with the School Portal client batching sequential calls beyond it"*. Decision 130 repeated the cap. The cap was always meant to be per request, never a limit for the coach. The portal never did the batching.

### Decision

1. **No limit for the coach.** A coach can tick and promote any number of students in one go.
2. **The portal sends them 200 at a time**, one request after another, and joins the answers. The check before promoting (the dry run) works the same way. The API keeps its 200-per-request guard.
3. **If a later batch fails**, the students the earlier batches promoted stay promoted. The window says *"Promoted N of M, then something went wrong"* and the report lists the ones done.

### Recorded by

User, replying to the grading stress-test findings, 21 Oct 2026.

---

## Decision 283 — Only active students are graded up; unverified students can still be graded

**Date:** 21 Oct 2026 · **Status:** Product-owner decision

The stress test showed inactive students could be ticked and promoted. Asked whether they should be, the product owner said: *"No, only active students"*. Asked the same about students whose rank is self-declared and not yet verified: *"Yes, because grading is a human decision done by the coach"*.

### Decision

1. **Active means** what the Grading Board already shows (Decision 152): the student's **Active switch** on the board if a coach has set it, otherwise **a live membership** at the School.
2. **Promote and stripe award need an active student.** This covers a single grade and bulk promote. Bulk promote lists an inactive student under "can't be promoted" (*"inactive (only active students can be graded)"*) and skips them. A single grade is refused with *"Only active students can be graded. Make the student active on the Grading Board, or give them a live membership."*
3. **The board does not let an inactive student be ticked.** Their tick box is off, with the reason.
4. **Moving a student down is still allowed** when inactive. It is a correction, not a grade up.
5. **Unverified (self-declared) students can be graded.** No change: grading never checked verification.
6. **A first rank can be given to an inactive student.** For a student with no rank in the style yet, "Give first rank" records the belt they start at; it is not a grade up. The product owner confirmed: *"yes"* (21 Oct 2026).

### Recorded by

User, replying to the grading stress-test findings, 21 Oct 2026.

---

## Decision 284 — A bulk promote that stops part-way can be finished safely

**Date:** 22 Oct 2026 · **Status:** Product-owner decision · **Builds on:** Decisions 130, 185 and 282

Since Decision 282 the portal sends a large batch 200 students at a time. If something breaks part-way (the connection drops, the server restarts), the groups already sent stay promoted and the rest are not. Three fixes were offered: a "try the rest" button, all-or-nothing (which needs Spec 55's per-request cap changed), or undoing the part that went through. The product owner chose the first: *"go with A, build it"*.

### Decision

1. **One automatic retry.** A group that gets no answer (no reply, or a server error) is sent once more on its own after a short pause. A refusal (4xx, e.g. too many requests) is not retried automatically.
2. **"Try the remaining N again".** If the retry also fails, the window says *"Promoted 200 of 450, then something went wrong. The rest were not promoted yet."* It offers **Try the remaining N again**, which sends only the students not yet promoted, and **Stop here and see the report**, which lists them as *"not promoted: the batch stopped before them"*.
3. **Never promoted twice.** With each student, the portal sends the rung the check found them on (`expected`). A student who has moved since is skipped, not promoted again: *"already promoted since the check"* (one rung up, e.g. a batch whose reply was lost) or *"rank changed since the check"* (anything else). This is the same guard a single grade already has (Decision 185). It makes every retry safe.
4. **Fewer checks.** Removing a student from the batch no longer re-checks the whole batch, because each student's check stands on its own. Only a date change, or a failed check, runs it again. This keeps a large batch inside the bulk endpoint's limit of 30 requests a minute, which is unchanged.

### Recorded by

User, choosing option A for a batch that stops part-way, 22 Oct 2026.

## Decision 291 — Class cancellations: owner-chosen settings, cancel a whole class, and a staff "to resolve" list

**Date:** 21 Oct 2026 · **Status:** Approved by product owner
**Resolves:** `School.classCancellationPolicy` (Manual / Auto-refund / Auto-credit, domain rules §7) was saved but never read; a cancellation only ever followed the class's own refund cutoff. Questions 2–5 of item 2 in the "discuss with Gus" list.

### Decision

The product owner chose to make every open question a School setting the academy owner picks, not a fixed rule, and asked for the field to stay visible. The School page gets a "Class cancellations" section (defaults in brackets):

1. **Policy** — Manual / Auto-refund / Auto-credit (Manual, unchanged).
2. **When it applies** — only before the class's cutoff / any time (before the cutoff). Past the cutoff under "before the cutoff", the seat is kept, as before.
3. **Late fee after the cutoff** (Decision 234) — charge / don't charge (charge).
4. **When the School cancels a whole class** — refund everyone / give everyone their credit back / follow the policy (credit back). The cutoff and late fee never apply here; the student didn't cancel.
5. **Default cutoff, hours before class** — used for a class with no cutoff of its own (none).
6. **No-show fee** — charged to the Student's saved card by the no-show sweep, the same way as the late fee (off).

Two rules stay fixed, from the spec, and are explained on the page rather than offered as settings: a Friend Pass always gets its credit back (§7), and only a School Owner/Manager can send money back (§8.2). A refund a Branch Staff member or Instructor would trigger waits as PENDING for an Owner/Manager.

Built alongside it: a **Cancel class** action (Owner/Manager or that branch's Branch Staff; Instructors can't) with an optional reason sent to everyone booked or waitlisted; a **Cancellations to resolve** page listing seats waiting for a decision or a cash/bank refund still owed, where the Owner/Manager can Refund, Give credit back, Keep, or Mark refund paid (Branch Staff: Give credit back or Keep); and in-app alerts to Owners/Managers when something lands there.

### How a refund is worked out

Recommendations the product owner accepted by default (21 Oct 2026, "use your recommendations unless I say otherwise"):

- Money only goes back for a **Class Pack**: one class's share of what was paid, cumulative and rounded once (§7). A Subscription, Weekly Pass or Trial booking has no per-class price, so it falls back to the credit (nothing to give back for general access). A pack with no payment behind it falls back to the credit too.
- **Card** payments are refunded through Stripe after the cancellation commits (idempotency key per seat); a failure leaves the seat PENDING for staff. **Cash/bank** payments become **REFUND_OWED** until an Owner/Manager marks them paid.
- A payment under dispute is frozen (Decision 55/111): the seat waits for staff.
- `RefundResolution` keeps `REFUNDED` meaning "credit back" (so existing rows stay right) and adds `PENDING`, `MONEY_REFUNDED` and `REFUND_OWED`.

### What this does NOT resolve

- Existing Schools: see Decision 292 (they move to Auto-credit, today's behaviour, until their owner chooses).
- The new text has first-draft translations in all 14 languages (Decision 273) that need a native-speaker review. Student notifications are in-app only (push is deferred, Decision 267).
- Later ideas not built: stopping students cancelling close to class time, and a monthly limit on late cancellations.

### Recorded by

User (Code), 21 Oct 2026: "this must in setting for the academy owners to choose", "These all decisions should be for the academy owner", approving the proposed layout and asking for a deeper comparison before building.

## Decision 292 — Each Branch can use its own class cancellation settings; every owner chooses their policy

**Date:** 22 Oct 2026. **Builds on:** Decision 291.

### What was decided

- A **Branch** can use its own "Class cancellations" settings instead of its School's: the same six settings as Decision 291 (policy, when it applies, default cutoff, late-fee switch, no-show fee, what happens when the school cancels a whole class). The default is **"Same as the school"**.
- A class held at a Branch with its own settings follows that Branch for a student's cancellation, a whole-class cancel and the no-show fee. A class with no Branch ("Whole School"), or at a Branch set to "Same as the school", follows the School.
- Only the School Owner/Manager edits a Branch's settings, on the Branch's settings page (the same permission as every other Branch field, Spec §8.2). Choosing "This branch's own settings" starts from the School's current values.
- **Existing Schools** move to **Auto-credit**. Until now every cancellation before the cutoff gave the class credit back whatever the stored policy said, because the policy was never applied, and Auto-credit is exactly that, so nothing changes for their students. The owner then chooses: the dashboard and the School page ask "Choose your cancellation policy" until the owner saves one (`School.cancellationPolicyChosenAt`). New Schools still start on Manual and see the same prompt.
- The fixed rules from Decision 291 still hold at every Branch: a Friend Pass always gets its credit back, and only an Owner/Manager can send money back.

### Why

The owner wanted each Branch to be able to differ ("Each branch can differ" on the decision card) and wanted owners, not a migration, to make the choice ("I want to let owner of the branch choose this").

### Recorded by

User (Code), 22 Oct 2026, choosing "Each branch can differ" on the decision card, after: "I want to let owner of the branch choose this".

### How it fits with Decision 322 (merged in 26 Oct 2026)

Decision 322 reached `master` while this was open. Both now apply, in this order, when a student cancels:

1. A Class that has ended can't be cancelled unless the School's late-cancellation setting is "Always refund" (Decision 322).
2. After the Class has started, "No refund once started" keeps the credit spent, whatever the cancellation policy says (Decision 322).
3. Otherwise the cancellation policy and its window decide (Decisions 291/292). The late fee still needs the Class's cutoff to have passed and the late-fee switch on.

When the School cancels Classes by switching off or moving a timetable slot (Decision 322), the credit always comes back and no fee is charged. The "What students get when the school cancels a class" setting covers only the **Cancel class** button on a Class's page. `lateCancelRefundPolicy` stays a School-wide setting; it is not one of the per-Branch settings.

---

## Decision 285 — Kids → Adult: the four open questions answered (completes Decision 281)

**Date:** 22 Oct 2026 · **Status:** Product-owner decision · **Answers:** Decision 281 "Still open" (all four) · **Changes:** Decision 281 item 3

### Decision

1. **The first adult rank is Blue Belt.** A Kids student at the top of the Kids ladder goes to Blue Belt on the Adult ladder. The product owner: *"Yes from Blue"*.
2. **The age is a rule, not only a reminder.** A coach can grade a kid into Adult from the School's "Ready for Adult from age" (default 16, the IBJJF age). To do it earlier, the School changes that age in its grading settings first. The product owner: *"Yes but they will need to change the settings, however 99.99% of the academies around the world will follow the IBJJF rules, but still they can change it"*. This replaces Decision 281 item 3 ("the age setting is only a reminder").
3. **Everything carries over, except the class count.** History, notes and skill sign-offs move with the student to the Adult ladder. Only the class count toward the next rank starts again from zero. The product owner: *"Everything, however it sets the class count from zero"*. This is an exception to an ordinary grade, which clears sign-offs (Decision 128 item 16).
4. **Who may change the age:** the School owner and anyone granted the grading settings right. The product owner: *"who has been granted grading settings rights"*. Today the closest right is "Change board %" (`canChangeBoardThresholds`). There is no "grading settings" right yet.

### Still open

- **Name and scope of the grading settings right.** Either rename and widen "Change board %" into "Change grading settings" (board %, Ready for Adult age, promotion fee switch), or add a new right next to it. Confirm.
- **Which skill sign-offs carry over** when the Adult ladder's skills differ from the Kids ladder's. A sign-off is on a skill; if the same skill is on the Adult rank, it counts. Confirm.

### Recorded by

User, answering Decision 281's open questions, 22 Oct 2026.

---

## Decision 286 — Students can ask the School to correct their belt

**Date:** 22 Oct 2026 · **Status:** Product-owner decision · **Confirms:** v1.3 backlog §3.13 (MS6a, Q38)

### Decision

1. **A student can request a correction** when their recorded belt is wrong. The product owner: *"yes if there is mistake"*.
2. **Students still can't change their own rank.** Only coaches promote (Decision 124 onward). The request goes to the School.
3. **A coach approves or rejects it.** An approval goes through the normal grading path, so the history shows the correction and who made it.

### Still open

- **Who reviews a request:** the owner and coaches with "Verify ranks" (`canVerifyRanks`), as for self-declared belts (Decision 137)? Confirm.
- **What a student can request:** any rank on the ladder, or only a fix of the current one.

### Recorded by

User, 22 Oct 2026.

---

## Decision 287 — Promotion fee: a switch in the grading settings

**Date:** 22 Oct 2026 · **Status:** Product-owner decision · **Answers:** v1.3 backlog §5.12 (PR16, Q33), in part

### Decision

1. **Each School chooses whether a promotion has a fee.** It is a switch in the grading settings, off by default. The product owner: *"We will be on the grading setting a toggle for fee on or off"*.
2. With the switch off, nothing changes. Decisions 162/163 (the grading-day pass) are not affected.

### Still open `[UNRESOLVED]`

- **The amount:** one fee, or a fee per rank or per belt?
- **When it is charged, and how:** at promotion, automatically through the student's saved card? Or added to their balance? (Staff-created charges are themselves still open, v1.3 §3.6.)
- **Whether an unpaid fee blocks the promotion,** and who pays for a child (the Guardian).
- **Does a stripe count,** or only a new belt? And does a bulk promote charge each student?

Don't build the charge until these are answered. The switch itself can be built.

### Recorded by

User, 22 Oct 2026.

---

## Decision 288 — Attendance hours can count toward grading

**Date:** 22 Oct 2026 · **Status:** Product-owner decision · **Answers:** v1.3 backlog §5.5 (A8, Q51), in part

### Decision

1. **ULTM8 tracks attendance hours as well as classes.** The product owner: *"We can count that too, it is a great idea"*.
2. **Hours can be a grading requirement,** alongside classes and days at the rank.

### Still open `[UNRESOLVED]`

- **Where hours come from:** the class's scheduled length, or the real check-in and check-out time?
- **How a rank uses them:** hours instead of classes, or as well as classes, chosen per rank?
- **Whether open mat counts** (v1.3 §5.9 is still open).

### Recorded by

User, 22 Oct 2026.

---

## Decision 289 — Skipping ranks keeps the next rank's checks

**Date:** 22 Oct 2026 · **Status:** Records the product owner's 21 Oct 2026 rule · **Answers:** Decision 280's open question

When a coach grades a student past more than one rank (e.g. White Belt · 2 Stripes straight to Blue Belt), the checks of the **next** rank still apply. "Skills required" still blocks, and missing skills or days short still need the "Needs a look" acknowledgement. Skipping can't be used to get round them. This is how the API already works (`changeRung`). The product owner set it after the grading stress test, 21 Oct 2026 (*"fix it"*). It is in DESIGN.md (Grading screens), and this entry puts it in the log.

### Recorded by

User, 21 Oct 2026; logged 22 Oct 2026.

---

## Decision 290 — Ranks without a belt: Levels (No-Gi)

**Date:** 21 Oct 2026, logged 22 Oct 2026 · **Status:** Product-owner decision · **Confirms:** v1.3 backlog §3.19 (it was flagged "NEEDS A DECISION ENTRY")

The product owner set this on 21 Oct 2026 for the New Portal grading screens. It was written into the v1.3 backlog and DESIGN.md, but never logged.

### Decision

1. **Each style shows its ranks either as Belts or as Levels (no belt),** never a mix. The setting is "Ranks shown as" in Grading → Settings.
2. **A level is a coloured badge.** The School picks the colour.
3. **A level has numbered steps** (Beginner 1, 2, 3), each with its own requirements, like stripe grades.
4. **Grading itself doesn't change.** Steps are rungs. Requirements, progress, the board, promote, bulk promote and history work as they do for stripes. Only how a rank is stored and shown changes.

### Recorded by

User, 21 Oct 2026; logged 22 Oct 2026.

## Decision 295 — One email, one account, whatever the capitals

**Date:** 22 Oct 2026 · **Status:** Bug fix the product owner asked for · **Builds on:** Decisions 116 and 251

The Staff page review (bug B1/B2) found that emails were matched letter for letter, capitals included. An owner could "Add staff manually" with `jane@gym.com` for someone already registered as `Jane@Gym.com` and get a second account for the same person, the exact thing Decision 116's existing-email check exists to stop. "Find" on the Staff page also missed people when the capitals differed. The product owner asked for B1–B8 to be fixed: *"deep dive and find best solution for bugs from B1 TO B8 and start fixing them"*.

### Decision

1. **Every email that creates or finds a User is trimmed and lower-cased** before anything else looks at it (`NormalizeEmail`, on the register, login, Staff Add Manually, Instructor Add Manually, invite-candidate and coach-invite inputs). Signing in works whatever capitals are typed. The passcode reset is by phone, so it is unaffected.
2. **Existing accounts are brought into line** by migration `20261123000000_user_email_case_insensitive`: each email whose lower-case form no other account holds is lower-cased.
3. **The database refuses a second account that differs only by case** (unique index `User_email_lower_key` on `lower(email)`). If a database already holds two real accounts that differ only by case, the migration leaves both alone and skips the index, with a warning naming how many there are; a person merges them and a later migration adds the index. The API's lower-casing stops new ones either way.

Platform Admin accounts (`AdminUser`, a separate realm) are not changed by this decision.

### Recorded by

Claude, from the Staff page review, fixing bugs B1 and B2 at the product owner's request, 22 Oct 2026.

## Decision 296 — Staff page fixes: archived branches, closed Schools, and the page itself

**Date:** 22 Oct 2026 · **Status:** Bug fixes the product owner asked for · **Builds on:** Decisions 110, 183, 193, 226 and 251

The rest of the Staff page review's bugs (B3–B8), fixed together at the product owner's request.

### Decision

1. **No new staff or coaches at an archived Branch (B3).** Granting Instructor or Branch Staff, Add Manually and sending a coach invite all refuse a Branch that is archived ("This branch has been archived. Choose another branch."). A coach invite sent before its Branch was archived stops working: its page shows it as cancelled and accepting it is refused (`coach_invite_by_token()` now also returns `branchArchived`). Before, all of these went through, and a new role grant at an archived Branch would have blocked its 90-day purge. Hiding archived Branches in the pickers is Decision 293's (PR #275); this is the server-side half.
2. **"Who can invite coaches" stays current (B4).** Granting, adding or removing Branch Staff on the Staff page refreshes that list straight away. Before, it needed a page reload.
3. **Revoke asks first (B5).** "Remove the {role} role from {name}?", saying that the role ends now and that removing their last coach or staff role clears their grading permissions and "Can invite coaches" (Decision 193).
4. **Branch names, not ids (B6),** in the "Look up a user's grants" table.
5. **No role grants at a closed School (B7).** Inviting an existing account to a role now refuses a closed School, as Add Manually already did (Decision 110).
6. **No blank page (B8).** Anyone but the School owner who opens `/staff` is sent to their own home screen (the coach dashboard for Branch Staff and coaches).

### Not decided here

The review's other notes (the "Send invite" wording, the 15-minute delay before a removed role takes effect, co-owners who can't be removed, blank names on Add Manually) and the missing Staff features (a staff list, edit, deactivate) are product questions, put to the product owner separately.

### Recorded by

Claude, from the Staff page review, fixing bugs B3–B8 at the product owner's request, 22 Oct 2026.

---

## Decision 297 — "Change grading settings" replaces "Change board %"; the promotion fee switch is owner-only

**Date:** 22 Oct 2026 · **Status:** Product-owner decision · **Answers:** Decision 285 "Still open" (the grading settings right)

### Decision

1. **The coach right "Change board %" (`canChangeBoardThresholds`) becomes "Change grading settings".** It still works per coach and per style. It now covers everything on Grading → Settings for that style: the board %, "Ranks shown as" (Belts or Levels), the Ready for Adult age and the other per-style grading settings. Coaches who have "Change board %" today keep it under the new name.
2. **The School-wide promotion fee switches are owner-only** (see Decision 300): no coach right covers them.

The product owner chose option A: *"A, and yes fee switch owner only"*.

### Recorded by

User, 22 Oct 2026.

---

## Decision 298 — Kids → Adult: skill sign-offs carry over by matching name

**Date:** 22 Oct 2026 · **Status:** Product-owner decision · **Answers:** Decision 285 "Still open" (which sign-offs carry over)

Kids and Adult are separate ladders, so each has its own skills; a Kids "Armbar" and an Adult "Armbar" are two different skills.

### Decision

1. When a kid is graded into the Adult program, **each Kids skill they had signed off counts as signed off on the Adult ladder if the Adult ladder has a skill with exactly the same name.**
2. Kids sign-offs with no matching Adult skill stay in the student's history, still visible, but don't count toward Adult ranks.

The product owner chose option A (match by name).

### Recorded by

User, 22 Oct 2026.

---

## Decision 299 — Belt correction requests: who reviews, and what can be asked

**Date:** 22 Oct 2026 · **Status:** Product-owner decision · **Answers:** Decision 286 "Still open"

### Decision

1. **Reviewers:** the School owner, and coaches who have **"Verify ranks"** for that style and cover the student's branch. These are the same people who verify the belts students declare when they join (Decisions 137, 147, 189).
2. **What a student can ask for:** any rank on that style's ladder, e.g. "my belt shows Blue, but I'm Purple · 2 Stripes". **A short note explaining why is required.**

The product owner chose A and A.

### Recorded by

User, 22 Oct 2026.

---

## Decision 300 — Promotion fee: prices per grade, the student accepts before paying, and an owner switch for grading before payment

**Date:** 22 Oct 2026 · **Status:** Product-owner decision · **Answers:** Decision 287 "Still open"

### Decision

1. **The fee is per grade.** With the promotion fee switch on (Decision 287), the owner can set a price on any belt and on any stripe grade. **A grade with no price is free.** Stripes are free unless the owner prices them.
2. **Nothing is charged directly.** At grading, a fee request appears in the student's account (the Guardian's, for a child). The student or Guardian **accepts** it, and only then is it charged, by saved card or as the school takes payment.
3. **A new owner switch in grading settings: "Allow grading before the fee is paid".**
   - **On:** the promotion happens straight away and the fee request waits. If the student declines, the owner sees **"Fee declined"** on the student and sorts it out with them. The promotion stays.
   - **Off:** the promotion waits, shown as **"Waiting for fee"** on the board, and goes through only once the fee is accepted and paid. If the student declines, nothing changes and the owner sees "Fee declined".
   - With no answer, the request stays open.
   - **The owner can waive or cancel a fee at any time.** Waiving a waiting promotion applies it straight away.
4. **The grading date** on the history is the date the coach chose when grading, not the date the fee was paid.
5. **Children:** the Guardian accepts and pays, as for the child's other payments.
6. **Bulk promote:** each promoted student gets a request for their own grade's fee.
7. **Owner-only:** the promotion fee switch, the "Allow grading before the fee is paid" switch and the prices (Decision 297 item 2).

- **How an accepted fee is paid:** as a charge on the member's balance, payable in the app or at the desk (Decision 303).

### Recorded by

User, answering one by one, 22 Oct 2026. On a declined or unanswered fee: *"agree with your recommendation"*.

---

## Decision 301 — Attendance hours in grading

**Date:** 22 Oct 2026 · **Status:** Product-owner decision · **Answers:** Decision 288 "Still open"

### Decision

1. **Where hours come from:** the scheduled length of the class the student checked in to (a 90-minute class adds 1.5 hours). ULTM8 records check-in only, so students don't check out.
2. **What a grade requires:** for each grade, the School picks **classes**, **hours** or **both**. Classes stay the default, so nothing changes for existing ladders.
3. **Board progress** for a grade needing both follows **whichever is further behind**. For example, 80% of the classes but 50% of the hours shows 50%, so a student is "Ready to Grade" only when both are met.
4. **The student's page shows a breakdown** of their grading progress, with each requirement on its own (classes, hours, days at the rank, skills), next to the overall %.
5. **"Log a class" by hand** adds the length of the class picked. With no class, the coach enters the time, 60 minutes by default.
6. **Open mat:** a switch in Grading → Settings, **"Open mat counts toward hours"**, changeable by the owner and coaches with "Change grading settings" (Decision 297). Open mat itself is defined in Decision 304.

### Recorded by

User, 22 Oct 2026: *"Agree with everything go ahead"*, with the two notes in items 4 and 6.

---

## Decision 302 — Portal browser tests in Firefox and Safari: nightly and on demand

**Date:** 22 Oct 2026 · **Status:** Product-owner decision · **Closes:** the Firefox/WebKit gap from Decision 179 item 3

### Decision

1. Every night, all the School Portal's browser tests run in **Firefox and WebKit** (Safari's engine), at desktop and tablet widths: `.github/workflows/browsers-nightly.yml`.
2. The same run can be started by hand ("Run workflow" in GitHub Actions), e.g. before a release.
3. Pull requests keep running Chromium only, so they stay fast.

The product owner chose option A.

### Recorded by

User, 22 Oct 2026.

---

## Decision 303 — Staff-created charges and member balances

**Date:** 22 Oct 2026 · **Status:** Product-owner decision · **Confirms:** v1.3 backlog §3.6 (it was flagged "NEEDS A DECISION ENTRY") and answers its "Still to decide" · **Unblocks:** paying an accepted promotion fee (Decision 300)

Spec 55 moves money only through Membership Plans. This decision adds charges outside them.

### Decision

1. **Staff can create charges outside a Membership Plan** (product owner, 20 Oct 2026, recorded in backlog §3.6):
   - one-off charges, e.g. a rash guard;
   - recurring payments outside a Membership Plan;
   - **tax fixed per country**, never typed per charge;
   - discounts as a % or a fixed amount;
   - the receipt appears in the member's account in the app, with no email needed.
2. **Members have a balance, and it can be in credit** (prepaid, an overpayment, or a refund given as credit). Credit is used automatically against the member's next charges, including promotion fees. The product owner chose option A.
3. **Who can create a charge:**
   - the owner, always;
   - Branch Staff, for students of their own branches;
   - any other staff member the owner turns on with a per-person **"Can create charges"** switch (on by default for Branch Staff, off for Instructors).
   - **Refunds and credit are owner-only.**
   The product owner: *"A plus a toggle on setting to allow other like it was propose on C"*.
4. **Members (or Guardians) can pay in the app**, the whole balance or a single charge, through Stripe hosted Checkout as for memberships (Decisions 238/243). The receipt then shows in their account. The product owner chose option A.
5. **An accepted promotion fee (Decision 300) is one of these charges**, paid the same way.

### Recorded by

User, 22 Oct 2026.

---

## Decision 304 — Open mat sessions

**Date:** 22 Oct 2026 · **Status:** Product-owner decision · **Answers:** v1.3 backlog §5.9 (K4, AT7, Q20, Q53) · **Unblocks:** open mat counting toward hours (Decision 301 item 6)

Open mat is free training with no set lesson.

### Decision

1. **Two kinds:**
   - **Scheduled:** a normal class in the timetable with the class type **"Open mat"**.
   - **Unplanned:** started from the front desk with **"+ Open mat session"**: style, start time and length (default 60 minutes). It is a one-off class, so check-in, attendance and hours work as for any class.
2. **Every session has a booking.** Students book ahead as for any class. If a student turns up and checks in without a booking, the booking is created at that moment, so a check-in always has one. The product owner: *"they will always book first regardless"*.
3. **Class credits:** a School setting, **"Open mat uses a class credit"**, **on by default**, so open mat uses a Class Pack or Friend Pass credit like any class. The owner can turn it off. It lives in **Settings → Check-in rules**. The grading switch "Open mat counts toward hours" stays in Grading settings (Decision 301).
4. **Who can start an unplanned session:** the School owner, and **only** the staff the owner has given permission, through a per-person **"Can start open mat sessions"** switch, off for everyone by default. The product owner: *"the staff that the owner has granted permission to this session. only those are allowed plus the school owner"*.
5. **Students hear about an unplanned session in the app:**
   - always, in their **Notifications**, and as a **banner on the home screen** while it is on ("Open mat now at Centre · BJJ · until 12:00 · Book");
   - as a **push alert** only if they turn on **"Open mat alerts"** in their notification settings (off by default). Push needs the Firebase/APNs credentials (v1.3, Decision 267).
   - It goes to students with a live membership or pass whose home branch is that branch and who train that style.

### Recorded by

User, 22 Oct 2026, answering one by one.

---

## Decision 305 — Coach screens in the student app: five actions stay on the web portal for now

**Date:** 22 Oct 2026 · **Status:** Product-owner decision · **Closes:** the open "coach screens" item in `docs/TRACK-B-ROADMAP.md` and the grading task list

The student app's coach screens cover quick grading (the board, promote, skills, log a class). Five actions are only in the School Portal:
- skipping ranks;
- bulk promote;
- moving a student to another board column;
- editing rank dates;
- giving a first rank.

### Decision

These five stay **web-only for now**. Coaches use the phone for quick grading and the portal for admin. It can be revisited in a later version. The product owner: *"keep web only for now"*.

### Recorded by

User, 22 Oct 2026.

---

## Decision 293 — Branch archive fixes: timetable slots block it, the purge rechecks, pickers hide archived Branches, and archiving asks first

**Date:** 21 Oct 2026 · **Status:** Approved by product owner
**Fixes:** four gaps in Decision 252's Branch archive, found in a review of the Branches page. Decision 252's rules are unchanged; these make the build follow them.

### Decision

1. **Weekly timetable slots block archiving.** `TimetableSlot` was missing from the Branch dependents check. The class-occurrence-generation job copies a slot's `branchId` onto every Class it creates, so a slot left on an archived Branch kept adding Classes to it. Counted the same way as Class (every slot, archived or not), to keep Decision 252's "any Class" rule; whether only live slots should count is part of the separate fix 5 question below.
2. **The purge job rechecks the dependents rule before deleting a Branch**, as it already does for Rank. Every FK pointing at Branch is `CASCADE` or `SET NULL`, never `RESTRICT`, so the old plain delete always succeeded: a home-branch Student, staff role or coach invite added after archiving was deleted with the Branch, and Classes or slots were moved to "whole School". A Branch that fails the recheck stays archived and is retried daily. The counting lives in one place (`branch-dependents.ts`) shared by `BranchesService.archive()` and the purge job.
3. **Archived Branches are left out of every School Portal Branch picker** (Staff invite and add manually, coach invites, Invite Student, Grading Board home branch, broadcast, Instructor invite/add/edit, Class and Timetable forms). An edit form keeps the Branch the record already points at, labelled "(Archived)", so it doesn't look lost. `useBranches` still returns every Branch, so existing rows keep showing their Branch name.
4. **Archive asks first.** The Branches row menu opens a confirmation naming the Branch and explaining the 90-day removal. If the API refuses, the reason (what still belongs to the Branch) shows inside the dialog instead of a page banner.

### What this does NOT resolve

- The API still accepts a new assignment to an archived Branch if one is sent directly (Decision 252's own "nothing stops a new dependent" note). The picker change and the purge recheck cover the School Portal and the data-loss risk; an API-side block is a separate change.
- Fixes 5 to 7 from the same review (only live dependents block archiving, a "Close branch" move flow, never purging a Branch with history) change Decision 252 itself and are being decided separately.

### Recorded by

User ("open a PR for bug fixes 1 to 4"), 21 Oct 2026.

---

## Decision 306 — Hours are logged, not graded (corrects Decisions 288 and 301)

**Date:** 22 Oct 2026 · **Status:** Product-owner decision · **Supersedes:** Decision 288 item 2 and Decision 301 items 2 and 3 · **Amends:** Decision 301 item 4

Decisions 288 and 301 made hours a grading requirement. That was a misreading. The product owner: *"Leave grading as it is, I think you have misunderstood me. We will log the hours they have trained, not do the grading based on hours. Do not change the grading logic."*

### Decision

1. **Grading doesn't change.** A grade still requires classes (or time at the rank for a time-only rank), days at the rank and skills, as today. There is no "classes, hours or both" choice per grade and no hours requirement. Progress and "Ready to Grade" work exactly as they do now.
2. **ULTM8 logs the hours each student has trained**, as a record. Decision 301 items 1, 5 and 6 still apply:
   - each check-in adds the scheduled length of the class (90 minutes = 1.5 hours);
   - "Log a class" by hand adds the length of the class picked, or the time the coach enters (60 minutes by default);
   - "Open mat counts toward hours" (Grading → Settings) decides whether open mat time is logged in the hours.
3. **Where hours show:** the student's hours trained are shown on their grading page and in the student app, next to the progress breakdown, as information. They never change the %.
4. **The progress breakdown stays** (Decision 301 item 4), with the requirements grading already uses: classes, days at the rank and skills.

### Recorded by

User, 22 Oct 2026, reviewing the New Portal design.

---

## Decision 307 — Promotion fee: defaults, prices hidden when off, and the coach decides after a waive or cancel

**Date:** 22 Oct 2026 · **Status:** Product-owner decision · **Adds to:** Decision 300 · **Answers:** the four design questions of 22 Oct 2026 on the promotion fee

### Decision

1. **Both fee switches are off by default.** The promotion fee switch stays off by default (Decision 287). **"Allow grading before the fee is paid" is off by default**, so a priced promotion waits until the fee is paid.
2. **With the promotion fee off, prices don't show anywhere:** the belt editor (Add rank and Edit) has no price field and the ladder shows no prices. They appear only once the owner turns the fee on.
3. **Waiving or cancelling a fee never promotes on its own.** Whether the student is promoted stays a coach's decision:
   - **Cancelling a fee while the promotion waits** leaves the student on their current rank, with the planned promotion waiting for a coach to decide. The product owner: *"should be a decision for the coach"*.
   - **Waiving a fee the student declined** asks the coach to confirm the promotion; nothing is applied until they agree. The product owner: *"promotion should come from the coach, so we should prompt a question and they should agree to promote, meaning it should not be auto promote"*.
   - A coach who may promote that student (or the owner) confirms it with the normal Promote dialog, and the history keeps the date they choose. No new fee request is created for a fee that was waived or cancelled.
4. **Waiving a fee while the promotion waits** applies the promotion the coach already made (Decision 300 item 3, unchanged).

### Still open

- Whether a promotion left "to decide" after a cancel or waive should time out or remind the coach.

### Recorded by

User, 22 Oct 2026, answering the design questions one by one.

---

## Decision 308 — Disciplines: eight bug fixes (archived belts, renames, class types, names)

**Date:** 22 Oct 2026 · **Status:** Product-owner decision · **Adds to:** Decisions 90, 198, 226

The Disciplines review of 22 Oct 2026 found eight bugs (D1–D8). The product owner: *"Deep dive, find best uptodate solutions and what's going on in market. then get confident on the solutions then start fixing them"*.

### Decision

1. **An archived belt is out of the ladder (D1).** Grading never lands a student on an archived belt: the ladder, "declare your rank" at signup, coach verification and a new student's first rung all skip archived belts and their rungs.
2. **Renaming a style renames it everywhere (D2).** The name copies on classes and timetable slots (`activities`) and on instructors (`specializations`, Decision 90's bridge) follow the new name.
3. **Class types are edited one by one, and a rename carries over (D3).** Renaming a class type updates the classes, timetable slots and rungs that use it. Removing one that is still in use (an upcoming class, a live timetable slot or a rung) is refused with the counts, so nothing is orphaned silently.
4. **Adding a belt closes gaps first (D4).** When the 90-day purge has removed an archived belt from the middle of the ladder, the next belt change renumbers the ladder instead of failing. The purge job itself is unchanged.
5. **Names are trimmed and can't be blank (D5).** This applies to style, skill and template names.
6. **No duplicate names (D6).** Style names are unique within a School and skill names within a style, ignoring case. A repeated class type in the same style is merged. This is checked by the API, not a database index, so existing duplicate data never blocks a migration.
7. **Copies and templates get a free name (D7).** "Duplicate" and "Start from template" number the name ("BJJ (Copy 2)", "IBJJF (2)") when it is taken, cut to fit 100 characters.
8. **Clearing a required field is refused (D8).** Sending an empty value for a style's name, class types or "skills required" switch returns a clear 400, not a server error.

### What this does NOT resolve

- Existing duplicate style names in live data are left as they are; the owner renames them.
- The API's new error messages are English only; other languages show the generic message until they are added to the portal's server-message translations.

### Recorded by

User, 22 Oct 2026, after the Disciplines section review.

---

## Decision 309 — Disciplines: archive a style, students per style, skill order, and a read-only view for coaches

**Date:** 22 Oct 2026 · **Status:** Product-owner decision · **Adds to:** Decisions 198, 226, 308

The same review found five gaps. Other class-booking and martial-arts apps deactivate rather than delete a programme that has history, and keep the history. The product owner asked for all five to be built.

### Decision

1. **A style can be archived (G1).** Only the School owner archives or unarchives it.
   - It is blocked while an upcoming class or a live timetable slot uses the style; the owner moves or archives those first.
   - An archived style is hidden from every picker, read-only, and nobody can be graded in it. Students keep their rank and history, and voiding or noting past history still works.
   - It is never purged (unlike Decision 226's 90-day purge for belts). Unarchive brings it back, if its name is still free.
   - Past classes and membership plans that name it keep it.
   - Delete (Decision 198) stays for styles nobody uses.
2. **Class types are a list (G2)**, with add, remove, reorder and rename (Decision 308 item 3).
3. **Students per style (G3).** The Disciplines list shows how many students hold a rank in each style, and the owner sees who they are, with their rank, on the style's page.
4. **Skills have context and order (G4).** Each skill shows which rungs require it and how many lessons teach it, and the owner can put skills in order.
5. **Coaches and Branch Staff can see the Disciplines page, read-only (G5)**, including the belts and skills. They don't see the students list.

### What this does NOT resolve

- Whether an archived style should eventually be purged, or a retention period apply.
- Whether coaches should ever be able to edit a style.

### Recorded by

User, 22 Oct 2026, after the Disciplines section review.

## Decision 310 — Disciplines: archived styles where they're already used, enrolled counts, and students who left

**Date:** 23 Oct 2026 · **Status:** Product-owner decision · **Adds to:** Decisions 152, 308, 309

A second pass over the Disciplines section after PR #286 found seven leftovers in how Decision 309's archive works in the rest of the app, plus a ladder editor failure that was already on `master`. The product owner asked for all of them to be fixed.

### Decision

1. **A student's rank in an archived style stays visible, read-only.**
   - On the portal's student grading page, the style shows with an Archived badge and a note. There is no grading, progress, ready-to-grade or skills for the next rank.
   - Voiding and notes on past history still work, as Decision 309 already allowed.
   - The student app shows the belt and history with "No longer taught at this School", and no progress or skills. The API marks the style `archived` and sends no skills for it.
2. **Archived styles are kept where they're already used, and refused anywhere new.** This covers class and timetable slot style pickers, membership plans, instructor specialisations and coach grading permissions.
   - The portal lists an archived style only on a record that already has it, labelled "(archived)".
   - The API refuses an archived style on a new plan or a new coach permission, but accepts it on a plan or permission that already had it. Classes and slots already refused it (Decision 309).
3. **Student counts per style count only students still enrolled** (an active Student role at the School). This applies to the Disciplines list, the style's page and its students list. The rung-holder list marks each student `enrolled`.
4. **Students who left still hold their rung.** Row security (by design) hides the account of someone with no active role at the School, so their name can't be shown.
   - The ladder editor shows them as "Former student".
   - Their rank still blocks removing the rung, and the message names them as "a former student".
   - Before this, the rung-holder list and that check joined the hidden account and failed with a server error.
5. **Clearer "still in use" messages** give the counts (upcoming classes, timetable slots, rungs on the ladder). The 17 Disciplines messages that weren't translated are now translated in all 14 languages.

### What this does NOT resolve

- Whether Branch Staff can be allowed to manage disciplines (proposed, waiting on the product owner).
- Permanently deleting an archived style nobody uses (proposed, waiting on the product owner).

### Recorded by

User, 23 Oct 2026, after the second Disciplines review.

---

## Decision 311 — Instructors: fourteen bug fixes (archived instructors, revoked instructors, branches, roster)

**Date:** 23 Oct 2026 · **Status:** Product-owner decision · **Adds to:** Decisions 115, 169, 226, 230, 296

The Instructors review of 23 Oct 2026 found fourteen bugs (I1–I14). The product owner: *"Find the best solution until you get confident that that's the best solution have many passes and then build it"*.

### Decision

1. **The belts box lists current instructors only (I1).** "Instructors' belts" no longer fails for the whole School once someone who chose a belt is revoked: their belt is left out, and verifying it says they are no longer an instructor here.
2. **An archived instructor gets no new work (I2).** A new Class, timetable slot or lesson, or a change of instructor on one, refuses an archived instructor. The pickers on Classes, Timetable and Curriculum offer only active, unarchived instructors; a record that already has an archived or revoked instructor keeps them, marked, until it is changed. Someone with the Instructor role but no profile yet can still be picked, as before.
3. **The roster shows every instructor, A to Z (I3).** The portal reads every page of the list instead of only the first 20. Every instructor picker and name lookup uses the same list.
4. **No instructor joins an archived branch (I4).** Add manually, Add instructor and Edit refuse an archived branch, as Decision 296 already does for staff and coaches. A profile already on a branch that was archived later stays editable.
5. **Revoking keeps its current rule, with a warning (I5).** Revoking an instructor is still allowed while they have upcoming classes; the confirmation now says how many and that those classes keep them until the owner changes it. A Class, timetable slot or lesson checks its instructor again only when the instructor or the branch actually changes, so the owner can still rename or reassign one whose instructor has left.
6. **Archive is blocked only by what the owner can see (I6).** Only this School's live (unarchived) upcoming classes and active timetable slots block archiving.
7. **The Status column shows Active or Revoked (I7).** The always-empty Login column is removed.
8. **A revoked instructor's profile can still be edited (I8).** Only moving it to another branch checks the role again, with a plain message. This replaces the earlier deliberate "update() throws" side effect noted in InstructorsService.
9. **"Add instructor" offers only people with no profile here yet (I9).** It also returns the branches each person's role covers, and the form starts on that branch.
10. **Names are trimmed and can't be blank (I10)** in Add manually.
11. **Coaches and Branch Staff who open the Instructors page go to their start page (I11)** instead of a blank page, as Decision 296 did for the Staff page.
12. **Archive asks "Are you sure?" first (I12).** Unarchive does not need to.
13. **A profile's branch must be one the role covers (I13).** A whole-School profile needs a whole-School Instructor role; a branch profile needs a whole-School role or one at that branch.
14. **The detail page lists every class, split into upcoming and past (I14).** Archived classes are left out; past classes show the latest ten with "Show all"; the booked count shows only on upcoming classes, since it counts upcoming bookings.

### What this does NOT resolve

- **Revoking with upcoming classes (question 2 of the review).** Whether revoking should be blocked until classes are reassigned, or clear their instructor, is still the product owner's call. Until then it stays allowed, with the warning above. Timetable slots of a revoked instructor keep generating classes with them.
- **Colleagues' profiles (question 1).** Any instructor or Branch Staff member can still read colleagues' full profiles (address, certification key) through the API.
- **Archive and the role (question 3).** Archiving still leaves the person's login and Instructor role in place.
- Existing profiles whose branch doesn't match their role (made before item 13) are left as they are.

### Recorded by

User, 23 Oct 2026, after the Instructors section review.

---

## Decision 312 — Instructors: search and filters, hand over classes, give the role back, and what instructors filled in

**Date:** 23 Oct 2026 · **Status:** Product-owner decision · **Adds to:** Decisions 1, 115, 217, 226, 230, 311

After the Decision 311 fixes, the product owner asked for the gaps the 23 Oct 2026 Instructors review listed: *"after fixing the bugs find best way of building the missing things prepare everything and check it to be error less and then start building it"*.

### Decision

1. **Roster search and filters.** The Instructors page has a search (name or email) and Branch, Style and Status filters, worked out in the browser from the full list (Decision 311, I3). Status includes "Hasn't signed in yet".
2. **"Hasn't signed in yet".** Instructor responses carry `awaitingFirstLogin`: true while the person still has "Add manually"'s temporary passcode (`User.mustChangePasscode`). Shown on the roster and the detail page.
3. **Invite, then add.** After "Invite existing user" grants the Instructor role, "Add instructor" opens straight away with that person and their branch picked, instead of a notice telling the owner to do it.
4. **The detail page shows what the instructor filled in** on their Complete Profile page: activities, address and certification (with the consent date). Specializations (the School's styles, set by the owner) and activities (the instructor's own words) are shown as two separate, labelled lists; whether to merge them is not decided here. It also shows their branch, the Archived badge, and their active weekly timetable slots.
5. **Certification download.** New `GET /instructors/:id/certification-url` returns a 15-minute link to the uploaded file, for the School Owner/Manager only (the same people who manage instructors), using the existing presigned-download helper waiver signatures use.
6. **Hand over classes.** New `POST /instructors/:id/reassign { toUserId }` moves every upcoming, unarchived Class and every active (ON), unarchived timetable slot of this instructor at this School to another instructor, in one transaction, all or nothing. It uses the same "upcoming"/"active" test archiving does, so archiving works straight after. The new instructor must be assignable at each row's branch (the check a Class edit already makes: active Instructor role covering the branch, profile not archived). Like a Class or slot edit, it sends no notifications; past classes keep their instructor. School Owner/Manager only.
7. **Give the role back.** A revoked instructor's detail page has "Give Instructor role back", which makes the same Instructor role grant the Staff page and "Invite existing user" make (`POST /users/:id/role-grants`), at the profile's branch by default.
8. **Complete Profile starts from what's saved.** New `GET /instructors/me/profile` returns the caller's own Instructor profiles (an empty list if none); the page fills in the saved address and activities and says when a certification is already on file. Emptying a saved activities list now clears it.

### What this does NOT resolve

- **Resending the temporary passcode** to someone who hasn't signed in yet. It means making a new passcode for another person's account, so it waits for the product owner.
- **Instructors editing their own bio, photo or phone.** Only the owner can change those today; whether instructors may is the product owner's call.
- **Merging specializations and activities** (item 4).
- Decision 311's open questions still stand: revoking with upcoming classes (now with "Hand over classes" as the way to clear them), colleagues reading each other's full profiles, and whether archiving should remove the role.

### Recorded by

User, 23 Oct 2026, after the Instructors section review.

---

## Decision 313 — "Promotion to decide": one reminder to the coaches after 3 days, only for a fully ready student

**Date:** 23 Oct 2026 · **Status:** Product-owner decision · **Answers:** the open point of Decision 307 · **Adds to:** Decisions 145, 178

### Decision

1. **A promotion left "to decide" reminds the coaches; it never times out.** It stays "to decide" until a coach promotes the student or decides not to. The product owner: *"remind the coach"*.
2. **One reminder, 3 days after** the promotion became "to decide" (after a fee was cancelled, or a declined fee was waived). It is not repeated.
3. **It goes to the coaches who may promote** that student in that style and branch, and the owner: the same people as "ready to grade" (Decisions 145, 139). Delivery uses the same channels as "ready to grade".
4. **Only for a fully ready student:** 100% of the classes required, enough days at the rank and every required skill signed off, the same test "ready to grade" already uses. A student who is not fully ready gets no reminder. The product owner: *"reminders just only go out for 100% + and all skills or curriculum done, otherwise we will overload the coaches with reminders, that are wrong."*
5. Nothing else changes: the Grading Board's "Ready to Grade" column still starts at 66% (Decision 136). That column is a view of progress, not a reason to send anything.

### What this does NOT resolve

- Nothing new. A promotion that stays "to decide" after the one reminder simply stays visible on the board.

### Recorded by

User, 23 Oct 2026, answering the follow-up questions on the reminder.

---

## Decision 314 — Promotion fee: who sees prices, who can decide not to promote, and one waiting promotion at a time

**Date:** 23 Oct 2026 · **Status:** Product-owner decision · **Adds to:** Decisions 300, 307, 313 · **Answers:** the open points of the B10 build (PR #293)

### Decision

1. **Prices are seen by everyone with access to grading:** the School owner and anyone with grading permission for that style. Other staff, students and guardians don't see the ladder's prices. (A student or Guardian still sees the amount of their own fee request.) The product owner: *"Any with access to the grading."* The same applies to the School's list of fee requests, whose amounts are prices: each person sees only the styles they have grading permission for.
2. **Anyone with grading permission for the style can decide not to promote** a student whose promotion is "to decide" (Decisions 307, 313), as well as the owner. No particular action right is needed. The product owner: *"any one with the grading permission"*.
3. **One waiting promotion at a time.** While a promotion is waiting for its fee, the student can't be promoted again in that style until the fee is paid, waived or cancelled. The product owner chose: *"No, wait for the fee first."*

### Recorded by

User, 23 Oct 2026, answering the B10 follow-up questions.

---

## Decision 315 — Gymdesk parity, members: visitors, check-in code, member details, data tools

**Date:** 25 Oct 2026 · **Status:** Product-owner decision · **Answers:** `docs/design-references/gymdesk/QUESTIONS-BY-SECTION.md` Q6, Q7, Q8, Q9, Q10, Q11, Q12, Q26, Q27, Q29, Q32, Q44, Q46, Q47, Q54, and the open points of `docs/v1.3-backend-backlog.md` §3.1–3.3, 3.9, 3.10, 3.15 and §5.1–5.4, 5.11, 5.13 · **Records:** the 20 Oct 2026 answers that were waiting for a decision entry

### Decision

1. **Visitors are their own status, separate from Trial Membership**, with no platform limit (20 Oct 2026). The School sets the visitor period (any length). A Visitor follows the same process as a member (waiver, booking, check-in). A child visitor needs a Guardian, as for any minor. The owner and staff the owner allows set the visitor period. A Visitor can have more than one visit pass in a row. Trial Membership's 30-day caps (Decisions 54, 64) are unchanged.
2. **Personal check-in code** (a fallback for the QR): ULTM8 generates it; the School chooses 4 or 6 digits (4 by default); unique within the School; a Guardian can check a child in with the child's code; staff can issue a new one; the student can't change it.
3. **Temporary passcode set by staff** (20 Oct 2026: ULTM8 generates it, changed at first login). For a child it goes on the **Guardian's** account; a child only has a login of their own through the Guardian's limited-login set-up (age 13+, Decision 77).
4. **Join date:** defaults to the day the member is added; staff can set an earlier date (never in the future).
5. **Contacts:** one secondary phone and one secondary email, plus a separate **emergency contact** (name, phone, relationship) who is not a Guardian and has no account.
6. **"How did you hear about us?"** is each School's own list, starting with Friend, Instagram, Google, Walked past; the School can add, rename and remove options.
7. **Tags:** a list each School manages (staff can add a new tag while tagging); members never see their tags.
8. **Staff notes:** staff-only notes are seen by any staff at the School who can see the member; kept while the account exists and erased with it. The "show to member" tick box (20 Oct 2026) still applies.
9. **Files on a member:** PDF, JPG and PNG, up to 10 MB each; seen by the owner and staff the owner grants access; never shown to the member; erased with the account.
10. **Medical information** at sign-up: optional per School; explicit consent from the member (Guardian for a child); seen only by the owner and staff the owner grants access; erased with the account.
11. **Export** the member list (CSV, all members including children, 20 Oct 2026): the owner and staff the owner grants the right.
12. **Import members** from a spreadsheet: name, email, phone, date of birth, gender, join date, belt per style. A row whose email already exists is skipped and listed for review. Children are imported with their Guardian's email; the Guardian gets an invite and gives consent when accepting.
13. **Data tools:** import memberships, merge duplicate members, export all signed documents (ZIP), and import past attendance (CSV).
14. **Custom member fields and statuses:** each School can add its own fields (text, number, date, drop-down, yes/no) and its own member statuses (up to 50 characters), shown on the profile and as list filters.
15. **Gender** accepts Female, Male or empty only. Existing other values are sample data and are cleared.

### Recorded by

User, 25 Oct 2026, answering the open Gymdesk questions in batches.

---

## Decision 316 — Gymdesk parity, memberships and billing: freeze, fees, plan dates, capacity, contracts, tax

**Date:** 25 Oct 2026 · **Status:** Product-owner decision · **Answers:** Q14, Q15, Q16, Q17, Q18, Q25, Q35, Q36, Q42, and `docs/v1.3-backend-backlog.md` §3.4, 3.7 · **Changes:** Decision 6 (Membership status gains Frozen)

### Decision

1. **Freezing a membership** (20 Oct 2026: allowed; the School sets the maximum length, may charge a freeze fee; billing stops; the Guardian requests for a child). The member or Guardian requests it; the **owner or permitted staff approve**; no booking or check-in while frozen; the end date moves out by the freeze length; a freeze can be ended early. This adds a **Frozen** state to Membership, alongside Active and Expired (amends Decision 6).
2. **Late fees** (fixed or %, every payment method, 20 Oct 2026): never charged to the card automatically. The fee goes on the member's balance (Decision 303) and is paid in the app or at the desk. Each School sets the grace period, 7 days by default.
3. **Joining (sign-up) fee:** a one-off amount on a plan, charged with the first payment. It's switched on or off in the School's membership settings, and **the owner decides whether it's refundable**.
4. **Plan dates:** each plan can start on the member's **first check-in** or run on **fixed dates** (e.g. a 6-week camp), and can **switch to another plan when it ends**. Prorating to a shared renewal day is already built (Decision 259).
5. **Plan capacity:** a plan can have a maximum number of members, set by each School in its settings; when full, new buyers join a waitlist and are told when a place frees up.
6. **Contracts** are between the School and its member (ULTM8 is the School's tool and charges no one). The School writes its contract text and terms on the plan (minimum term, early-exit fee, renews or ends). The member signs it at purchase like a waiver. If they cancel early, the School's exit fee goes onto their balance.
7. **Recharge at check-in:** when a Class Pack has no credits left, the member is offered the same pack in the app and the check-in completes once paid.
8. **Tax / VAT:** Platform Admin keeps a tax rate per country; ULTM8 adds it and shows it on receipts. No tax vendor.
9. **Failed card payments:** Stripe's own retries for everyone; no School setting.
10. **Income categories:** each plan and charge can carry an income category the School names, shown in exports. No accounting integration yet.
11. **Card-fee surcharge** (20 Oct 2026): a School may pass the card processing fee on to the member **only in countries where that's legal**. ULTM8 keeps a country allow-list, legally reviewed before launch (it's illegal for consumer card payments in the UK and the EU).

### Recorded by

User, 25 Oct 2026.

---

## Decision 317 — Gymdesk parity, check-in and attendance: rules, kiosk, statistics, past attendance, rosters, reminders

**Date:** 25 Oct 2026 · **Status:** Product-owner decision · **Answers:** Q19, Q21, Q22, Q31, Q41, Q52, and `docs/v1.3-backend-backlog.md` §3.5, §5.6, 5.7, 5.10

### Decision

1. **Check-in rules** are set per School (20 Oct 2026). They're changed by the **owner and staff the owner grants access**.
2. **Kiosk mode:** Check-in can run as a locked kiosk on a front-desk tablet (QR, code and name search only); leaving it needs a staff passcode.
3. **Attendance statistics:** the owner sees the whole School; staff the owner grants access see their own Branches. Trial, Visitor and Friend Pass check-ins count, with a filter to leave them out.
4. **Logging past attendance:** staff can log attendance up to 30 days back. It counts like a normal check-in (uses a Class Pack credit, counts toward grading) and records who logged it.
5. **Active students** (Dashboard): anyone with a current membership (Subscription, Class Pack with credits, Weekly Pass, Trial). Visitors and frozen members are shown as separate numbers.
6. **Rosters** are named lists of members for staff (to message, take attendance or filter). Being on a roster doesn't change who can book.
7. **Reminders:** an expiry reminder to the member 7 days before a membership ends (Guardian for a child); an absence alert to staff when a member hasn't checked in for N weeks (the School sets N); a weekly report to staff of memberships ending soon.

### Recorded by

User, 25 Oct 2026.

---

## Decision 318 — Gymdesk parity, the School and the member app: checklist, birthdays, messaging, ULTM8 trial, sign-up forms, app switches

**Date:** 25 Oct 2026 · **Status:** Product-owner decision · **Answers:** Q1, Q2, Q3, Q4 follow-up, Q5, Q24, Q30, Q37, Q40, Q43, Q45, and `docs/v1.3-backend-backlog.md` §3.12, 3.14

### Decision

1. **Setup checklist:** one per School, for the owner (add a Branch, a style and belts, a class, a membership plan, a waiver, connect Stripe, invite staff); the owner can hide it.
2. **Birthdays** on the Dashboard: all staff at the School see this week's birthdays, children included, with the date but not the age.
3. **"What's new":** written by ULTM8 HQ in Platform Admin, shown to owners and staff in their language (English if a translation is missing).
4. **Support chat:** later; a Help link to email support for now.
5. **Free trial of ULTM8** (20 Oct 2026: Platform Admin only, configurable length, no card): when it ends without a subscription, the School drops into the existing read-only ("degraded") portal state until it subscribes. Nothing is deleted.
6. **Messaging:** in-app and email now; SMS later, once a vendor and who pays for it are decided. Messages to children still go through the Guardian (20 Oct 2026).
7. **Member app switches** each School can turn on or off: edit own profile, cancel own membership, add family members, see payment history, and a **grading countdown**: the School's next grading day ("Grading in 23 days") and the student's own countdown to being ready for their next rank (classes and days still needed).
   - The next grading day is a date the School sets. It is not the grading-events module, which stays in Version 2 (Decision 158).
8. **Child's signature:** off by default (the Guardian signs); a School can also require the child's signature from an age it sets.
9. **Sign-up forms:** several forms per School (front desk, website, invite); each section shown, hidden or required; staff approve website sign-ups before they become members.
10. **Ad tracking:** ready-made connections only (the School enters its Meta Pixel or Google Analytics ID); no custom code on ULTM8 pages.
11. **Members-only news feed:** not now; Broadcast notifications and Curriculum cover it.

### Still open

- **Family accounts and family discounts** stay deferred until the product owner has reviewed Gymdesk's "Manage family account" screen (Q13).

### Recorded by

User, 25 Oct 2026.

---

## Decision 319 — Gymdesk parity, schedule: one timetable per Branch, closure dates, and four calendar settings

**Date:** 25 Oct 2026 · **Status:** Product-owner decision · **Answers:** Gymdesk Schedule screenshots of 25 Oct 2026 (`GYMDESK-PARITY-BACKLOG.md` §5, S3–S10)

### Decision

1. **One timetable per Branch**, filtered by style and class type, as today. No separately named schedules with their own visibility.
2. **Rosters stay lists only** (Decision 317): a roster can't be assigned to classes to book its members.
3. **Closure dates:** the owner sets closure dates for the School or a Branch (e.g. Christmas). Classes in that time are cancelled under the School's normal cancellation rule (credit or refund), members are told, and the owner can choose to **freeze every membership** for those dates (Decision 316's freeze).
4. **Schedule settings** the School can choose: the **week start day** (Sunday or Monday), the **default layout** (list or grid), **Google Calendar** connection (staff see their classes in their Google Calendar), and a **schedule embed** for the School's own website.

### Recorded by

User, 25 Oct 2026, reviewing Gymdesk's Schedule.


## Decision 320 — Gymdesk parity, staff: one Access page per staff member, Front-Desk is Branch Staff, a personal staff code for the kiosk, a payroll report

**Date:** 25 Oct 2026 · **Status:** Product-owner decision · **Answers:** Gymdesk Managers & Staff screenshots of 25 Oct 2026 (`GYMDESK-PARITY-BACKLOG.md` §5, ST1–ST7, PY1–PY3)

### Decision

1. **One Access page per staff member.** Every right the owner can grant to staff is a tick box on that page. They're grouped by area (Members, Billing, Check-in and attendance, Grading, Schedule and bookings, Settings), and there's a "Toggle all". This covers the rights Decisions 315–319 left as "staff the owner grants access": check-in rules, export, member files, medical information, attendance statistics, approving freezes, setting the visitor period. It also brings onto this page the toggles that already exist ("Can invite coaches", Decision 183; the grading toggles, Decision 181). The owner always has every right. A School Owner/Manager has every right too, by role, not by tick box.
2. **Staff types stay ULTM8's three roles.** Gymdesk's *Manager* is School Owner/Manager, its *Instructor* is Instructor, and its *Front-Desk* is **Branch Staff**. No new role is added. What a person may do beyond their role's floor comes from their tick boxes.
3. **Personal staff code for the kiosk.** Each staff member has their own code. It is generated by ULTM8, like members' check-in codes (Decision 315). It unlocks the kiosk (Decision 317; this read 316 until 27 Oct 2026, a typo), and the log records who unlocked it. There is no one shared School passcode.
4. **Payroll is a report only.** Each staff member can have an hourly rate and a per-class rate, in the School's currency. If both are blank, the person is left out. The report covers a date range, with presets (last 14 or 30 days, this or last month, last 12 months, custom). It adds up, per staff member, hours × the hourly rate plus classes taught × the per-class rate, and can be downloaded. **Hours are the classes taught only:** a class's length counts for the coach who actually taught it. There's no clock in or out. **A substitute is paid, not the assigned coach.** Staff need a way to mark a substitute on a single class; ULTM8 doesn't have one yet. **A class with more than one coach pays each coach in full:** each gets their own per-class rate and the full class length in hours. ULTM8 never pays staff; paying them stays outside ULTM8. Seeing the report and setting the rates is a right on the Access page (item 1).

### Still open

- Which role floors stay fixed, outside the tick boxes. For example, Spec 55 §8.2 rules out instructor management for Instructors (see Decision 183). The tick boxes can't grant past the spec, so the backend team checks each box against Spec 55 §8 before building it.

### Recorded by

User, 25 Oct 2026, reviewing Gymdesk's Managers & Staff and Payroll.

## Decision 321 — Grading, from Gymdesk Programs: requirement tick boxes per style, automatic promotion, first belt on the first class

**Date:** 25 Oct 2026 · **Status:** Product-owner decision (grading; overrides Spec 55 where they conflict, per Decision 124) · **Answers:** Gymdesk Programs recording of 25 Oct 2026 (`GYMDESK-PARITY-BACKLOG.md` §5, PG1–PG8)

### Decision

1. **Requirement tick boxes on each style.** The owner ticks which requirements the style uses:
   - **Classes** (exists);
   - **Days in rank** (exists);
   - **Skills** (exists);
   - **Hours** (new as a requirement);
   - **Days attended** (new);
   - **Minimum age** (new).

   The belt editor shows only the ticked requirements' fields. An unticked requirement is not checked, even if a belt still holds a number for it.
2. **Hours, per style (amends Decision 306).** A style that ticks Hours counts hours trained toward its belts. The hours are the ones already logged (Decision 301/306, B11); open mat counts only while its switch is on. A style that doesn't tick Hours works as Decision 306 says: hours are logged and shown, never counted.
3. **Days attended:** the number of different days the student checked in to a class of the style since their last promotion. Two classes on one day count once. It is counted per rung, like Classes.
4. **Minimum age, per belt:** the student must be at least this age on the day they're promoted. It is set in the belt editor like the other requirements: usually on the belt's plain grade, and a stripe grade can have one too. Empty means any age. A student who meets everything else waits until their birthday.
5. **Automatic promotion, per style, set by the owner.** The choices are:
   - **Manual** (the default; the coach decides, as today);
   - **Auto-award stripes** (stripes are given automatically; belts stay manual);
   - **Auto-award all ranks.**

   An automatic promotion happens when the student meets every ticked requirement for the next rung (100%).
   - **Promotion fee:** if the next rung has a fee, ULTM8 waits for it (Decision 314). The fee request goes out, and the promotion happens automatically once the fee is paid. A waived fee also lets it happen. A cancelled fee doesn't promote (Decision 307).
   - **Notices:** the student (the Guardian for a child) gets the usual promotion notice, in-app and by email. The coaches of that style are told too.
   - **Undo:** a coach who may promote can undo an automatic promotion. The undo is recorded in the history.
   - **Reminders:** "Promotion to decide" reminders (Decision 313) aren't sent for rungs that are awarded automatically.
6. **Auto-assign first belt, per style (owner switch).** When it is on, a student with no belt in the style gets the style's first rung on their **first check-in to a class of that style**. That rung is verified, as in Decision 147. They can still declare a higher belt for staff to verify (Decisions 137, 147).
7. **The progress % counts the ticked requirements** (26 Oct 2026). It is the **average** of the style's ticked requirements for the next grade: classes, days in rank, skills, hours and days attended. Each requirement is capped at 100%. Example: classes 30/40 (75%), days 90/180 (50%) and skills 4/8 (50%) give 58%. This replaces "progress is classes attended out of classes required; skills and minimum days aren't part of it". The board columns (Decision 136) and "Ready to grade" (Decision 313) use this %, so 100% means every ticked requirement is met.
   - A requirement the grade doesn't ask for (e.g. no skills) is left out.
   - A time-only rank still counts time at the rank.
   - **Minimum age isn't in the %:** a student at 100% who is too young shows "Waiting for age N" and can't be promoted until then.

### Recorded by

User, 25 Oct 2026: *"for the grading, we have done that i want, but i like this detail"*. The answers were collected in the same conversation.

## Decision 322 — Booking and schedule rules from the stress test: cut-offs, check-in opening, waitlist first, late cancellation, timetable edits

**Date:** 26 Oct 2026 · **Status:** Product-owner decision (answers given during the booking/schedule stress test) · **Report:** `docs/handover/BOOKING-SCHEDULE-STRESS-TEST.md`

### Background

The stress test ran 30 Schools and 12,213 students through the real API: booking, check-in, grading, and attacks on the logic. It found rules the code did not enforce, and gaps no rule covered. The confirmed rules (Spec 55 / SKILL.md) were fixed as bugs: a Membership past its expiry date funded bookings (SKILL.md §8: expiry is checked at every booking). For the gaps, the product owner decided as follows.

### Decision

1. **Booking cut-off.** Nobody can book a Class that has ended or is archived. Students and Guardians are stopped at the Class's booking cut-off (`bookingEndAt`, from the timetable's booking cut-off). **Staff can still book a walk-in until the Class ends.**
2. **Check-in opens before the start.** Check-in has always closed at the check-in end time (or the Class end). It now also **opens a set number of minutes before the Class starts**. Each School sets the number (`School.checkInOpensMinutesBeforeStart`, default 30). Before this, a Student could be checked into next week's Class and the attendance counted toward grading.
3. **Waitlist first.**
   - Only a full Class takes waitlist entries, or one others are already queued for. Never from a Student already booked into it.
   - While anyone is waiting, Students and Guardians can't book directly: they join the waitlist, and freed seats go in waitlist order. A seat offered to a notified Student is held for them, even from Staff.
   - Staff can still book a walk-in into a seat that is free and not held.
   - Raising a full Class's capacity offers the new seats to the waitlist.
4. **Late cancellation is a School setting** (`School.lateCancelRefundPolicy`). It covers cancelling a booking after the Class has started, when the Class has no refund cut-off of its own:
   - **No refund once started** (default): the credit stays spent.
   - **Refund until it ends.**
   - **Always refund.**

   Under the first two, a Class that has ended can no longer be cancelled; it becomes a No-Show. A Class's own refund cut-off still applies first. The late-cancellation fee stays tied to that cut-off only.
5. **Timetable edits reach the Classes already generated** (4 weeks ahead).
   - **Unbooked upcoming Classes always follow the change.** They are re-timed in the same week (a new weekday moves them, it doesn't add a second set). They leave the schedule when the slot is switched off or archived.
   - **Classes with bookings follow the owner's choice.** A change that moves them (day, times, branch) or switches the slot off is refused until the owner chooses:
     - **Move:** they follow, and booked students are told.
     - **Cancel:** bookings are cancelled with credit back, the Classes archived, and students told.
     - **Keep:** they stay as they are.
   - The owner sees the counts first (`GET /timetable/:id/upcoming-impact`).
   - When the School cancels a Class this way, the credit always comes back, whatever the refund cut-off, and no fee is charged.
6. **Capacity can't be cut below the seats already booked.** The owner is shown the count ("8 students are booked. Cancel some bookings first, or set the capacity to 8 or more.").

### Recorded by

User, 26 Oct 2026, answering the stress-test questions: *"Staff can, students can't"*; check-in opening *"School sets it"*; *"Waitlist first"*; late cancellation *"We should give school owners the choice to choose what fits better for them, we should have the options for them, as default we can use No refund once started"*; timetable edits *"Update unbooked, ask for booked"*; capacity *"Refuse with the count"*.

---

## Decision 323 — Translation before launch: the student app too, and every text reviewed from zero by native speakers

**Date:** 26 Oct 2026 · **Status:** Approved by product owner
**Resolves:** Decision 273 left the student app (`apps/student`) untranslated "for this testing round", and its item 3 said non-English text needs a native-speaker review before real users rely on it, without saying how or when.

### Decision

1. **The student app is translated too**, into the same 15 languages as the School Portal (Decision 273 item 2). Arabic is right-to-left.
2. **Its language:** it starts in the phone's language when that is one of the 15 (English otherwise). A language picker in Profile changes it and saves it to the account, the same saved setting (`language` on `GET /users/me`) the portal uses.
3. **Platform Admin overrides apply to the student app as well**, as Decision 273 item 1 does for the portal: an override row for a text replaces the app's built-in text; a missing translation falls back to English, never to blank text.
4. **Every text is reviewed by native speakers before launch, starting from zero.** Once the wording is final, the School Portal's and the student app's texts are exported to the shared translation review page (`apps/school-portal/scripts/i18n-review/`), reviewed per language by native speakers, and their corrections applied in one change to the translation files. Reviews made before that point were cleared (26 Oct 2026: 61 Portuguese (BR) checks and 25 Arabic AI pre-checks), so the launch review starts empty.

### What this does NOT resolve

Platform Admin itself stays English (Decision 273). Who the native-speaker reviewers are, per language, is for the product owner to arrange.

### Recorded by

User (Code), 26 Oct 2026: *"we will need for the students app too. Make sure it is done"*; *"delete anything that has been done, so we can start fresh from zero and make sure it is done properly"*; and choosing the recommended options for the languages (the same 15), how the app picks its language (phone's language, can change) and overrides (yes, same as the portal).

## Decision 324 — Curriculum: fourteen bug fixes (archived lessons, playlists, video uploads, blank text)

**Date:** 26 Oct 2026 · **Status:** Approved by product owner
**Resolves:** the Curriculum section review of 26 Oct 2026 (bugs C1–C19, two passes, on master `685cc0c`). This decision covers the fourteen fixes that needed no product choice; C2, C7, C8, C11 and replacing a ready video (C5) wait on the product owner's answers, and C19 belongs with the v1.3 video work (Decision 267).

### Decision

1. **Clearing a lesson's fields (C1).** `PATCH /lessons/:id` takes `null` for `durationSeconds`, `description` and `instructorId` to clear them; leaving a field out still keeps it. The edit form sends `null` for an emptied field, so emptying one no longer silently keeps the old value.
2. **Archived lessons are for staff only, on every route (C3).** `GET /lessons/:id` answers 404, and `GET /skills/:id/lessons` and `GET /schools/:id/curriculum/lessons?includeArchived=true` leave them out, for anyone who isn't staff at the School. A student's favourite or playlist entry for an archived lesson is kept (Unarchive brings it back) but isn't listed (favourites) or shows as unavailable (playlists). Decision 226's rule that students never see an archived lesson now holds everywhere, not only on the student list.
3. **Video uploads not set up (C4).** While the Cloudflare account isn't configured, `POST …/video-upload-url` answers 503 "Video uploads aren't set up yet" instead of a bare 500, and a new `GET /schools/:id/curriculum/video-uploads` says `{ enabled }`, so the portal greys out Upload video with that sentence.
4. **A stuck upload fails instead of processing forever (C5).** The video poll job marks a lesson FAILED when Cloudflare Stream reports an error, or when the one-time upload link expired with no file sent (Stream's `status.state` and `uploadExpiry`), which brings the Upload video button back. The portal also offers "Upload again" on a lesson that is still processing. Like the rest of the video pipeline, unverified against a real account until v1.3.
5. **Blank text is refused (C6, C15).** Lesson titles, comments and playlist names are trimmed, and empty ones are refused, the same rule category names already had.
6. **Playlists survive a student leaving a School (C14).** A playlist's items are read without joining their lessons; a lesson the student can no longer read (they left its School, or it is archived) comes back `available: false` with an empty title, still removable and reorderable. Before, one such lesson made the whole playlist fail with a server error. `PlaylistItemResponseDto` gains `available`.
7. **Adding a lesson to a playlist twice changes nothing (C16)**, like favouriting twice, instead of a generic conflict error.
8. **A closed School takes no new comments (C17).** Others read comments, so they follow Decision 110's read-only rule; favourites and watch progress are the student's own and stay allowed.
9. **Duration is capped at 24 hours (C18).**
10. **Smaller page fixes:** the grading page's "Watch:" lesson links leave out archived lessons (C9); the lesson form still shows a skill the lesson already has from an archived style, marked "(archived style)", so it can be unticked (C10); "No category" says "Put lessons in a category to choose their order." (C12); and the delete warning says students' favourites, playlist entries, watch progress and comments on the lesson go too, pointing to Archive (C13). All new text in 15 languages.

### What this does NOT resolve

Coaches' and Branch Staff's access to the Curriculum page (C2), deleting categories (C7), duration in minutes (C8), a comments panel (C11), replacing a ready video (C5) and what a "Live" lesson means: asked of the product owner on 26 Oct 2026. Signed playback links for members-only videos (C19) need the real Cloudflare account (v1.3).

### Recorded by

User (Code), 26 Oct 2026: *"find the best solutions for the bugs and have another pass"*, then *"build it and ask me"* on the fix plan in the Curriculum Section Guide.

## Decision 326 — Curriculum: the product owner's six answers (coaches read only, category delete, minutes and seconds, comments panel)

**Date:** 26 Oct 2026 · **Status:** Approved by product owner
**Resolves:** the six questions Decision 324 left open (C2, C5's replace, C7, C8, C11, and what "Live" means), each answered on its own decision card on 26 Oct 2026.

### Decision

1. **Coaches and Branch Staff see the curriculum read-only (C2).** They get the Curriculum page in their menu: lessons, categories (as headings) and comments, with no add, edit, reorder, upload, archive or delete. The server is tightened to match: creating or editing a lesson, uploading its video, and adding, renaming, reordering or deleting categories now need the School owner (`assertSchoolOwner`), not any staff member. **This replaces Decision 104's "Instructor/Staff-authored"** for lessons; Decision 104's School scoping is unchanged. Free, Archive and Delete were already owner-only (Decisions 190, 198, 226).
2. **The owner deletes a category; its lessons move to "No category" (C7).** `DELETE /curriculum/categories/:id`, owner only; the existing `ON DELETE SET NULL` foreign key moves the lessons, nothing else is lost. The confirmation says how many lessons move. New migration `20261128000000_lesson_category_delete` grants DELETE on `LessonCategory` with an owner-only RLS policy.
3. **Duration in minutes and seconds (C8).** The lesson form has two boxes, minutes and seconds (0–59), still saved as `durationSeconds` (24-hour cap from Decision 324). The portal and the student app list it as `m:ss`, or `h:mm:ss` from an hour up.
4. **A comments panel; coaches read, the owner deletes (C11).** Each lesson response carries `commentCount`. On the portal each lesson has "Comments (n)", opening its comments oldest first. Anyone with the page reads them; only the School owner deletes one. `DELETE /comments/:id` now allows the comment's author or the School owner, not any staff member. An archived lesson's comments stay hidden until it is unarchived.
5. **Replacing a ready video: not now (C5).** Upload stays offered only before a video is ready, after it fails, or while it is processing.
6. **A real "Live" lesson is planned, not built (Q2).** The product owner wants Live to become a real live lesson (a date, a time and a joining link, possibly tied to a class), as later work. Until it is specified, `format: LIVE` stays a label only. **[UNRESOLVED]** for that future work: whether it is tied to a Class or TimetableSlot, which video-call tool provides the link, who may join (membership rules as for lessons, or the class's bookings), whether it is recorded and becomes a prerecorded lesson afterwards, and reminders.

### Recorded by

User (Code), 26 Oct 2026, on the six decision cards in the Curriculum thread: "Read-only for them", "Owner deletes, lessons move", "Minutes and seconds", "Owner only, with a panel", "Not now", "Plan a real live lesson".
---

## Decision 294 — Branches list: City means the city, one search box, every Branch A to Z

**Date:** 22 Oct 2026 · **Status:** Product-owner decision · **Builds on:** Decisions 252 and 276

A test of the Branches City filter found it searched the whole one-line address. "London" also found "22 London Road, Manchester", "Lyon" found "Rue de Lyon, Paris", and "Sao Paulo" found nothing because of the accent. `%` and `_` acted as wildcards. The list also returned 20 Branches per page ordered by id, and the portal never asked for a second page, so a School with more than 20 Branches saw only 20 on the Branches page and in every Branch picker. The product owner chose the fixes plus the extras: *"Fixes plus the extras"*.

### Decision

1. **City matches the city field only** (`addressCity`), ignoring case and accents. A Branch saved before Decision 276 has no city field, so for it alone the City filter falls back to its free-text address containing the city.
2. **The City filter is a dropdown** of the School's own cities with a count each, e.g. "London (3)", instead of a free-text box.
3. **One search box** finds a Branch by name, city or postcode. Case and accents are ignored, and spaces in a postcode don't matter ("sw1a1aa" finds "SW1A 1AA"). Street names are not searched.
4. **A Country filter**, shown only when the School has Branches in more than one country.
5. **`%` and `_` are plain characters.** Matching is done in the API's own code rather than SQL, because the database has no `unaccent` extension and a School's Branch list is small.
6. **Every Branch, A to Z.** The list is sorted by name (case and accents ignored). Paging uses the last row's name and id, so a page never skips or repeats a Branch. The portal loads every page, on the Branches page and in every Branch picker.
7. **Students and upcoming classes per Branch.** Each row shows how many Students have it as their home Branch and how many classes there are from now on, not counting archived ones. Read only; nothing about how either is stored changes.

### Recorded by

User, choosing "Fixes plus the extras" for the Branches filter, 22 Oct 2026.

---

## Decision 331 — Instructors: resend the temporary passcode, self-edit bio/photo/phone, no revoke while teaching, private address and certification

**Date:** 26 Oct 2026 · **Status:** Product-owner decision · **Adds to:** Decisions 1, 217, 226, 230, 311, 312

The Instructors review (23 Oct 2026) left six product questions open. The product owner chose the recommended answer to each: *"Go with the suggestions"*.

### Decision

1. **The owner can resend the temporary passcode.** New `POST /instructors/:id/resend-passcode`, School Owner/Manager only, for someone "Add manually" created who still has the temporary passcode (`User.mustChangePasscode`) and still holds the Instructor role at this School. A new 6-digit passcode replaces the old one (which stops working) and is emailed the same way as at creation. Refused (409) once they have chosen their own passcode ("Forgot passcode" is theirs to use) or lost the role. Same per-account limit as "Add manually" (20 an hour). The detail page shows "Resend passcode" while they haven't signed in yet.
2. **Instructors edit their own bio, photo and phone.** `PATCH /instructors/me/profile` also takes `bio`, `photoUrl` and `phone` (same limits as the owner's edit; null clears). `phone` here is `Instructor.phone`, the number the School sees, not the login phone, which this endpoint still never changes. An instructor may request a photo upload link for their own profile. The Complete Profile page has Photo, Bio and Phone.
3. **Specializations and activities stay separate.** Specializations are the School's styles, set by the owner; activities are the instructor's own words (Decision 312 item 4). No change.
4. **No revoking an Instructor role while it leaves classes without an instructor.** Revoking an INSTRUCTOR grant is refused (409) while the person still teaches an upcoming class (not ended, not archived) or an active weekly slot (ON, not archived) at this School that no other active Instructor role of theirs covers (the branch rule of `assertValidInstructor`). So removing one branch of several only blocks on that branch's classes. The message points to "Hand over classes" (Decision 312 item 6), and the detail page opens a box with that button instead of the revoke confirmation. Other roles are not affected. This replaces Decision 311 I5's warning.
5. **Address and certification are private.** Instructor responses (`GET /schools/:id/instructors`, `GET /instructors/:id`) return the address fields, `certificationKey` and `certificationConsentedAt` only to the School Owner/Manager or to the instructor themselves; for anyone else (colleagues, Branch Staff) they are null. The owner-only endpoints are unchanged.
6. **Archiving an instructor keeps their role.** Archiving hides the profile and stops new classes (Decision 226, 311 I2); the Instructor role stays until revoked. No change.

### What this does NOT resolve

The temporary passcode still has no expiry of its own (Decision 230). An instructor at more than one School still edits one set of profile fields for all of them (Decision 217).

### Recorded by

User (Code), 26 Oct 2026: *"Go with the suggestions"*, answering the six open questions from the Instructors review.

---

## Decision 332 — Timetable review fixes: archived slots stay off, new slots bookable at once, capacity cuts and booking-rule changes on booked classes

**Date:** 26 Oct 2026 · **Status:** Product-owner decision · **Amends:** Decision 322 §5 and §6 · **Builds on:** Decisions 172, 226

A review of the Timetable section (26 Oct 2026) found 18 bugs (T1–T18). The product owner chose to fix 17 of them in one change, with the two open choices (T5, T6) settled as proposed: *"Build all 17, my way for T5/T6"*. T7 (the calendar draws slot templates rather than the real Classes) is left for its own change.

### Decision

1. **The nightly class run skips archived slots, closed Schools and archived Branches** (T1, T2). Before, archiving a slot removed its Classes and the 02:00 UTC run put them back.
2. **A new or unarchived slot is bookable at once** (T3): its next 4 weeks of Classes are created when it is saved, not at the next nightly run.
3. **Raising a slot's capacity offers the new seats to the waitlist** (T4), the same way raising one Class's capacity already does (Decision 322 §3).
4. **A capacity cut below the seats booked** (T5, amends Decision 322 §6) is still refused with the count, unless the owner confirms with **Keep**: then every Class takes the new capacity except those already fuller than it, which keep their current size. Nobody's booking is cancelled. Cancel is not offered for a capacity cut.
5. **Booking-rule changes reach booked Classes only if the owner says so** (T6, adds to Decision 322 §5). A change to the waiver requirement, membership inclusion, booking or refund cut-offs, QR window or cancellation charge always reaches unbooked upcoming Classes. For Classes with bookings the owner chooses **Apply** (they take the new rules) or **Keep** (they keep the rules they were booked under). The title, description, picture and coach always follow, booked or not.
6. **Slot times are checked** (T8): the end is after the start; a break has both ends or neither, ends after it starts, and falls inside the class times. A slot's title is trimmed and can't be blank.
7. **A break can be removed** (T9) by clearing both break times.
8. **Archive asks first** (T10), like Branches.
9. **The Timetable page needs a School** (T11): someone with no School (Branch Staff, coaches) is sent to their home page instead of a blank page.
10. **The month view shows no booking dots for archived slots** (T12), and **a cancelled or finished Class says so** when someone tries to book it (T13).
11. **Every slot loads** (T14): the page asks for every page of slots, not just the first 20.
12. **A date the slot cancelled comes back when the slot does** (T15): Classes the slot cancels are unlinked from it, so switching the slot back on recreates that date. A single Class cancelled on the Classes page stays linked and does not come back by itself.
13. **The cancellation notice gives the class's own local date and time** (T16), in the Branch's time zone, then the School's, then UTC (Decision 172).
14. **A slot can't be put on an archived Branch** (T17).
15. **Students on the waitlist are told when a class moves** (T18), as booked students already were.

### What this does NOT resolve

T7 (calendar from real Classes), a Timetable view for Branch Staff and coaches, and Decision 319 (closures, week start, calendar feeds, embed, filters) are still open.

### Recorded by

User (Code), 26 Oct 2026, choosing "Build all 17, my way for T5/T6" on the Timetable fixes decision.

---

## Decision 333 — Notifications review fixes: Load more, bell count, push before email, named waiver sender, archived broadcast targets, parents, class audience, named payment alert

**Date:** 26 Oct 2026 · **Status:** Product-owner decision · **Builds on:** Decisions 204, 223, 264, 273, 277

A review of the Notifications section (26 Oct 2026) found 14 bugs (N1–N14). The product owner asked for the fixes that need no further choice to be built (*"build it and ask me"*); N2 (a child's notifications reaching their parents), N9 (who a class broadcast reaches) and naming the student in the payment-restricted alert were put to them as separate questions; their answers (same day) are items 11–13. N7 (cancellation date in UTC) was already fixed by Decision 332 §13.

### Decision

1. **Every notification can be reached** (N1): the Notifications page loads the inbox one page at a time with a **Load more** button, instead of only the newest 20.
2. **The bell and the coach dashboard use the real Unread count** (N3): `GET /notifications/me/counts`, which covers every page and leaves snoozed notifications out, the same number as the Unread tile.
3. **Snooze is greyed out on a read notification** (N10): it is already out of the Unread count.
4. **The broadcast class picker lists upcoming, live Classes** (N4): from now to 30 days ahead, soonest first, each labelled with its date, time and branch.
5. **Push does not wait on email** (N5): notification-fanout sends push first, on the first attempt only (a retry exists only for email), and when no email service is configured at all it skips email instead of failing and retrying the job. A real email failure still retries.
6. **The waiver request names the School as the sender** (N6): "{School} has invited you to sign the waiver "{title}"." Spec 55 §9's sample leaves the sender out ("...has invited you to sign the following waiver"); the earlier text put the waiver's title in the sender's place. Older rows keep translating.
7. **Four more job-written notifications are translated** (N8): Class moved, Class cancelled, Promotion to decide and Promotion fee, in all 15 languages. The date inside the Class moved/cancelled text stays as the API writes it.
8. **A broadcast refuses an archived Branch or Class** (N11) with a clear message, and **a title or message of only spaces** (N13), trimmed on the server as the portal already does.
9. **A snooze is capped at 7 days whichever way it is set** (N14), matching the existing `minutes` ceiling.
10. **A cursor the API did not write is a 400** (N12), not a server error.
11. **A child's notifications also go to their linked parents** (N2; product owner: "Yes, send to parents"). notification-fanout copies every notification for a Student with a live GuardianLink to each linked guardian, as "For {first name}: {message}", one job per guardian with a deterministic id. A guardian-created minor (no login, placeholder email) gets only its in-app row, no push or email to the placeholder. A copy is never copied on, and the grading notifications, which already address guardians instead of the minor, are not doubled.
12. **The School Owner ticks who a one-class broadcast reaches** (N9; product owner: "this should be decided by the school owner"). `classAudience` on the broadcast: **Booked** (any Booking not cancelled), **On the waitlist** (waiting or offered a spot) and/or **Cancelled their booking**, at least one, Booked ticked by default. Before this every Booking was sent to, cancelled ones included, and the waitlist never was.
13. **The payment-restricted alert names the Student** (product owner: "Yes, name the student"): "{first name} {surname}, a Student at your School, has been restricted to …". Older rows keep translating.

### What this does NOT resolve

A School label on each notification, Mark all read, click-through, a sent-broadcast history, notification settings and automatic clean-up are still open.

### Recorded by

User (Code), 26 Oct 2026, "build it and ask me" on the Notifications fix plan.

---

## Decision 334 — Memberships review fixes: renew after expiry, Trial is not general access, plan shape rules, prices in pounds, purchase checks

**Date:** 26 Oct 2026 · **Status:** Product-owner decision · **Builds on:** Decisions 26, 54, 64, 110, 152, 241, 249, 259 · **Replaces:** the partial unique index `Membership_one_active_general_access_per_school` (Phase 9)

A review of the Memberships section (26 Oct 2026) found 20 bugs (M1–M20) and 8 questions. The product owner asked for the best option on the three open choices and then said *"Build it"*. This change fixes 18 of the bugs plus the three choices; the subscription and booking side of removing a Student stays with the Students review (S2).

### Decision

1. **Renewing after expiry works** (M1). The old partial unique index keyed on the stored status, which stays ACTIVE after a Weekly Pass or Trial runs out by date (Decision 26: expiry is live-computed, never flipped). It is dropped. In its place, `assertCanCreateMembership()` runs in the same transaction as every Membership insert (free and saved-card purchases, cash/bank confirmation, the Stripe `payment_intent.succeeded` handler), under a per-Student-per-School advisory lock, and checks for a *live* Membership. Stored status is still never flipped, so franchise headcount billing is unchanged. The same check runs before any charge at purchase.
2. **Only Subscription and Weekly Pass are general access** (M20), as Spec 55 §6.1 says. A live Trial no longer blocks buying either.
3. **Trial limits are enforced** (M3, Decisions 54/64): a Trial plan lasts 1–30 days, and a Student can have at most 30 trial days per School in any rolling 12 months. A refusal says the date the next trial can start. Existing Trial plans with no expiry or more than 30 days are set to 30; Memberships already sold keep their dates.
4. **Plan shape follows the type** (M2, M4). Credits and a one-class scope apply only to Class Pack and Friend Pass; an expiry applies to every type except Subscription. A field the type doesn't use is refused when sent and cleared on a type change. A Class Pack needs its class count; a Weekly Pass needs its expiry. Required fields are checked only when an edit touches them or the type, so older plans can still be edited.
5. **A plan's type is locked while it has live members** (M14). Duplicating the plan is the way to sell a different type. A type change also drops the plan's saved Stripe price.
6. **Prices are typed in pounds and pence** (Q1). The price and cancellation charge use the shared money field (12.50 is stored as 1250). The API still takes hundredths.
7. **Currency** (M6, M11, M12): a purchase is charged in the plan's currency, else the School's default; with neither it is refused rather than charged in US dollars. Currencies must be one of the Stripe-supported codes (Decision 241) and are stored upper-case. A plan with running Stripe subscriptions can't change currency. With no subscribers, a price or currency change drops the saved Stripe price so the next purchase is charged correctly. Titles are trimmed and can't be blank.
8. **Purchase checks** (M7, M13, M15, M16, M17, Q2): a plan that requires a waiver needs any Signed Waiver at the School, the same check as class booking. Hidden plans can't be bought by their link. A closed School takes no purchases or confirmations. A plan for one class can't be made or sold once that class has started or been archived (also Classes C15). A second cash/bank order for the same plan returns the one already waiting. Only a current Student of the School (or their Guardian, for them) can buy.
9. **Removed Students** (M18, membership side only): they aren't counted in Active members, and their Pending cash payment can't be confirmed.
10. **Smaller fixes**: prices above the 32-bit limit are a 400, not a 500 (M8); the price-change prompt counts running subscriptions, the same count the API checks (M9); the list shows every plan, not the first 20 (M5); Branch Staff and coaches see "Only the School owner manages membership plans" instead of a blank page (M10).

### What this does NOT resolve

Students S2 (what removing a Student does to their subscription, bookings and money), staff selling or gifting a plan at the desk, a member list per plan, Friend Pass gifting, subscription cancellation, collecting the cancellation charge, and Decision 316 are still open.

### Recorded by

User (Code), 26 Oct 2026, asking for the best option on removed Students, hidden plans and prices in pounds, then *"Build it"*.

---

## Decision 335 — Classes review fixes, first batch

**Date:** 26 Oct 2026 · **Status:** Approved by product owner (fix plan, Classes review)
**Resolves:** Classes review findings C2, C3, C4, C6, C7, C8 (date checks), C9, C10, C11, C12, C13, C16, C17. No database change.

### Decision

1. **Lists that must be complete load every page.** A Class's bookings (Class page and roll call) are no longer cut off at 20. The roll call lists students still to check in first, then those present, then cancelled ones, by name.
2. **The Classes list shows Upcoming by default**, soonest first (a Class in progress counts as upcoming), with Past (newest first) and All. `GET /schools/:id/classes` takes `when=upcoming|past|all` and `instructorId`; leaving `when` out keeps the old order for existing callers. Classes made by the Timetable carry a "Timetable" tag (`timetableSlotId` on the response).
3. **Coaches and Branch Staff can open the Classes list**, read-only, to reach each Class's roll call and QR code. The coach dashboard's "Coming up" asks the server for that coach's next Classes and links to both.
4. **Capacity:** making a Class unlimited offers a seat to everyone on its waitlist (before, they were stuck while others booked past them). Decision 322 item 6 still applies to cuts.
5. **A Class needs a real title** (spaces only is refused; extra spaces are trimmed).
6. **Date checks:** the QR check-in window can't close before the start; the booking and refund cut-offs can't be after the end. Cut-off dates can be cleared.
7. **An archived Class can't be edited** until it is unarchived. Archiving now asks for confirmation.
8. **The School's styles filter the list** (a dropdown), instead of an exact-spelling text box. Schools with no styles keep the text box.
9. **Money is typed in normal amounts** ("7.50"), stored in hundredths as before. Shared field: `apps/school-portal/src/lib/MoneyField.tsx`.
10. **Class times use the Class's own clock:** its Branch's time zone, else the School's, else UTC, in the form and the list, wherever the person editing is.
11. **Guests need a Friend Pass** (SKILL.md §10): the organizer's Subscription or Class Pack covers only them, and one pass covers one guest.
12. **A closed School takes no new bookings or waitlist entries** (Decision 110).

### What this does NOT resolve

Waiting on the product owner: whether one-off Classes need their own ticket (C1, `membershipInclusion`), moving a booked Class's date or Branch (C5, C14), creating a Class in the past, and Cancel class (PR #273). C15 (a plan scoped to an archived Class) is in the Memberships fixes.

### Recorded by

User (Code), 26 Oct 2026: *"have another pass for solutions until you get confident of the result and start building it"*, on the Classes fix plan.

---

## Decision 336 — Live lessons are online classes (plan for v1.3, not built)

**Date:** 26 Oct 2026 · **Status:** Approved by product owner as the plan; not built · **Follows:** Decision 326 item 6

The product owner wants a lesson's "Live" format to become a real live lesson. Agreed shape, to build in v1.3:

### Decision

1. **A live lesson is an online class.** A Class (and a TimetableSlot, so the online class can repeat each week) gets an **Online** switch and a **joining link**, not a new kind of lesson. Booking, capacity, membership rules, waivers, reminders and the waitlist work exactly as for any class. The Curriculum page shows a Live lesson as a link to its class.
2. **The video tool is the coach's own link to start with.** The coach pastes a Zoom, Google Meet or Teams link, so there is no vendor or integration. Hosting inside the app (Cloudflare Stream Live, the existing video vendor, Decision 101) is a possible later step.
3. **Who joins: students booked into the class.** The link is shown only to them, from 15 minutes before the start, and never on public or unbooked screens.
4. **Attendance is marked by the coach at roll call.** QR check-in doesn't apply online, and opening the link doesn't count as attending.
5. **No recording by default.** A coach may upload a recording afterwards as an ordinary prerecorded lesson.

### What this does NOT resolve

- **[UNRESOLVED]** Recording sessions with minors: whether guardian consent (Decision 236's consent tiers) is needed, and its wording. This is a legal question for the product owner and Gus.
- **[UNRESOLVED]** What happens to `Lesson.format = LIVE` once online classes exist: kept as a link to the class, or removed.
- Exactly when the link appears (15 minutes is the proposal) and whether coaches can change it.

### Recorded by

User (Code), 26 Oct 2026, replying "ok" to the suggested plan in the Curriculum thread.

---

## Decision 337 — Franchises review fixes: fees in dollars, fee model locked once billing, closed tenants stop billing, member list trimmed

**Date:** 26 Oct 2026 · **Status:** Product-owner decision · **Builds on:** Decisions 99, 110

A review of the Franchises section (26 Oct 2026, two passes) found 21 bugs (F1–F21) and asked nine questions (Q1–Q9). The product owner said *"build it"*: the 17 fixes marked ready, plus F1, F16 and F19 the recommended way (Q3, Q8, Q9 below). Building it found one more, older bug (item 3).

### Decision

1. **The fee model can't change while any School is being billed** (F1, Q3). Changing Flat ↔ Per-headcount is refused with the count; changing the amount still works through the Decision 99 rate-change choice. A School counts as billed while it holds a franchise-fee subscription that isn't cancelled and the School isn't closed. The portal greys out Fee model and says why.
2. **The member Schools list returns only what the page shows** (F2): name, type, logo, fee-billing status, closed date, created date. It no longer sends join codes or Stripe ids. `franchise_member_schools()` replaces `schools_for_franchise()` and checks Franchise ownership itself.
3. **The "Schools already billing" count is taken outside the caller's own view** (found while building). School rows are visible only to someone with a role at that School, so a Franchise Owner's count was always 0 for any School that has an Owner, and the Decision 99 rate-change prompt and its server check never fired. The count now runs on the jobs connection, after the ownership check, and returns only a number.
4. **A closed Franchise can't be joined, and a closed School can't join** (F3, F4). Joining while in a Franchise says to leave first (F12).
5. **Fees are typed in US dollars** (F5): the form shows and takes dollars and cents (e.g. 50.00); the API still stores cents. **A Franchise needs a fee for its fee model** (F7) when it's created or its model changes. The detail page says why billing can't start (no fee, or no connected Stripe account).
6. **Leave Franchise asks first** (F6) and **the School pays for the month it leaves in** (F19, Q9): its fee subscription is cancelled with a final invoice and no proration, so that month's Pending charge resolves.
7. **Closing a School or Franchise stops its fee billing** (F16, Q8): each affected subscription is cancelled the same way as leaving, and the monthly job skips closed Schools and Franchises.
8. **Labels** (F8, F9, F14): closed Franchises and member Schools show Closed; a closed Franchise has no Edit button; a charge from a School that has left shows "Former member School". The detail page shows the Franchise ID with a Copy button (F13, first half).
9. **Input checks** (F10, F20, F21): a name can't be blank or spaces and is trimmed; `null` name, fee model, activities or facilities is a 400, not a 500; language and currency must come from the supported lists (an older free-text value is kept if left unchanged). The Activity filter ignores capitals (F11).
10. **Billing timing** (F15, F17, F18): a School that leaves and rejoins gets a new subscription rather than Stripe's cached answer; a paid invoice marks the Pending charge for the period it billed, not the newest one, and a metered subscription's $0 opening invoice marks nothing; per-headcount billing months run midnight to midnight UTC from the 1st.

### What this does NOT resolve

Q7 (showing the Franchise's name and logo on a member School's page — the second half of F13) is still open. Connecting a Franchise's Stripe account from the portal, join approval (Q1), an Owner removing a School (Q2), how a School pays (Q4), Stripe Connect timing (Q5) and an Owner closing their own Franchise (Q6) are unchanged.

### Recorded by

User (Code), 26 Oct 2026, replying "build it" to the Franchises review's fix plan.

---

## Decision 338 — Gymdesk parity, Billing: charges, cancelling, refunds, invoices, desk payments, reports

**Date:** 26 Oct 2026 · **Status:** Product-owner decision · **Builds on:** Decisions 253, 303, 316, 320 · **Answers:** Billing questions BLQ1–BLQ14 in `docs/design-references/gymdesk/GYMDESK-PARITY-BACKLOG.md` §6

The product owner reviewed every Gymdesk Billing tab and Settings → Billing page (screenshots and recordings, 26 Oct 2026). Everything here extends C1, staff-created charges and member balances (Decision 303).

### Decision

1. **Cancelling a charge.**
   - A **Cancel** button on the charge itself (the member's payments list and the invoice page) opens an "Are you sure?" page. Staff don't have to open Edit first.
   - A charge is **never deleted**. A cancelled charge stays as a record, marked **Cancelled**, with who cancelled it, when, and the reason.
   - **Who can cancel:** the owner, and staff the owner turns on with a **"Can cancel charges"** tick box on their Access page (Decision 320). It is separate from "Can create charges", so front-desk staff can add charges without being able to remove them.
   - **Reason:** always asked for. The owner chooses in settings whether it is required or optional; **required by default**. The reason is for staff only.
   - **The member (or Guardian) still sees the charge in the app:** greyed out, labelled Cancelled, with the cancel date and "Nothing to pay", listed below what is still owed. They get a notification ("Your charge 'Rash guard, R$120' was cancelled. Nothing to pay.").
   - If part of the charge was already paid, that money doesn't vanish: it goes onto the member's balance as credit, or the owner refunds it.
   - Bulk actions on the payments list cancel, never delete.
   - **The same rule applies to cancelling a membership's cash or bank-transfer payment** (product owner, 26 Oct 2026). Decision 339 (PR #321) built that cancel as owner only, setting the payment to Failed with no reason; it changes to Cancelled, with a reason and the "Can cancel charges" access, as this item says.
2. **Restarting a stopped recurring payment:** the owner and staff with access to payments.
3. **Refunds** (owner only, Decision 303):
   - **Part refunds are allowed.**
   - **The owner chooses each time** whether the money goes back to the card (through Stripe) or onto the member's balance as credit. Refunding a cash payment only updates the records.
   - **Refund notes:** the owner chooses in settings whether they are required or optional; **required by default**. Notes are for staff only.
   - The member sees **"Refunded"** in the app.
4. **Invoice numbers:** every charge gets a running number per School (#0000001), **always on**, because some countries require it.
5. **Invoices before payment:** a member gets an invoice (with its due date) before paying, and staff can resend it.
6. **Receipts:** a School may add its tax ID, address and payment instructions.
7. **Tax:** whether prices include tax or have it added on top is set **per country by Platform Admin**, with the per-country rate (Decision 316 item 8).
8. **Paying by card:** the member chooses whether to save a card for automatic charging on the due date, or to pay each charge themselves in the app or at the desk.
9. **Paying at the desk:**
   - Staff can record **cash, Pix, bank transfer and card on a terminal**.
   - **Part payments are allowed**; what's left stays on the member's balance.
   - The receipt is sent by default; staff can untick it.
10. **Payment notifications** (reminder before a charge is due, receipt, failed or overdue payment, dispute): all on by default, and the School can switch each one off.
11. **Reports, first:** an Overview (scheduled, paid and overdue totals, revenue by month) and **Member balances**. Seen by the owner and staff with payment access.
12. **Later, after C1** (no version assigned): saved discounts and public promo codes (C1 keeps discounts typed on each charge, Decision 303), branded payment forms, importing past payment history.

### What this does NOT resolve

- Gymdesk's Growth report (year-to-date, projection, per member), its accounting codes (GL, department, venue) and income-category CSV tools: not asked for. Decision 316 item 10 still applies.
- The card-fee surcharge allow-list (Decision 316 item 11) still needs legal review.

### Recorded by

User, 26 Oct 2026, answering the Billing questions one by one and then *"Go ahead agree with all"*.

---

## Decision 344 — Live lessons: recording under-18s needs guardian consent; a "Live" lesson links to its online class (plan for v1.3, not built)

**Date:** 26 Oct 2026 · **Status:** Approved by product owner as the plan; not built · **Resolves:** the first two [UNRESOLVED] items of Decision 336

### Decision

1. **Under-18s can be recorded only with guardian consent.** A coach can record an online class, or upload its recording as a prerecorded lesson, only when every under-18 booked into that class has a Guardian's recording consent on file (Decision 236's consent records). Otherwise recording and upload are refused for that class.
2. **`Lesson.format = LIVE` stays, as a link to an online class.** A Live lesson points to an online Class (or TimetableSlot). On the Curriculum page it shows that class's next session, and students book it from there. It holds no video of its own.

### What this does NOT resolve

- **[UNRESOLVED]** Whether recording consent is a new consent tier or part of an existing one (Decision 236 has BASELINE and CAMERA), and its exact wording. This is a legal question.
- **[UNRESOLVED]** What happens to a Live lesson that has no online class linked (including the existing ones).
- Still open from Decision 336: exactly when the link appears (15 minutes is the proposal) and whether coaches can change it.

### Recorded by

User (Code), 26 Oct 2026, choosing "Only with guardian consent" and "Link it to an online class" on the Curriculum thread's decision cards.

---

## Decision 345 — Classes review fixes, second batch

**Date:** 26 Oct 2026 · **Status:** Product-owner decision (Classes review decision cards 1–4) · **Follows:** Decision 335
**Resolves:** Classes review findings C1, C5, C14, and C8's "a Class can be created in the past". Database change: one data migration.

### Decision

1. **"Included in membership" now works, for one-off Classes only** (C1, SKILL.md §6). A one-off Class (made on the Classes page, not by the Timetable) can only be booked with a ticket made for it (a Membership scoped to that Class) unless the owner ticks the switch. A Subscription, Weekly Pass or general Class Pack doesn't cover it; the booking is refused with `TICKET_REQUIRED`. Timetable Classes are always covered by general access, so the switch leaves the Timetable form and the edit form of a Timetable Class. A Class the Timetable made keeps counting as one after its slot is deleted (its `occurrenceDate` stays). New one-off Classes start with the switch off, as the spec says.
2. **Existing one-off Classes keep today's bookings.** The flag was never read before, so migration `20261129000200_one_off_class_membership_inclusion` ticks it on every existing one-off Class. Owners can untick it on any of them.
3. **Moving a booked Class to a new time** (C5): booked and waiting Students get a "Class moved" notice, the same one a Timetable move sends; moving it to a time that has already passed is refused (`CLASS_MOVED_TO_PAST`). A Class nobody booked or is waiting for moves freely, as before.
4. **A booked Class can't move to another Branch** (C14) while Students are booked or waiting (`CLASS_BRANCH_BOOKED`): their bookings have to be cancelled first. Students only see Classes at their own Branch, so before this a moved Class left bookings nobody could cancel or check into. Cancelling a booking now reads its Class past that Branch limit, so a booking stranded by an earlier move can still be cancelled.
5. **A Class that has already ended can't be created** (`CLASS_ALREADY_ENDED`). One already under way still can. A past session a Student attended can be credited with "Log a class" on the Student page.

### What this does NOT resolve

Add student and Cancel booking on the Class page wait for PR #273 (Cancel class), which the product owner chose to bring up to date and merge first (card 5).

### Recorded by

User (Code), 26 Oct 2026, on the Classes decision cards: "One-off only, keep today's bookings" (*"Go with the first option"*), "Notify, block the past", "Block while booked", "No, refuse it".

---

## Decision 348 — Memberships follow-ups: sell at the desk, give a Friend Pass, cancel a Subscription, member list per plan

**Date:** 26 Oct 2026 · **Status:** Product-owner decision · **Builds on:** Decisions 6, 26, 334; Spec 55 §6.1, §10.2 · **Migration:** `20261201000000_membership_cancel_at_period_end` (adds `Membership.cancelAt`, `Membership.cancelledById`, `Transaction.recordedById`)

After Decision 334, seven Memberships questions were put to the product owner with a recommendation each. They answered *"all recommended"*. This decision builds items 2 to 5. Item 1 (removing a Student) is Students S2 and is built in that thread; it calls the cancel method below. Items 6 and 7 are "no change for now".

### Decision

1. **The owner sells a plan at the desk** (item 2). From the Student's page, the owner picks a plan and records it as paid in cash, by bank transfer, by Pix or on the School's own card terminal (the four desk methods Decision 338 lists; product owner's yes, 26 Oct 2026). Pix and card terminal are new `PaymentAccountProvider` values used only for desk payments, never for a School's payment account. The Membership starts at once with a Successful Transaction (the same result as confirming a Student's own cash order). A £0 plan creates no Transaction (Spec 55 §6.1). Subscriptions are card only (§6.1) and Friend Passes are given, so neither is sold here. The usual checks apply: owner only, open School, a current Student, a plan that isn't archived, the waiver when the plan needs one, a one-class plan whose class hasn't started, one live Weekly Pass or Subscription, and the trial allowance. A hidden plan can be sold at the desk: hiding takes a plan off the Students' list (Decision 334), not off the owner's desk. `POST /schools/:schoolId/students/:studentId/memberships/sell`. The sale records who took the payment (`Transaction.recordedById`). The creation and its checks live in `MembershipsService.recordDeskSale()`, the one desk path that creates a Membership; the Transactions follow-ups (Decisions 346/347) call it for their Record a payment, with their own permission check in front.
2. **The owner gives a Friend Pass** (item 3) from the Student's page: a £0, one-class pass recorded as given by the owner (`giftedById`), which the Student uses to book a guest. Each friend gets a separate pass (§6.1). Students still can't buy one. `POST /schools/:schoolId/students/:studentId/memberships/gift`.
3. **A Subscription can be cancelled** (item 4) by the Student (in the app), a Guardian for a linked minor, or the owner (on the Student's page). It runs to the end of the paid month through Stripe's `cancel_at_period_end` (§10.2: no proration, no immediate cutoff); the Membership stays live and shows when it ends. When Stripe ends the Subscription, the existing `customer.subscription.deleted` handling expires it and cancels the Bookings it funded. Asking twice changes nothing. `POST /memberships/:id/cancel`; the Stripe and database work is the plain function `cancelSubscriptionAtPeriodEnd()` in `apps/api/src/memberships/cancel-subscription.ts`, which removing a Student (Students S2) also calls.
4. **A member list per plan** (item 5), owner only: everyone on the plan now (the same people the Active members tile counts), with start, end and classes left, and whether the School gave it. From the plan's row menu. `GET /membership-plans/:id/members`. The Student's page also lists all their memberships: `GET /schools/:schoolId/students/:studentId/memberships`.
5. **Item 6** (styles don't limit booking) and **item 7** (the cancellation charge waits for refunds, PR #273): no change.

### What this does NOT resolve

Undoing a cancellation before the month ends, and a cancellation made directly in Stripe's dashboard (the `customer.subscription.updated` event is still log-only), are not handled. Branch Staff can't sell or give plans (Spec 55 §8.2 keeps Membership and Transaction owner-only).

### Recorded by

User (Code), 26 Oct 2026: *"all recommended"*, on the seven open Memberships questions. Pix and card terminal: "Yes, add Pix and card terminal" on the follow-up decision card, 26 Oct 2026.

---

## Decision 339 — Transactions review fixes: the whole ledger newest first, Mark as paid and Cancel for cash payments, cash payment notices

**Date:** 26 Oct 2026 · **Status:** Product-owner decision · **Builds on:** Decisions 110, 291, 292

A review of the Transactions section (26 Oct 2026) found bugs T1–T12 and gaps G1–G7. The product owner asked for the ready-to-build fixes in one change: *"Build it and Ask me what you need"*. The open questions were put to the owner separately; where this change needed an answer before it could be built (Q1, Q7), it follows the recommended option and says so below.

### Decision

1. **The page shows the whole ledger, newest first** (T1, T2). Rows are ordered by billing date, then id, and paged with Prev/Next (20 a page). A cursor that can't be read is refused with "cursor is not valid", not silently restarted.
2. **The tiles count the whole ledger, not the page on screen** (T1). A new Owner-only `GET schools/:schoolId/transactions/summary` returns the total, Successful, Waiting for payment (Pending), Failed or disputed, and revenue per currency. Revenue counts Successful payments only.
3. **Currency codes are stored in capitals** (T3). Every new Transaction is written with an upper-case code, and a migration fixes the rows already stored, so "GBP" and "gbp" no longer show as two revenue lines.
4. **The Transactions page needs a School** (T5). Someone with no School of their own (Branch Staff, coaches) sees "Only the School Owner can see Transactions" instead of a blank page.
5. **The plan name comes with each row** (T6) from the server, not from a lookup of the first 20 plans.
6. **Receipt shows on card payments only** (T7). Cash and bank transfer rows show "—".
7. **A payment can't be confirmed for a Student who has left the School** (T8). Confirming is refused with a message to cancel it instead.
8. **A closed School can't confirm or cancel a payment** (T9, Decision 110). A School whose ULTM8 subscription is cancelled but which is not closed still can (Q7, recommended answer: the money was paid to the School, so recording it is still right).
9. **Choosing Cash/Bank Transfer twice for the same plan does not make a second Pending row** (T10). While one is waiting, the same Student and plan get that row back. Once it is confirmed or cancelled, a new purchase makes a new row.
10. **Cash payments send notices** (T11). The School's owners are told when a Student chooses to pay by cash or bank transfer. The Student (or their Guardians, for a minor) is told when the payment is marked as paid, and when it is cancelled.
11. **An abandoned card checkout is marked Failed** (T12): Stripe's `payment_intent.canceled` is handled like `payment_intent.payment_failed`.
12. **Mark as paid and Cancel on the page** (G1). A Pending cash or bank transfer row gets both buttons for the School Owner, each asking first. Mark as paid uses the existing confirm route and starts the membership. Cancel is a new `PATCH transactions/:id/cancel` and sets the row to **Failed** (Q1, recommended answer); no membership is created and a later confirm is refused. Card payments can't be cancelled here, since Stripe settles them.

### What this does NOT resolve

T4 (a plan with no currency is charged in US dollars) is fixed by the Memberships review, not here. Refunds and "refund owed" (G2, PR #273), subscription renewals and late-cancel fees as Transactions (G4, G5), Stripe-dashboard refunds (G6), filters and CSV export (G3), and staff recording desk payments (G7) wait on the owner's answers.

### Recorded by

User (Code), 26 Oct 2026, asking to "Build it" on the Transactions fix plan.

---

## Decision 350 — A member School shows its Franchise's name and logo only when both owners allow it

**Date:** 26 Oct 2026 · **Status:** Product-owner decision · **Builds on:** Decision 337 (Q7, second half of F13)

Decision 337 left Q7 open: should a member School show its Franchise's name and logo, and who decides? The product owner first said it *"depends on franchise's owner or school owner's decision"*, then picked **"Both must allow it"**.

### Decision

1. **Two switches, both off to start.** The Franchise Owner's `Franchise.shareBrandingWithMembers` ("Let member Schools show this Franchise's name and logo", on the Franchise form) and the School Owner's `School.showFranchiseBranding` ("Show the Franchise's name and logo", on the School page's Franchise affiliation card). Nothing changes for existing Franchises and Schools.
2. **Shown only when both are on and the Franchise isn't closed.** `GET /schools/{id}/franchise-branding` returns `franchiseAllows`, `schoolShows`, and the name and logo only in that case. Anyone with a role at the School can read it (same as the School's theme); another School's users get a 404. The Franchise row is read on the jobs connection after the School read proves the caller can see that School, and nothing else from it leaves the endpoint.
3. **Where it shows:** "Part of {Franchise}" with the logo, under the School's name in the School Portal footer. The School page shows the same preview, or says the Franchise Owner hasn't allowed it yet (the School Owner's choice is kept and takes effect if they do).
4. **The School's switch resets** when it joins or leaves a Franchise, so a new Franchise's name never shows without the School Owner turning it on again.

### What this does NOT resolve

`apps/student` doesn't show the Franchise's name yet. Q1, Q2 and Q6 from Decision 337 and connecting a Franchise's Stripe account from the portal are unchanged.

### Recorded by

User (Code), 26 Oct 2026, choosing "Both must allow it" on the Q7 decision card.

---

## Decision 346 — Transactions: renewals and late-cancel fees as rows, filters and CSV export, Record a payment at the desk

**Date:** 26 Oct 2026 · **Status:** Product-owner decision · **Builds on:** Decisions 234, 339, 348 · **Migration:** `20261201000200_transactions_renewals_fees_desk`

The Transactions review (26 Oct 2026, Decision 339) left gaps G3, G4, G5 and G7 for the owner. The owner answered: renewals and late-cancel fees should **both** become Transactions rows (Q3, *"Both"*), the page should get **filters and CSV export** (Q6), and front-desk cash payments should be the School owner's call (Q5: the School owner should decide this for their own School).

### Decision

1. **Every paid or failed Subscription renewal is its own row** (G4, kind `RENEWAL`). The Stripe webhook job writes one row per invoice (`invoice.paid` → Successful, `invoice.payment_failed` → Failed), keyed by the invoice id so a redelivered or retried event never makes a second row. A failed invoice that is later paid turns its row Successful; a Successful row never goes back to Failed. The first invoice of a Subscription is skipped, because the purchase already wrote that row. A renewal never creates a membership.
2. **Every late-cancellation fee is its own row** (G5, kind `LATE_CANCEL_FEE`). When a fee is charged (Decision 234) the row is Successful; when the card is declined it is Failed. When there is no saved card nothing was charged and no row is written. The row names the Booking's class instead of a plan, so `Transaction.membershipPlanId` is now optional. Fees already charged before this change get their row from the migration.
3. **Filters and CSV export** (G3). The list and the tiles can be narrowed by status, method, type, plan and a date range (both dates included). Export CSV downloads every row the filters pick out, not only the page on screen, with amounts as plain numbers and the currency in its own column. Cells that start with `=`, `+`, `-` or `@` are prefixed so a spreadsheet does not run them as formulas.
4. **Record a payment** (G7, first part). From the Transactions page, the School owner can record a payment already received at the desk (cash, bank transfer, Pix or the School's own card terminal) for a current Student and a one-time plan (Class Pack, Weekly Pass, Trial; not Subscriptions, Friend Passes or archived plans). It starts the membership at once with a Successful row, which shows "at desk", and the Student is told. `POST schools/:schoolId/desk-payments` checks who may record it, then calls `MembershipsService.recordDeskSale()`, the one desk-sale path from Decision 348. So it runs the same checks as selling from the Student's page: waiver, one live general access, the trial allowance, a one-class plan whose class hasn't started. The person who recorded it is kept on the row (`Transaction.recordedById`, from Decision 348's migration).

### What this does NOT resolve

- **Branch Staff recording payments** is Decision 347.
- Record a payment does not apply the Decision 67 date-of-birth checks, the same as Decision 348's desk sale.
- Refunds and refund-owed (G2, PR #273) and Stripe-dashboard refunds (G6) are unchanged.

### Recorded by

User (Code), 26 Oct 2026, answering the Transactions questions Q3, Q5 and Q6.

---

## Decision 347 — Branch Staff may record desk payments when the School owner switches it on (amends Spec 55 §8.2 for this one action)

**Date:** 26 Oct 2026 · **Status:** Product-owner decision · **Builds on:** Decisions 168, 169, 177, 346 · **Amends:** Spec 55 §8.2 · **Migration:** `20261201000300_branch_staff_record_payments`

Spec 55 §8.2 keeps every money action with the School Owner/Manager. The product owner decided that each School owner should choose this for their own School (Q5), and then confirmed, on a card that named the spec rule it changes, *"Yes, add the switch"*. As with grading (Decision 124), this is the product owner's explicit override of the spec, and it applies only through this decision.

### Decision

1. **A per-School switch, off by default.** `School.branchStaffCanRecordPayments` is set by the School owner on the School page ("Let Branch Staff record payments taken at the desk"). Only the owner can change it.
2. **What it allows: Record a payment (Decision 346) and nothing else.** With the switch on, Branch Staff can record a payment already received at the desk and start the membership. The rules are the same as the owner's, all applied by `recordDeskSale()`: one-time plans only, the School not closed, the ULTM8 subscription not degraded. The row keeps who recorded it, and the student is notified as usual.
3. **Their own branch's students only.** This uses the grading board's visibility rule (Decisions 168, 169, 177). In a School with branches, Branch Staff can record payments for the students whose home branch is one of theirs; in a School without branches, for every enrolled student. A new `desk_payment_students()` database function applies the rule, and `GET schools/:schoolId/desk-payments/options` returns those students together with the plans that can be paid this way.
4. **Everything else in §8.2 stays.** Branch Staff still can't see the Transactions list or tiles, confirm or cancel Pending payments, refund, or change plans or prices. Instructors can never record payments.
5. **In the portal**, Branch Staff whose School has the switch on get a "Record a payment" menu item. It opens a page with only the form, not the ledger. With the switch off, the page says that only the School owner can see transactions.

### What this does NOT resolve

The Staff page's planned per-person access switches (Staff build plan, Q7) are separate work. This is one School-wide switch for all Branch Staff, not a per-person permission.

### Recorded by

User (Code), 26 Oct 2026, choosing "Yes, add the switch" on the Transactions Q5 follow-up card.

---

## Decision 349 — Add student and Cancel booking on the Class page

**Date:** 26 Oct 2026 · **Status:** Product-owner request ("start Add student and Cancel booking on the Class page") · **Follows:** Decisions 291, 345
**Resolves:** the Classes review's "staff can't book or cancel students into one-off classes in the portal". No database change, no new API.

### Decision

1. **Add student.** A Class's page has an Add student button for staff (Owner/Manager, Branch Staff, Instructor; the API's existing staff-on-behalf booking, `POST /classes/:id/book` with `studentId`). The place is paid from the Student's own membership, exactly as if they had booked it themselves, so every booking rule (Decision 345's ticket rule, rank gates, waivers, capacity) still applies server-side. Students already booked aren't offered. When the Class is full or students are already waiting, the dialog offers Add to waitlist instead, like the Timetable's booking dialog (Decision 322).
2. **Cancel booking.** Each upcoming booking has a Cancel booking button (`PATCH /bookings/:id/cancel`, already open to staff). What goes back is the School's or Branch's cancellation settings (Decisions 291/292); a refund by anyone but an Owner/Manager waits on the Cancellations page. The confirm dialog says so.
3. Both are shown only while the Class is open: not cancelled, archived or ended. The API refuses the rest anyway.

### Recorded by

User (Code), 26 Oct 2026, Classes thread.

---

## Decision 351 — Gymdesk parity, Front Desk: what the shared tablet shows, its Branch, sign-ups there; Marketing, Website and Sales move to the next version

**Date:** 27 Oct 2026 · **Status:** Product-owner decision · **Builds on:** Decisions 315 (check-in code, Visitors), 317 (kiosk mode, check-in rules), 318 (sign-up forms), 320 (staff kiosk code) · **Answers:** `docs/design-references/gymdesk/GYMDESK-PARITY-BACKLOG.md` §10 (FD1–FD8)

### Decision

Gymdesk's Front Desk screens (7 screenshots, 27 Oct 2026) add little beyond Decisions 315–320. What they left open is what a shared tablet shows to whoever stands at it. The product owner agreed to each recommendation:

1. **Find Me** (on the kiosk Sign-up tab) only tells the person they're already a member and sends them to Check-In. It never shows or fills in stored details (phone, email, address) on the tablet.
2. **Name search** results show first name, last-name initial and photo. A child's photo shows only while the Guardian's camera consent is active (Decisions 57, 69: withdrawing it already clears the stored photo).
3. **Recent Check-ins** shows today only, first name and last-name initial, the last 10.
4. **The tablet is at one Branch.** Staff pick the Branch when they open the kiosk. Today's Sessions and name search cover that Branch. Members of other Branches follow the School's "check in at other Branches" rule (Decision 317).
5. **Sign-ups made on the tablet wait for staff approval**, like website sign-ups (Decision 318), because the tablet may be unattended. A child can be signed up there only by their Guardian, with the Guardian's consent, as for any child account.
6. **Scope of this version's Gymdesk study:** Front Desk is the last section. **Marketing, Website and Sales (POS) move to the next version.**

Two Gymdesk behaviours stay different on purpose, as already decided: the check-in code is generated by ULTM8, not picked at sign-up (315), and leaving the kiosk takes the staff member's own kiosk code, not their password (320).

### Not built

Nothing here is built yet. The kiosk is `docs/v1.3-backend-backlog.md` §3.21.

### Recorded by

User (Code), 27 Oct 2026: "We will leave the marketing, Sales and the website for the next version. We will work on front desk and that is it for this version", then "agree" to the five Front Desk recommendations.

---

## Decision 352 — Joining a Franchise needs the Owner's approval; the Owner can remove a School and close their own Franchise; paying fees by card and connecting Stripe move to v1.3

**Date:** 27 Oct 2026 · **Status:** Product-owner decision · **Builds on:** Decisions 98, 110, 232, 236, 337 · **Answers:** Decision 337's Q1, Q2, Q4, Q5 and Q6

Decision 337 left five Franchise questions open. The product owner answered *"all recommended"*.

### Decision

1. **Joining is a request (Q1).** A School Owner enters the Franchise ID and asks to join. Nothing changes until the Franchise Owner accepts. New table `FranchiseJoinRequest` (status Pending, Accepted, Declined or Cancelled), with the School's name copied in so the Franchise Owner never needs to read the School's own row.
   - The School page shows "Waiting for Franchise … to accept", with **Cancel request**. A declined request says so, and the School can ask again.
   - One open request per School at a time (a database rule). Asking while already in a Franchise is still refused: leave first.
   - The Franchise page lists **Schools asking to join** with **Accept** and **Decline**. Accepting joins the School only if it is still independent and open; if it joined somewhere else meanwhile, or was closed, the accept is refused and the request stays open. Accepting resets the School's "show the Franchise's name" switch, as joining always has (Decision 350).
   - Open requests lapse (Cancelled) when the Franchise or the School is closed.
   - Only that School's Owner/Manager and that Franchise's Owner can see a request (RLS).
2. **The Franchise Owner can remove a member School (Q2)** after an "are you sure?" step. It has the same effect as the School leaving (Decision 232): fee billing stops with a final bill for the month, past fee charges stay, and the School's branding switch resets. Not available on a closed Franchise or during impersonation.
3. **The Franchise Owner can close their own Franchise (Q6)** by typing its name exactly and re-entering their passcode (the step-up check from Decision 236). It is the same close as a Platform Admin's (Decision 110): 90 days, then deleted; until then only a Platform Admin can reopen it. Per Q8 (Decision 337) every member School's fee subscription is cancelled. The member Schools themselves stay open and keep running. Not available during impersonation.
4. **Q4 and Q5 move to v1.3.** A School pays its franchise fees by a card the School Owner adds (Q4), built together with the screen for a Franchise Owner to connect their Stripe account (Q5). See `docs/v1.3-backend-backlog.md` §3.22.

### Correction to the question

Q6 assumed School Owners can already close their own School. They can't: only a Full Platform Admin can close a School or a Franchise (`TenantLifecycleService`). The Franchise Owner's close is built as approved anyway. Whether School Owners should be able to close their own School is a separate question, not decided here.

### What this does NOT resolve

- The Franchise Owner isn't notified of a new join request, and the School Owner isn't notified of the answer; both see it on their page.
- A Franchise Owner's own close isn't written to the Platform Admin audit log (that log needs an admin user), so only the close date is recorded, not who closed it.
- `apps/student` has no Franchise screens, so nothing changes there.

### Recorded by

User (Code), 27 Oct 2026: "all recommended" on the five Franchise questions (joining approval, removing a School, closing a Franchise, connecting Stripe, how a School pays).

---

## Decision 340 — Waivers review fixes

**Date:** 26 Oct 2026 · **Status:** Approved by product owner (Waivers fix plan, deep dive)
**Resolves:** Waivers review findings W1, W3 (first half), W4–W6, W8–W15, W17 (W7 is Decision 333), and the read-then-sign race found in the deep dive. Database change: `20261130000000_waiver_signed_copy`.

### Decision

1. **The Signatures panel keeps working after a student leaves** (W1). Names are read separately, so a leaver no longer fails the whole list. A leaver's unsigned entry drops out of the list and the "X of Y signed" count; their signature stays, shown under "Former students" with the name they typed.
2. **A signature keeps a copy of what was signed** (W3, first half): the waiver's title, text, a SHA-256 of the text, and the waiver's version. Waivers get a `version` that goes up only when the title or text actually changes. The signer's app sends the version it showed (`waiverVersion`); an out-of-date one is refused (409) and the signer reads it again. Callers that send no version are still accepted. The Signatures list leaves the text out (a waiver can be 20,000 characters); `GET /schools/:schoolId/waivers/:id/signatures/:signatureId` returns it, owner only, with the same leaver rule as the list. Signatures made before this change show that no copy was kept; nothing is reconstructed for them.
3. **Blank values are refused** (W4, W5): waiver title and text, signer name and signature text are trimmed and must not be empty.
4. **An archived waiver is out of use** (W6): it is not assigned to new members and can't be signed. Unarchiving assigns it to current students who have no entry. Signatures made before archiving still count for bookings (Decision 216 unchanged).
5. **The request notification names the School** (W7): done by Decision 333 ("[School] has invited you to sign the waiver …"), so not repeated here.
6. **Portal** (W8, W9, W12, W14): every waiver and every signature loads (no 20 cap); All / Signed / Not signed tabs, names A to Z; opening a signed row shows the signature and the text as signed, and says when the waiver changed since; Archive asks first; waivers newest first, a new one opens straight away; a user with no owned School is sent home instead of a blank page.
7. **Signing at a closed School is refused** (W10), the same check Add and Edit use.
8. **`includeArchived=false` means false** (W11) on Waivers, Classes, Timetable, Branches and Instructors lists (Franchises already did this).
9. **Clear signing errors** (W13): no date of birth, and under 18 (a parent or guardian signs from their Guardian account). No internal wording.
10. **Waitlist join needs a signed waiver** when the Class requires one (W15), the same as booking; the claim-time check stays.
11. **A purged signature takes its drawn image with it** (W17). The image is deleted first; if that fails, the record stays and the next nightly run tries both again. `R2ClientService.deleteObject` is new.

### What this does NOT resolve

Waiting on the product owner: when Archive is allowed (W2, Decision 252), whether editing a signed waiver asks everyone to sign again (W3, second half), and keeping a Guardian-signed waiver while the student is still enrolled (W16, Decision 269). Questions Q4–Q9 in the Waivers review stay open.

### Recorded by

User (Code), 26 Oct 2026: *"Go"*, on the Waivers fix plan after the deep dive.

## Decision 354 — Waivers follow-ups and Waiver settings

**Date:** 27 Oct 2026 · **Status:** Approved by product owner (Waivers review cards and "Q4–Q9 as School settings" advice)
**Resolves:** Waivers review findings W2, W3 (second half) and W16, and questions Q4, Q5, Q6 and Q8. Q7 was already done by Decision 334. Q9 (guests on a booking) stays open. Changes Decision 252 (W2) and Decision 269 (W16). Database change: `20261203000000_waiver_settings`.

### Decision

1. **Archive is always allowed** (W2, replaces Decision 252's block). Archiving retires a waiver for new members. Every signature and unsigned entry is kept, and the waiver template is still never purged.
2. **Editing a signed waiver asks what kind of change it is** (W3, second half). When the title or text changes and someone has signed, the Owner chooses: a small fix keeps the signatures, or new terms mean everyone signs again. With new terms, every Signed entry becomes Expired (kept with its copy of what was signed), current students get a new unsigned entry, and those who had signed are notified. The API takes `resign: true` on `PATCH /waivers/:id`; without it, signatures stay.
3. **A Guardian-signed waiver is kept while the student is enrolled** (W16, changes Decision 269). No signature is purged while its student is still enrolled at that School. A minor's signature is purged at the later of age 18 + 6 years and 7 years after the student left. A paper signature counts as a minor's when the student was under 18 on the date signed.
4. **Waiver settings, chosen by each School** (Waivers → Settings, Owner and Managers). Each setting says what most schools choose. Defaults follow common gym software (Wodify, DaySmart, MyTime, Zenamu, ROLLER):
   - **Signatures on archived waivers still count** (Q4): on. Off means only signatures on waivers in use unlock classes and plans that need a waiver. Applies to booking, waitlist join and claim, plan purchase and desk sale.
   - **Members sign again after a set time** (Q5): off (a signature never runs out); 1 to 120 months when on.
   - **A child signs again at 18** (Q5): on. A signature given while the student was under 18 expires on their 18th birthday, and they are asked to sign themselves.
   - **Record waivers signed on paper** (Q6): on. The Owner or a Manager uploads a photo of the paper (JPEG or PNG), with the name on the paper and the date signed (not in the future). The entry becomes Signed, method Paper, with who recorded it and a copy of the current wording.
   - **Tell new members which waivers to sign** (Q8): on. A notice for each unsigned waiver when someone joins.
   - **Remind members until they've signed** (Q8): off; 1 to 90 days when on.
5. **"Remind everyone who hasn't signed"** (Q8): a button on each waiver in use. It reminds current students with an unsigned entry, each at most once a day.
6. **A daily job** (5am UTC) expires signatures for the renewal and age-18 settings, adds the new unsigned entries and sends the notices, and sends repeat reminders. Expired signatures are kept. Only current students, waivers in use and open Schools.
7. **The Signatures count** ("X of Y signed") leaves out Expired entries, since each one has been replaced by a new entry for the same student.
8. New notices (reminder, waiver updated, renewal, sign at 18) and error messages are translated into all 15 languages.

### What this does NOT resolve

Q9: whether guests on a booking must sign (waiting on the product owner's pick; recommended: guests sign through a shared link, as its own change).

### Recorded by

User (Code), 27 Oct 2026: *"go with the recommendations"* (W2, W3b, W16), then *"These all should be decided by the school owner … Although there must be general answers to help them choosing"* and *"Go"* on the advice for Q4 to Q9.
---

## Decision 353 — Timetable follow-ups: the calendar shows real classes, Branch Staff get their branch's timetable, the break is shown only, closures come first

**Date:** 27 Oct 2026 · **Status:** Product-owner decision · **Answers:** the Timetable review's open questions Q4–Q8 (`/mnt/project-files/notes/timetable-section-guide.html`) · **Builds on:** Decisions 319, 322, 332

The product owner answered the Timetable review's remaining questions with "all recommended" (27 Oct 2026).

### Decision

1. **The calendar shows the real Classes (Q5, T7).** Each date shows the Classes that actually exist on it: one-offs, classes kept at old times, moved and cancelled dates, with seats taken and the number waiting. A cancelled class stays on the calendar, marked Cancelled, without Book; a class that has ended shows without Book. An On slot's dates past the 4-week horizon show as "Opens for booking later", without Book. Off and archived slots still show on their weekday, dimmed, so the owner can find and change them. New API call: `GET /schools/:schoolId/timetable/calendar?from&to` (at most 62 days). A class the slot cancels is now also marked cancelled (`cancelledAt`), so it shows as a cancelled date.
2. **Branch Staff see their own Branch's timetable and book walk-ins from it (Q4).** They see their Branch's classes and School-wide ones, never another Branch's. Only the owner edits slots. The calendar call enforces this. In the portal, Branch Staff get a Timetable item in their menu and the same calendar, read-only: Book and Open class, but no Add slot, Edit slot, Archive, Show archived or Off slots. Instructors still have no Timetable screen; Q4 named Branch Staff only.
   - **The students they can book.** RoleGrant RLS only let the owner list a School's students, so Branch Staff and coaches at a School with branches saw an empty list when booking (here, and on the Class page's Add student, Decision 349). They now see the students whose home branch is one of theirs, Decision 139's grading rule (`staff_student_roster()`, a security-definer function like `grading_board_rows()`); in a School without branches, every student, as before. Students without a home branch show only to the owner.
3. **The break is shown on the class details only (Q6).** It has no effect on bookings, check-in or anything else. Each Class carries its slot's break for that date (`Class.breakStartAt`/`breakEndAt`), which moves with the class's times; a class kept at other times keeps its own. It is shown on the portal's class page and booking dialog and on the student app's class card.
4. **A class moved to a day this week that has already passed keeps today's behaviour (Q7):** removed if unbooked, cancelled with notice if booked (Decision 322 §5).
5. **Decision 319 order (Q8):** closure dates first, then the week start day and the timetable filters. Google Calendar and the schedule embed come later.
   - **Closures, as built.** The owner adds a closure from the Timetable's Closures button: first and last date, the whole School or one Branch, and a reason (e.g. "Christmas"). Every class on those local dates that hasn't ended or been cancelled is cancelled exactly as if the owner cancelled it by hand (Decision 291: the School's or Branch's cancellation settings, students and waitlist told, the reason in the notice); the dialog asks before doing it. New slots, slot moves and the nightly generation skip closed dates, and the calendar shows "Closed — reason" on them. Branch Staff and coaches see the closures that cover them; only the owner adds or removes one. API: `GET/POST /schools/:schoolId/closures`, `DELETE /closures/:id`; new table `Closure`.
   - **Week start, default layout and filters, as built.** On the School page, the owner picks the Timetable's week start (Monday, as today, or Sunday) and the layout it opens in (Rows, as today, or Grid); the Week and Month views follow them for everyone at the School. The calendar filters by Branch (a Branch's timetable shows its own and School-wide classes, Decision 319 §1), style and that style's class type.
   - Two choices the decisions didn't spell out, made the least surprising way: a Branch closure leaves School-wide classes (no Branch) running, since they don't belong to that Branch; and removing a closure doesn't bring cancelled classes back (their students were already told), though dates it had kept free get their classes again.

### Still open

- Which students Branch Staff can pick (2 above) was built on the recommended answer, their own branch's; the product owner was asked on 27 Oct 2026 whether it should instead be every student at the School, or their branch's plus a search for others.
- Decision 319's closures can "freeze every membership" for the closed dates, using Decision 316's freeze. Membership freezing isn't built yet, so closures are built without that option until it is.

### Recorded by

User (Code), 27 Oct 2026, answering the Timetable questions: *"all recommended"*.

---

## Decision 355 — Notifications: Mark all read, click to open, and a School label

**Date:** 27 Oct 2026 · **Status:** Product-owner decision · **Builds on:** Decisions 277, 333

After Decision 333, six Notifications gaps were left: a School label, Mark all read, click-through, a sent-broadcast history, notification settings and automatic clean-up. The product owner chose (*"go with it"*, 27 Oct 2026) to build the first three now, the broadcast history next as its own change, and to leave settings and clean-up until email and push are switched on.

### Decision

1. **Mark all read.** `POST /notifications/me/read-all` marks every unread, not-deleted notification the caller has as read, across every page and snoozed ones included, setting `readAt` to now (an unread row has never been read). It returns `{ updated }`. The portal's Notifications page has a **Mark all read** button, greyed out when nothing is unread, and the student app shows one above its list.
2. **Clicking a notification opens what it is about, and marks it read.** Each notification may carry a `targetType` (CLASS, WAIVER, PAYMENT, CANCELLATIONS or GRADING) and, for CLASS and WAIVER, a `targetId`. The senders set them:
   - CLASS: class moved, class cancelled, a waitlist spot opening, and a broadcast to one class.
   - WAIVER: a waiver signature request.
   - PAYMENT: a payment dispute on a Membership payment, the payment-restricted alert, and a cash payment confirmed or cancelled.
   - CANCELLATIONS: cancellations to resolve.
   - GRADING: ready to grade, promotion to decide, a promotion fee, and a rank change.
   The portal opens `/classes/:id`, `/waivers`, `/transactions`, `/cancellations` or `/grading`. The student app opens My bookings, Waivers, Payment history or My grading, and shows nothing to open for CANCELLATIONS, a staff page. A franchise fee dispute and a broadcast to everyone or a Branch open nothing.
3. **Each notification shows the School it came from.** The sender passes the School, and notification-fanout copies its name onto the row (`schoolId`, `schoolName`) when it writes it. The name is copied because the reader can't always see the School under RLS: a parent reading their child's notice, or a Student whose enrolment has ended. There is no foreign key, so the label outlives a School's purge. An Owner of more than one of a payment-restricted Student's Schools gets one alert, labelled with the first. A parent's copy of a child's notification (Decision 333) keeps the label and the target.
4. **Migration** `20261202000000_notification_school_and_target` adds the four nullable columns. Grants are unchanged: ultm8_app and ultm8_jobs already hold table-level grants on `Notification`. Notifications sent before it have no label and open nothing.

### What this does NOT resolve

A sent-broadcast history (next), notification settings and automatic clean-up (after email and push are switched on). The student app has no single-class screen, so a CLASS notification opens My bookings there.

### Recorded by

User (Code), 27 Oct 2026, "go with it" on the recommendation to build Mark all read, click-through and the School label now.

---

## Decision 364 — A School Owner can close their own School; every close stops billing; Franchise join notices

**Date:** 27 Oct 2026 · **Status:** Product-owner decision · **Builds on:** Decisions 110, 348, 352, 355

Decision 352's Q6 assumed a School Owner could already close their own School. They couldn't: only a Platform Admin could (Decision 110). Join requests (Decision 352) also told nobody. The product owner asked what was "right and best" and approved the recommendation ("go", 27 Oct 2026).

### Decision

1. **A School Owner closes their own School** from the School page: `POST /schools/:id/close` with the School's exact name and an `x-step-up-token` from the passcode check, the same as a Franchise Owner closing a Franchise (Decision 352). Only a SCHOOL_OWNER_MANAGER of that School; not during impersonation (Decision 39). It is the same close a Platform Admin does: read-only, purged after 90 days, and only ULTM8 support can reopen it. Open join requests lapse and franchise fees stop (as for an admin close).
2. **Every School close stops billing**, whether the Owner or a Platform Admin closes it. Each ACTIVE Subscription Membership at the School is cancelled the way Spec 55 §10.2 confirms for any cancellation: Stripe `cancel_at_period_end`, no proration, no immediate cutoff. The Membership gets the same `cancelAt` its own Cancel button writes (Decision 348), with `cancelledById` set to the Owner, or null for an admin close. The School's own ULTM8 platform subscription is cancelled at period end too. Closing a Franchise (by its Owner or an admin) also cancels the Franchise's platform subscription. All of this runs after the close has committed and is best-effort: a Stripe failure is logged, never a reason to undo the close. This is a behaviour change for the admin close, which used to leave Students' subscriptions running.
3. **The confirm step says so:** the Close School card explains that the ULTM8 subscription and every student's membership subscription end at the end of the period already paid for, and that refunds aren't automatic.
4. **In-app notices** (email and push follow once those go live, Decision 355):
   - a School asks to join → the Franchise's Owners, opening the Franchise page;
   - accepted, declined, removed, or the Franchise closed → the School's Owners, opening the School page.
   Notification `targetType` gains FRANCHISE and SCHOOL. Owners are read on the jobs connection, since neither side can see the other's RoleGrants. Each notice is best-effort and has a deterministic id, so a retry never doubles it.

### What this does NOT resolve

Reopening a School does not restore cancelled subscriptions; Students would buy again. Any School Owner/Manager can close the School; once a "main owner" exists (Staff thread), closing may be limited to them. An Owner's own close isn't in the admin audit log. Refunds stay manual.

### Recorded by

User (Code), 27 Oct 2026, "go" on the recommendation to let School Owners close their own School and to send join-request notices.

---

## Decision 363 — Notifications: a history of sent broadcasts

**Date:** 27 Oct 2026 · **Status:** Product-owner decision · **Builds on:** Decisions 333, 355

Decision 355 recorded the product owner's choice (*"go with it"*, 27 Oct 2026) to build a sent-broadcast history next, as its own change. Before this a broadcast left nothing a School Owner could read back: its only record was the notification in each Student's own inbox, which is self-only under RLS.

### Decision

1. **Each broadcast is stored** as a `NotificationBroadcast` row, written by `POST /schools/:schoolId/notifications/broadcast` once its notifications are queued, so only broadcasts that actually went out are listed. Its `id` is the `broadcastId` the endpoint returns, which every fanned-out notification's id already starts with.
2. **What it records:** the School; who sent it, with their name copied at send time; the title and message; the audience (ALL, BRANCH or CLASS); for a Branch its id and name; for a Class its id, title, start time and the groups ticked (Decision 333); how many Students it was queued for; and when it was sent. A broadcast that reached no one is listed too, with 0.
3. **The names are copies.** A Branch or Class purged later (Decision 226) sets its id to null and keeps its name, so the history still reads correctly. The sender is a required link to their User, which is never deleted.
4. **Owner only.** `GET /schools/:schoolId/notifications/broadcasts` lists them newest first, 20 per page with a cursor, under the same School Owner check as sending one. RLS on the table allows reads and inserts only to an active SCHOOL_OWNER_MANAGER of that School. Branch Staff and Instructors neither send nor see broadcasts.
5. **Kept with the School.** The app can't edit or delete a row (SELECT and INSERT grants only). The rows go when the School is purged (ON DELETE CASCADE). No other clean-up applies; automatic clean-up waits until email and push are on (Decision 355).
6. **Portal:** under the Owner's own notifications, a **Messages sent to students** list shows when and by whom, the title and message, who it went to, and how many it reached, with Load more. A class that still exists links to its page.
7. **Migration** `20261204000000_notification_broadcast_history` creates the table, its RLS policy and grants.

### What this does NOT resolve

Broadcasts sent before this change were never stored, so they aren't listed. The list shows how many Students a broadcast was queued for, not how many read it: each Student's notification is self-only under RLS. Notification settings and automatic clean-up are still waiting for email and push (Decision 355).

### Recorded by

User (Code), 27 Oct 2026, "go with it" on the recommendation to build the broadcast history after Decision 355.

---

## Decision 362 — Front desk: a tablet sign-up staff reject, and what Find me asks for

**Date:** 27 Oct 2026 · **Status:** Product-owner decision · **Builds on:** Decisions 318 (sign-up forms), 351 item 5 (tablet sign-ups wait for staff approval) · **Answers:** `docs/handover/FRONT-DESK-BACKEND-HANDOVER.md` F5 "Rejected" and F6

### Decision

When staff reject a sign-up made on the front-desk tablet:

1. **The person gets a polite email** saying their sign-up wasn't accepted and asking them to talk to the front desk. **No reason is given**, and staff don't type one.
2. **What they typed is kept for 30 days, then deleted.** During those 30 days staff can still see the rejected sign-up, in case it was a mistake. After that, nothing about it remains.

**Find me** on the tablet (Decision 351 item 1):

3. **It asks for full name and date of birth.** Both must match a member of the School. That way someone at the tablet can't find out who trains there just by typing names. The answer is still only "you're already a member" or "we couldn't find you".

### Not decided here

- Whether staff can undo a rejection within the 30 days. Ask the product owner before building one.
- Whether website sign-ups (Decision 318) follow the same rule. This decision covers the tablet only.

### Not built

Nothing here is built yet. The sign-up endpoint is F5 in the front-desk backend handover.

### Recorded by

User (Code), 27 Oct 2026: "Agreed" to the recommendation (a polite email with no reason given, and keep the details 30 days, then delete them), then "1 a1, B2, 2": the same two answers, plus option 2 for Find me (name and date of birth).

---

## Decision 365 — Rejected sign-ups: website sign-ups too, and staff can still approve within 30 days

**Date:** 27 Oct 2026 · **Status:** Product-owner decision · **Extends:** Decision 362 (answers both points it left open) · **Builds on:** Decision 318 (website sign-up forms)

### Decision

1. **Website sign-ups follow Decision 362 too.** When staff reject a sign-up made through a website sign-up form (Decision 318), the person gets the same polite email with no reason, and what they typed is kept for 30 days, then deleted.
2. **Staff can approve a rejected sign-up within those 30 days**, from the tablet or the website. Rejected sign-ups stay in their own list for that time.
   - Approving it makes the person a member straight away, as a normal approval does, and they get the normal welcome email. It doesn't go back to "waiting".
   - The record keeps who rejected it and who approved it later.
   - After 30 days the details are deleted, so there's nothing left to approve; the person signs up again.

### Not built

Nothing here is built yet. Tablet sign-ups are F5 in `docs/handover/FRONT-DESK-BACKEND-HANDOVER.md`; website sign-up forms are Decision 318.

### Recorded by

User (Code), 27 Oct 2026: "yes" to website sign-ups following the same rule, then "agree" to the recommendation that staff can approve a rejected sign-up within the 30 days.

---

## Decision 367 — Dashboard review: cancelled bookings apart, Attendance card, by Style, classes per day, Branch filter, Owner only

**Date:** 27 Oct 2026 · **Status:** Product-owner decision · **Follows up:** Decision 224 (drill-down grouped by raw activity tags) · **Builds:** Spec 55 §2.1's Attendance (Present / Absent) Dashboard card

The School Portal Dashboard review (27 Oct 2026) found 9 bugs (D1–D9) and asked 7 questions (Q1–Q7). The owner chose every recommendation.

### Decision

1. **Cancelled bookings are counted apart (Q1).** "Bookings this week", "Upcoming", each day and each style leave cancelled Bookings out; the card shows "N cancelled" underneath, and each day and class show their own.
2. **Attendance card (Q2).** The Dashboard shows this week's Present (checked in, `COMPLETED`) and Absent (`NO_SHOW`), per Spec 55 §2.1.
3. **Grouped by Style (Q3).** The Bookings page groups by each class's Styles, by the Style's current name. A class with no Styles keeps its free-text activity tags; one with neither shows as "No style". A class with several Styles still counts once in each Style's row and once in every total (unchanged from Decision 224).
4. **Classes per day (Q4).** Each day lists its classes: start time on the class's own clock, name (linking to the class page), Branch, booked / seats (or "N booked" when unlimited), cancelled bookings, and "Class cancelled" for a class the School cancelled. An archived class shows only if it has bookings.
5. **Branch filter (Q5).** Shown on the Dashboard and the Bookings page when the School has two or more open Branches. "All Branches" (the default) also includes School-wide classes; one Branch shows only classes held there. The choice is kept in the page address and carried by "See more".
6. **Owner only (Q6).** `GET /schools/:schoolId/bookings/summary` now answers only the School Owner; Branch Staff and coaches get 403 (no screen of theirs used it). If Branch Staff get a Dashboard later, it shows their own Branch only.
7. **Decided-but-unbuilt Dashboard items (Q7)**: Active students (Decision 317 item 5), this week's birthdays (Decision 318 item 2) and the setup checklist (Decision 318 item 1) come next as their own PR; "What's new" (Decision 318 item 3) waits for Platform Admin.

### Bugs fixed with it (no product decision needed)

- **D1** Bookings page day names were one day early anywhere west of London (a calendar day was formatted as UTC midnight in the browser's zone).
- **D2** No range limit: a half-typed year (0202) made the server build ~666,000 empty days. A range is now at most **92 days**, checked in the page and on the server.
- **D3** Days and weeks used the School's time zone or UTC, ignoring the Branch's. Each class now lands on its own local day: Branch, else School, else UTC (the Classes page's rule).
- **D4** A cleared date or To-before-From showed the API's English error; the page now says so in the picked language and doesn't ask.
- **D5** The Dashboard's week shows as "26 Oct – 1 Nov" in the picked language, not "2026-10-26 – 2026-11-01".
- **D6** "Unspecified" is now the translated "No style".
- **D7** The Dashboard refreshes when the Owner returns to the tab and every 5 minutes.
- **D8** "Upcoming" has its own singular/plural ("1 próxima").
- **D9** From/To (and the Branch) are kept in the page address.

### Not changed

The week still runs Monday to Sunday. Once the Timetable's "week starts on" setting (Decision 319) is built, the Dashboard should follow it.

### Recorded by

User (Code), 27 Oct 2026, choosing "All recommended" on the Dashboard review's decision card.

---

## Decision 330 — Closing a Branch: only what is still in use blocks it, "Close branch" moves it, and a Branch with history is kept

**Date:** 26 Oct 2026 · **Status:** Product-owner decision · **Changes:** Decision 252 (Branch archive) · **Builds on:** Decision 293

Fixes 5 to 7 from the Branches review. Under Decision 252 any Class ever held at a Branch, even years ago, blocked archiving it, so a real Branch could never be closed; the owner had to move everything by hand first; and a closed Branch was always deleted after 90 days, which set its past Classes' Branch to "whole School" and deleted its role history.

### Decision

1. **Only what is still in use blocks closing** (fix 5): classes that haven't ended and aren't archived, weekly timetable slots and Instructor profiles that aren't archived, Students with it as their home Branch, and active staff or coach roles. Past and archived classes stay linked to the Branch as its history and no longer block.
2. **"Close branch"** (fix 6) replaces "Archive" on the Branches page. Its window lists what is still in use and asks, per group, where it goes:
   - upcoming classes and weekly slots: another open Branch, or the whole School. Their bookings and waitlist entries follow the class;
   - home-branch Students: another Branch, or no home Branch;
   - Instructor profiles: another Branch, or the whole School;
   - staff and coach roles: another Branch only. A Branch role never becomes School-wide, since that would widen what the person can see. The old role is revoked and the same role granted at the new Branch, so the role history stays with the closed Branch. With no other open Branch, the window says to remove their access on the Staff page first.
   Coach invites still open for the Branch are cancelled (an invite's branch can't change after it is sent). If a class would end up at a Branch where its coach has no coach role, nothing is moved and the window says why. Everything happens in one step: all of it moves and the Branch closes, or nothing changes. Past classes, bookings, attendance, money and messages are untouched, and nobody is charged or emailed. API: `GET /v1/branches/{id}/close-preview` and `POST /v1/branches/{id}/close`; `POST /v1/branches/{id}/archive` stays, as a close with nothing to move.
3. **A closed Branch with history is kept for good** (fix 7). History means any class (past, future or archived), timetable slot, Instructor profile, or staff/coach role (current or revoked) ever at the Branch. Such a Branch gets no removal date; an empty one is still removed after 90 days. The purge job checks again before deleting and, if it finds history, clears the date instead. Reopen works either way.
4. **Wording:** "Close branch", "Reopen", "Closed" and "Show closed" replace the archive words on the Branches page and in Branch pickers ("(Closed)"), in all 15 languages.

Migration `20261205000000_branch_close`: the School owner may delete a home-branch row (for "no home Branch"; the owner-only RLS policy already covered it, the table grant was missing), and the purge job may clear a closed Branch's `purgeAt`.

### What this does NOT resolve

- A coach's other Branch roles, permissions and the Classes they teach elsewhere are untouched; only what points at the closed Branch moves.
- A slot moved to a Branch in another timezone keeps its wall-clock times, so its classes happen at that local time there, as when a slot's Branch is edited today.

### Recorded by

User, 26 Oct 2026, choosing on the Branches review's decision cards: fix 5 "Only live things block", fix 6 "Build Close branch", fix 7 "Keep it if it has history".

---

## Decision 366 — Guests on a booking sign the waiver by a shared link

**Date:** 27 Oct 2026 · **Status:** Approved by product owner (two Waivers decision cards: "Guests sign by shared link", then "Build guest booking + link together")
**Resolves:** Waivers review question Q9, left open by Decision 354. Database change: `20261210000000_guest_waivers`.

### Background

A guest on a booking is a seat paid for with one of the booker's Friend Passes (SKILL.md §10). A guest has no account, name or login, so "guests must sign" had no one to apply to. Checking the plan against the code also showed that the API could put guests on a booking but no screen could, and that a booking is checked in as a whole, not guest by guest.

### Decision

1. **Members can bring guests in the Student app.** A class row shows how many of the member's own Friend Passes can pay for a guest in that class (a pass for this class only is used before a general one) and lets them add guests up to that number. The API is unchanged: each guest is one Friend Pass in `attendeeMembershipIds`. New `GET /schools/:schoolId/friend-passes/me` lists the caller's usable passes.
2. **Each guest seat gets its own signing link**, `PORTAL_BASE_URL/guest-waiver/<token>`. The token is an HMAC of the seat id keyed by `JWT_ACCESS_SECRET`, so the booker can share the same link again; only its SHA-256 is stored (`BookingAttendee.guestTokenHash`), as coach invites do. The booker shares it from the class row after booking and from My Bookings. The School Owner/Manager and Branch Staff can copy it from the class page; Instructors see only whether the guest signed.
3. **The guest signs on a public web page with no account.** They read the School's current waivers (not archived) and sign them all at once: full name, date of birth, a typed signature and "I agree". A guest under 18 (by the date of birth given) is signed for by a parent or guardian, whose name must be given and differ from the guest's. A waiver changed while the guest was reading is refused (version check), as for members. The link works while the booking is Upcoming, the class hasn't ended and the School is open. A waiver added later is asked for on the same link.
4. **The booking is not blocked.** When a class asks for a waiver, the class page shows each guest as "Waiver signed: name" or "Guest hasn't signed the waiver", with a note counting unsigned guests. Check-in is unchanged, since a booking is checked in as a whole.
5. **Each guest signature is its own record** (`GuestWaiverSignature`): guest name and date of birth, signer, whether a parent signed, a copy of the wording signed with its SHA-256 and version, and the class title and start. It outlives the seat, booking and class. The Owner/Manager sees guest signatures on the Waivers page, with the wording each signed. Read access follows `WaiverSignature`'s narrow shape (Owner/Manager and the booker). Branch Staff and Instructors get only signed or not, read by the API through `ultm8_jobs` after checking they are staff for the class. The signing page reaches its seat only through the token (SECURITY DEFINER read functions and token-holder RLS policies).
6. **Retention** follows Decision 354's rule for a student who has left: a guest signature is purged 7 years after the class, and for a guest under 18, not before they turn 24 (18 + 6), whichever is later.
7. The signing page is limited to 30 reads and 10 signs a minute per IP. Every new text is translated into all 15 languages.

### What this does NOT resolve

- A drawn signature for guests: the guest page uses the typed signature only (drawn capture stays optional, Decision 74).
- Guests on a booking a Guardian makes for a child, or through Kid Mode: not offered in the app.
- Changing `JWT_ACCESS_SECRET` changes every guest link. Links are only useful until the class ends.

### Recorded by

User (Code), 27 Oct 2026: chose "Guests sign by shared link" on the Q9 card, then "Build guest booking + link together" on the follow-up card.

---

## Decision 360 — Staff page: what to build next (the eight build-plan answers)

**Date:** 26–27 Oct 2026 · **Status:** Product-owner answers to the Staff build plan's eight questions · **Follows:** Decisions 183, 295, 296
**Resolves:** the Staff review's "still not built" list: no staff list, no Remove from School, no co-owner rules, no edit, revoked access lasting up to 15 minutes.

### Decision

1. **Wording and acceptance.** The Staff page's "Send invite" (which grants at once, it never invited anyone) becomes **Give role**. An owner setting **New staff must accept first** follows, off by default; when on, a role given this way waits for the person to accept.
2. **Access changes are instant.** Any change to someone's roles (given, removed, Remove from School) takes effect on their next request, even if they are signed in; the apps quietly fetch a fresh session. No 15-minute wait.
3. **Owners.** Every School has one **main owner**; other owners are equal **co-owners**. Nobody inside the School can remove the main owner; only a Platform Admin can, through support. The main owner can hand the main role to a co-owner after re-entering their passcode. For existing Schools, the main owner is the owner with the earliest owner grant.
4. **Staff list.** The Staff page lists everyone with an owner, coach or Branch Staff role, with a **Removed** filter that is hidden by default.
5. **Editing staff details.** Hybrid: the owner sets a School-only **display name** and **work phone**; the person's own account (real name, login email, personal phone) stays theirs alone.
6. **Remove and Pause.** **Remove from School** is built first; **Pause** follows as the very next piece of work.
7. **Access switches.** Six switches per staff member (classes and timetable; bookings and check-in; students; credit for cancelled classes; see the staff list; invite coaches) with two presets, **Front desk** and **Branch manager**. Money and School settings stay owner-only.
8. **Activity log.** A log of who changed what on the Staff page comes right after the access switches.

### Order of work

One pull request at a time: (a) Decision 361 below; (b) owners and co-owners; (c) display name and work phone; (d) access switches and presets; (e) Pause; (f) the "must accept first" setting; (g) the activity log. Each records its own decision before it is built.

### Recorded by

User (Code), 26 Oct 2026 in the Staff thread (Q1 "option B", Q3 the main-owner model, Q4 "go with recommendation", Q7 "yes"), and 27 Oct 2026 "all recommended" for the rest (Q2 D, Q3 hand-over and earliest owner, Q5 hybrid, Q6 Remove now and Pause next, Q8 after the switches).

---

## Decision 361 — Staff list, Remove from School, "Give role", and instant access changes

**Date:** 27 Oct 2026 · **Status:** Built · **Follows:** Decision 360 (items 1, 2, 4, 6)

### Decision

1. **Instant access changes.** `User.rolesChangedAt` is stamped by a database trigger whenever a `RoleGrant` row for that user is inserted, updated or deleted, so every path is covered, not only the Staff page. Access tokens carry the stamp they were made with (`rca`). If the user's stamp is newer, the API answers `401` with code `ROLES_CHANGED`; the portal and Student app already refresh on any 401 and retry, and the refreshed token carries the current roles. The stamp is read through a 5-second in-process cache, cleared at once by the API's own role changes, so a change made through the Staff page applies on the very next request and any other change (another server instance, raw SQL) within 5 seconds. If the stamp can't be read, the request is refused rather than let through. Tokens without `rca` (Kid Mode, impersonation, tokens made before this change) are not checked; they still expire within 15 minutes.
2. **Staff list.** `GET /schools/:schoolId/staff` (owner only) lists one row per person who holds or held an owner, Instructor or Branch Staff role at the School: name, email, phone, photo, roles with branch names, who gave each, "Can invite coaches", added and removed dates. Filters: status (active by default, removed, all), role, branch, and a name/email search that ignores capitals. It replaces looking people up by User ID.
3. **Remove from School.** `POST /schools/:schoolId/staff/:userId/remove` (owner only) ends every Instructor and Branch Staff role the person holds at the School in one step, clears their grading permissions and "Can invite coaches", and cancels open coach invites they sent. Owner roles are never touched here (Decision 360 item 3 decides who may remove an owner). Student roles and memberships are kept. The person appears under "Removed".
4. **"Give role".** The Staff page's grant button and messages say "Give role" and that it works straight away; the coach-invite card keeps "Send invite", since that one really does send an invite.
5. **Blank names.** Add staff manually trims first name and surname, so a name of only spaces is refused (Add Instructor already did).

### Not built here

Owners and co-owners, display name and work phone, access switches, Pause, "must accept first" and the activity log (Decision 360's order of work).

### Recorded by

User (Code), 27 Oct 2026, Staff thread.

---

## Decision 341 — Students page review fixes: who sees which students, joining, profile values, home branches on revoke

**Date:** 26 Oct 2026 · **Status:** Product-owner approval of the Students fix plan (S1, S3, S4, S5 part 1, S6–S14) · **Plan:** the Students Fix Plan (25–26 Oct 2026), built from the Students section review

### Background

The Students section review reproduced 14 bugs against the real API and portal. Twelve follow rules already decided (Decisions 110, 139, 148, 168, 177, 226, 252, 276) and were approved for build together. Two need the product owner's own call and are **not** part of this decision: S2 (what revoking a student does to their memberships, bookings and waitlist places) and S5 part 2 (whether staff may change a date of birth across the 18th birthday).

### Decision

1. **Branch Staff and Instructors see and edit the students they cover (S1).** The Students list, a student's profile and its edit follow the Grading Board's rule (Decisions 168, 177): the owner sees every student; other staff see the current students whose home branch is one of their branches, or every student at a School without branches. A staff grant with no branch covers no students at a School with branches, and a student with no home branch yet stays the owner's alone (Decision 148). Former students are the owner's view only. Enforced in the database (RLS policy `rolegrant_branch_staff_student_read`, the branched half of Decision 177's `rolegrant_branchless_staff_student_read`) and in the API.
2. **A home branch belongs to an enrolment (S13).** Revoking a student's enrolment removes their home branch at that School, and so does a Guardian withdrawing baseline consent. Leftover rows from before are removed once. Re-enrolling picks a home branch as usual. Before this, a former student could never be enrolled again ("A record with this value already exists") and their old branch could never be archived (Decision 252).
3. **A closed School takes no new students (S4)**, however they join: the student app, a Guardian, or the owner's Invite (Decision 110).
4. **Only open branches count (S6).** An archived branch can't be chosen as a home branch ("This branch has been archived. Choose another branch."). A School whose branches are all archived needs no home branch to enrol.
5. **Staff who aren't the owner get the owner-only reason (S11)** when they try to enrol someone: "Only the School owner can enrol students."
6. **Profile values (S5 part 1, S7, S8).**
   - A date of birth must be a real calendar date, not in the future, and not more than 120 years ago. This applies to self-service and staff alike.
   - Names and username are trimmed; one made only of spaces is refused.
   - When staff edit a student, Language and Currency are picked from the lists the app serves (`GET /settings/languages`, `/settings/currencies`). Values saved before stay until someone changes them. Gender and nationality stay free text: no list is confirmed for them.
7. **The staff edit form opens with the student's saved profile (S9)** (`GET /schools/:id/students/:studentId/profile`, same access as the edit). Emptying a field clears it; the form sends only what changed.
8. **A Guardian-managed child shows "Managed by a Guardian" (S10)** instead of their account's placeholder email. Which Guardian is a separate question.
9. **A former student's page (S3)** shows their name and an Inactive badge. Their ranks and history stay readable; grading, skill sign-off, Log a class and Edit profile are hidden, since the API refuses them.
10. **"Upcoming Booking" is the real next one (S14):** the soonest upcoming booking whose class hasn't started, chosen by the API across all the student's bookings (`GET /students/:id/bookings/next`), with how many more there are.
11. **Owner-only pages redirect (S12).** Anyone else opening `/students` or `/students/invite` goes to their own home screen.

### Recorded by

User, 26 Oct 2026, after the fix plan and four review passes: *"Build it .. and ask me what's on me"*. S2 and S5 part 2 were put to the user as separate questions.

## Decision 342 — Only the School owner may change a birth date across the 18th birthday

**Date:** 26 Oct 2026 · **Status:** Product-owner decision (Students review, S5 part 2)

### Background

A student's age decides whether a Guardian must consent for them (Decision 67). Staff edit a student's profile on their behalf, including the date of birth, so a coach could turn a 10-year-old into an adult (or the reverse) and switch the consent rules on or off. Decision 341 already refuses future, impossible and over-120-year dates.

### Decision

When staff edit a student's profile, a new date of birth that changes the student from under 18 to 18 or over, or the reverse, is accepted only from the **School owner**. Branch Staff and Instructors can still correct a date that stays on the same side of 18; a crossing one is refused with "Only the School owner can change a birth date that makes someone an adult or a child." Age is counted on today's date, a birthday today counting; an unknown date of birth counts as under 18, as the waiver adult check does. Students editing their own profile are not affected by this decision.

### Recorded by

User, 26 Oct 2026, picking **"Allow, owner only"** on the question *"Can staff change a birth date across someone's 18th birthday?"* (the other options were blocking every crossing change, and allowing any staff member).

## Decision 343 — Revoking a student ends their bookings and waitlist places; the Revoke dialog lists what is still live

**Date:** 26 Oct 2026 · **Status:** Product-owner decision (Students review, S2) · **Related:** Memberships review M18; Decision 122 (bookings funded by an expired membership)

### Background

Revoking a student's enrolment (Students page, Revoke enrolment, owner only) only ended the STUDENT role grant. The student's upcoming bookings kept their seats, their waitlist places stayed, and a Subscription kept charging. The spec doesn't say what leaving a School does to these.

### Decision

When a student's last STUDENT grant at a School is revoked:

1. **Upcoming bookings are cancelled.** That means every booking still Upcoming whose class hasn't ended. A booking whose class has already ended is left to attendance and the no-show sweep. Each booking is cancelled under the same credit rule as a cancellation by staff: the class credit comes back before the class's refund cut-off, and once the class has started, the School's late-cancel setting decides. The disputed-payment freeze applies (Decisions 55, 111). No late-cancellation fee is charged. Guest seats on the student's own bookings go with them under the same rule. The freed seats are offered to the waitlist.
2. **Waitlist places are removed** (Waiting or Notified). A Notified place's held offer goes to the next person.
3. **Memberships get no automatic refund.** Class packs and passes stay as they are. The owner refunds by hand if they choose to.
4. **A Subscription stops at the end of the paid period.** Revoke calls the shared "cancel at period end" method from the Memberships follow-up (Decision 348, merged 26 Oct) before it revokes anything. If Stripe can't be reached, nothing is revoked and the owner is asked to try again (a retry is safe: a Subscription already stopping is skipped). The dialog says the subscription stops renewing, or, for one already cancelled, the date it ends. *(Updated 27 Oct 2026: when this decision was first recorded, the method didn't exist yet and the dialog told the owner to cancel in Stripe.)*
5. **The Revoke dialog lists what is still live before the owner confirms:** the upcoming bookings and waitlist places Revoke will end, and each membership still in effect (credits left, end date, or "keeps renewing"). The list comes from `GET /schools/:id/students/:studentId/leaving-summary`, which is owner only, like Revoke.

### What this does NOT resolve

- A seat the student holds as a guest on someone else's booking is left alone (same open question as Decision 122).
- A Guardian withdrawing consent also ends a child's enrolments (all Schools at once), but does not cancel their bookings. That flow wasn't part of this question.

### Recorded by

User (Code), 26 Oct 2026. The Students thread first put the options on a card (S2), and the user asked *"what do you suggest as an acadmy/school owner"*. The Memberships thread then listed S2 with the recommended option among its own questions, and the user answered *"all recommended"*. That option: the subscription stops at period end, upcoming bookings are cancelled, waitlist places are removed, packs and passes get no automatic refund, and the Revoke dialog lists what is live.

## Decision 371 — Students: Add manually for adults, list search, branch and paging, Re-enrol, Guardian names, and the "added" notice

**Date:** 27 Oct 2026 · **Status:** Product-owner decision (Students review, follow-up questions) · **Related:** Decisions 341, 343; Decisions 1/230 (temporary passcode, first-login change)

### Background

After the Students review fixes, five questions were left: whether the owner can create a student from scratch (Invite only finds someone who already has a ULTM8 account), how the list copes with a large School, how a former student comes back, whether a child's page shows who their Guardian is, and whether an invited student must accept.

### Decision

1. **Add manually (owner only, adults only).** `POST /schools/:schoolId/students/add-manually` takes first name, surname, email, date of birth and (at a School with open branches) a home branch. It creates the account with a temporary 6-digit passcode, enrols them like Invite does, and emails the passcode. The student must choose their own passcode on first sign-in (`mustChangePasscode`, the same first-login flow as Decisions 1/230); the student app now has that screen. A date of birth under 18 is refused: a child joins through their Guardian's app. An email that already has an account is refused with "use Invite instead". If the email can't be sent, the response gives the owner the temporary passcode once, so they can hand it over in person, rather than leaving an account nobody can sign in to. *(The handing-over fallback was not part of the question; it was added because email isn't live yet on the deployed site.)*
2. **Students list: search, branch, paging.** Each roster row now carries the student's home branch (`homeBranchId`, `homeBranchName`), read under StudentHomeBranch RLS as the caller (the owner sees every branch, Branch Staff and coaches their own). The list has a name/email search, a Branch column and filter (including "No home branch") at a School with branches, and pages of 25. The roster is still fetched whole; paging is in the browser.
3. **Re-enrol.** The owner has a Re-enrol button on a former student's page. It uses the same `POST /schools/:id/join` as Invite, with a new home branch where the School has branches (revoking removed the old one, Decision 341, S13).
4. **Guardian names.** `GET /schools/:id/students/:studentId/guardians` lists a student's active Guardians by name only. It is gated like the profile read (staff who can read this enrolled student). The links and names are read on the jobs and auth connections after that check, because the caller can't see them under RLS.
5. **"You've been added to [School]."** When the owner enrols someone (Invite or Re-enrol), the student gets an in-app notice, and a child's Guardians get the usual "For [child]: …" copy. There is no accept step. Add manually sends no separate notice, since its email says the same.

### What this does NOT resolve

- A temporary passcode can't be resent, and Add manually can't be undone from the portal: an account made with a wrong email stays (the owner can revoke the enrolment).
- Adding a child by hand stays out of scope (a Guardian adds a child).

### Recorded by

User (Code), 27 Oct 2026, answering *"all recommended"* to the five Students questions listed in the status report (add manually for adults only with a sign-in code, list search/branch filter/paging, a Re-enrol button, the Guardian's name on a child's page, and a "You've been added" notice with no accept step).

---

## Decision 372 — Stress test round 3: the product owner's answers

**Date:** 28 Oct 2026 · **Status:** Product-owner decision · **Builds on:** Decisions 331 (no revoke while teaching), 343 (revoke ends bookings), 361 (Remove from School), 364 (every School close stops billing) · **Answers:** `docs/handover/STRESS-TEST-ROUND3.md`, "Waiting on the product owner" (Q1–Q6)

### Decision

1. **Removing a coach who still teaches (Q1).** Remove from School always works, so a dismissed coach loses access at once. In the same step the owner chooses what happens to their upcoming classes:
   - give them to another coach at the School;
   - no coach for now: the classes still run, and the owner assigns a coach later;
   - cancel them, as for any class the School cancels (students told, credit by the School's cancellation settings).
   Weekly slots they teach follow the same choice.
2. **One attendance per student per class (Q2).** Once a student has been checked in to a class, another booking for that same class is refused. A cancelled booking doesn't count.
3. **A desk sale or Friend Pass clicked twice (Q3).** An identical desk sale or Friend Pass for the same student (same plan) within 1 minute is refused with "This was just recorded. Check before adding another."
4. **A Friend Pass covers a guest only (Q4),** never its holder's own seat.
5. **Staff booking on someone's behalf (Q5)** may book up to 200 a minute per staff login. A student's own limit is unchanged.
6. **A payment that arrives after its School closed (Q6)** is refunded and its Stripe subscription cancelled; no Membership is created.

### Recorded by

User (Code), 28 Oct 2026: Q1 "What happens if we have to remove it, for example the coach has been dismissed", then "agreed" to removing in one step with a choice for the classes, and "agreed" to also allow "No coach for now"; Q2 "yes, if the booking is for the same class"; Q3 "agreed"; Q4 "agreed"; Q5 "raise to 1000 per min", then "ok - 200" after the recommendation; Q6 refund "go ahead with your idea".

---

## Decision 374 — Dashboard: Active students, this week's birthdays and the setup checklist

**Date:** 28 Oct 2026 · **Status:** Product-owner decision · **Builds:** Decision 317 item 5, Decision 318 items 1 and 2 · **Follows:** Decision 367 (Dashboard review, Q7)

The Dashboard review's Q7 asked when to build the Dashboard items Decisions 317 and 318 had already decided. The owner chose the recommendation: Active students, Birthdays and the Setup checklist now, as their own PR; "What's new" (Decision 318 item 3) waits for Platform Admin.

### Decision

1. **Active students** (Decision 317 item 5): a card on the Dashboard counting enrolled students (active STUDENT grant) who hold a membership in effect now: a Subscription, a Class Pack with credits left, a Weekly Pass, or a Trial (the same "in effect" rule as everywhere else, `isMembershipLive`). A Friend Pass (a guest) doesn't count. Memberships aren't tied to a Branch, so the card is always the whole School, and says so when a Branch filter is on.
   - Visitors and frozen members, which Decision 317 shows as separate numbers, don't exist in ULTM8 yet; their numbers come with those features.
2. **This week's birthdays** (Decision 318 item 2): Monday to Sunday in the School's time zone, children included, with the day but never the year or age. The owner sees every enrolled student, on the Dashboard (names link to the student). Instructors and Branch Staff see them on the coach dashboard, for the same students they see elsewhere: their own Branches' students, or everyone in a School without Branches. A 29 February birthday shows on 28 February in other years.
3. **Setup checklist** (Decision 318 item 1): seven steps, each ticked automatically once the School has it: a Branch, a style with at least one belt, a class or a weekly timetable slot, a membership plan, a waiver, a connected Stripe account, and staff (a member of staff, or an invite still open). Unfinished steps link to their page. The owner can hide it and bring it back.
   - **Stripe has no screen in the School Portal yet**, so the step says ULTM8 support connects it and has no link.

### Built

`GET /schools/:schoolId/dashboard` (owner only: Active students and the checklist), `PATCH /schools/:schoolId/dashboard/setup-checklist` (`{ hidden }`, owner only), `GET /schools/:schoolId/birthdays` (owner, Instructors, Branch Staff). Migration `20261213000000_dashboard_overview` adds `School.setupChecklistHiddenAt` and the `school_student_birthdays` helper, which returns only a student's name and month/day of birth.

### Recorded by

User (Code), 27 Oct 2026, choosing "All recommended" on the Dashboard review's decision card (Q7).

## Decision 373 — Sign-in and accounts review fixes

**Date:** 27 Oct 2026 · **Status:** Bug fixes from the Sign-in and accounts review · **Builds on:** Decisions 72, 79, 230/237, 295 and 341

The Sign-in and accounts review (login, sign-up, verify phone, forgot and reset passcode, first sign-in with a temporary passcode, Create your School, My profile) found 13 bugs, A1–A13. This fixes them. No business rule changes; nothing needs a migration.

### Decision

1. **Nothing is saved when text messages aren't set up (A1, A3).** Sign-up and Forgot passcode check Twilio first and answer every phone the same way: "Text messages are not configured yet, so we can't send a verification code. Please try again later." (503, code `SMS_NOT_CONFIGURED`). Before, sign-up saved the account and then failed with a 500, so the person could never sign up again or log in; Forgot passcode failed only for registered phones, which told anyone which numbers have accounts.
2. **First sign-in with a temporary passcode keeps a real session (A2, A10).** The portal now stores the 30-day refresh token too, and drops anything an earlier session left in the tab. Before, the session died after 15 minutes, or picked up the earlier account's refresh token. It also returns to where Log in was going (the coach invite link) and sets the belts-to-verify notice like a normal login.
3. **A new login starts clean (A4).** Logging in clears the previous session's cached data and School choice, as Log out already did.
4. **Create your School has Log out (A5).** It is the home page for anyone without a School, and had no way out.
5. **An unverified phone gets plain wording and a link (A6, A9).** "Your phone number isn't verified yet. Verify it to finish creating your account." (403, code `PHONE_NOT_VERIFIED`), with a "Verify your phone" link on Log in. After verifying, Log in says "Phone verified. You can log in now."
6. **Sign-up checks names and date of birth (A7)**, as Decision 341 does for profile edits: names are trimmed and can't be blank; the date of birth must be a real date, not in the future and not more than 120 years ago.
7. **Usernames ignore capitals and are checked across all accounts (A8).** "Taken" now matches "taken", and a username used at another School gets "This username is already taken." instead of a generic error. Only whether it is taken is read, never the other account.
8. **My profile can remove the photo (A11).** `profilePhotoUrl: null` clears it. An account with no phone no longer shows a broken phone field.
9. **Create your School: a cleared waitlist box keeps the default (A12).**
10. **A Franchise owner who owns no School lands on Franchises (A13)**, not Create your School.

### Still open

The review's five questions (change passcode while signed in, clearing unfinished sign-ups, checking email, changing email or phone, a minimum age to create a School) were answered on 28 Oct 2026: see Decision 375.

### Recorded by

Claude, from the Sign-in and accounts review, 27 Oct 2026.

## Decision 375 — Sign-in and accounts: the five questions answered

**Date:** 28 Oct 2026 · **Status:** Product owner's answers to the Sign-in and accounts review's questions · **Builds on:** Decisions 361 and 373

### Decision

1. **Change passcode on My profile (Q1).** A signed-in person can change their passcode: current passcode, then the new one twice. `POST /v1/auth/passcode-change` checks the current passcode (wrong guesses count toward the same 5-try lockout as Log in), refuses the same passcode again, and signs out every other device: all refresh tokens are revoked and `User.rolesChangedAt` is moved, so other devices' access tokens are refused on their next request (Decision 361's check) instead of up to 15 minutes later. The device that made the change gets a fresh pair and stays signed in.
2. **An unfinished sign-up can be replaced after 30 minutes (Q2).** When someone signs up with an email or phone that belongs to an account whose phone was never verified, and that account is more than 30 minutes old, the new sign-up replaces it in place: every profile field and the passcode are overwritten and the 30 minutes restart. Only a plain self-registration qualifies: it has a phone, it isn't an account added by staff waiting for its first passcode change, it holds no role anywhere, and the email, phone and username match that one account only. A verified account is never touched; anything else is still "already exists".
3. **Checking email at sign-up (Q3): v1.3, with Postmark.** Sign-up will also send a 6-digit email code once Postmark email is live. Added to the list to discuss with Gus.
4. **Changing email or phone (Q4): v1.3, with a code** sent to the new address or number, once email and text messages are live.
5. **18 or over to create a School (Q5).** Creating a School is refused for anyone under 18 by date of birth: "You must be 18 or over to create a School." (403). Existing Schools are not affected.

No migration.

### Recorded by

User (Code), 28 Oct 2026, answering the five decision cards in the Sign-in and accounts thread: "Add it, sign out other devices", "Replace after 30 minutes", "v1.3, with Postmark", "v1.3, with a code", "18 or over".

---

## Decision 376 — The per-IP limit applies only to callers who aren't signed in

**Date:** 28 Oct 2026 · **Status:** Product-owner decision · **Amends:** Decision 17 (per-user/per-IP throttling) · **Found by:** stress test round 3

### Decision

1. **Not signed in:** every route keeps its limit per IP address: 60 requests a minute by default, tighter where the route sets its own (login, sign-up codes, public School search, guest waiver links).
2. **Signed in** (a valid, unexpired access token): no per-IP limit. Everyone at a School on the same WiFi shares one address, so a busy front desk could otherwise be stopped by the rest of the School's traffic. Each signed-in user keeps their own limits: 1,000 requests a minute overall, plus the per-route limits already set (bookings, waitlist, Add manually, invites, step-up).
3. **A route with its own tighter limit** keeps it for signed-in callers too, counted per user instead of per address (bulk promote: 30 a minute per person).
4. Only a token the API itself verifies counts as signed in; a made-up or expired token is treated as not signed in.

### Recorded by

User (Code), 28 Oct 2026: "yes, build the per-IP limit change", to the proposal "keep the strict per-IP limit only for unauthenticated requests".

---

## Decision 377 — Check-in and front desk review: seats after check-in, QR checked on scan, waiver status at the desk, guests one by one

**Date:** 28 Oct 2026 · **Status:** Product-owner decision · **Builds on:** Decisions 107 (QR check-in), 315/317/320/351 (front desk), 366 (guest waivers) · **Review:** the "Check-in and front desk review" doc (bugs CI1–CI10, questions Q1–Q4); `docs/handover/FRONT-DESK-BACKEND-HANDOVER.md`

### Decision

1. **A checked-in booking still holds its seat.** Seats taken = Upcoming and Completed bookings, each with their guests, everywhere seats are counted (booking, waitlist join and claim, capacity changes). Before, each check-in freed a seat, so a full class could be booked past its limit (CI1).
2. **The desk never books a class it can't check into yet.** The welcome card shows a class whose check-in hasn't opened (the School's "check-in opens N minutes before") with "Check-in opens at …" and it can't be ticked (CI2).
3. **The app QR is checked once, when it's scanned (Q2).** `POST /schools/{schoolId}/front-desk/qr-lookups` verifies the ~20-second QR and returns who it is plus a lookup token valid for 5 minutes, for that student, School and staff member only. `POST /classes/{id}/attendance-scan` accepts `lookupToken` in place of `studentToken`, recorded as `INSTRUCTOR_SCAN`. The QR of someone who isn't a current student at the School is refused (CI6).
4. **Waiver status on the welcome card (Q4, handover F4).** `GET /students/{id}/waiver-status?schoolId=` (any staff at the School) → `{ signed, toSign: [{ waiverId, title }] }`: whether they hold a waiver that counts for booking, and the School's current waivers they haven't signed. The other "Soon" parts (personal code, tablet sign-up, Find me, open mat) stay in v1.3.
5. **Exit stays as it is until the locked session (Q1).** Front-desk mode keeps running in the staff member's own login with its warning banner until v1.3's locked session.
6. **Guests are checked in one by one (Q3).** The welcome card lists each guest under their member's class, with their own tick and waiver status, unticked until staff tick the ones who came. `POST /bookings/{id}/guests/{attendeeId}/check-in` (staff at the School or Branch, same check-in window as the member, booking Upcoming or checked in) records `BookingAttendee.checkedInAt` and `checkedInById`. The member's own check-in no longer counts for their guests. A guest has no account, so nothing is credited toward grading. Built in its own PR (migration `20261215000000_guest_check_in`).

### Recorded by

User (Code), 28 Oct 2026, on the decision cards: "Fix all 10 in one PR", "Leave until v1.3" (Exit), "Check QR once on scan", "Tick each guest separately", "Only waiver status now".

---

## Decision 368 — School settings page review: 11 fixes, join code, School logo and colour, currency guard, Franchise name check

**Date:** 27 Oct 2026 · **Status:** Product-owner decision (fixes and Q1–Q5, "All recommended") · **Builds on:** Decisions 257 (footer), 266 (join code, School colour), 291/292 (cancellation settings), 322 (late cancel), 334 (plan currency), 350/352 (Franchise branding and join requests), 364 (School self-close) · **Number note:** 367 is taken by the Dashboard review (PR #347).

### Fixes

1. **S1** — Switching School in the header now starts every card on the School page afresh. Before, the Class cancellations and Footer cards kept the first School's values, and saving wrote them onto the second School.
2. **S2** — Saving one card no longer wipes what's typed but unsaved in the School details card.
3. **S3** — The no-show fee (School and Branch) is typed in normal units ("10.50"), not hundredths, with the currency shown; a wrong amount says so.
4. **S4** — A closed School's page is read-only: the closed notice sits at the top; forms are disabled; join code, Franchise actions and Close School are hidden.
5. **S5** — Footer social links must start with http(s)://. The portal adds https:// when it's missing; the API refuses links without it.
6. **S6** — See Q3.
7. **S7** — A load error shows the error; a non-owner opening /school is told the page is for School Owners (both used to spin for ever).
8. **S8, S9, S10** — The waitlist window is required, with a plain message; the School name is trimmed and can't be blank; footer email/link errors are plain messages, in all 15 languages.
9. **S11** — GET/PATCH /schools/:id (seen by every member) no longer include the Stripe subscription ids or the platform subscription status. Nothing read them.

### Answers (all the recommendations)

1. **Q1 Join code.** The School page shows the join code with Copy and "Make a new code", which asks first (the old code stops working; joined students stay).
2. **Q2 Logo and colour.** School details gets a logo upload (new `SCHOOL` upload type, Owner/Manager only, not at a closed School) and a colour picker for `School.accentColor`; both show in the student app (Decision 266).
3. **Q3 Currency.** A plan with no currency of its own is charged in the School's (Decision 334). While any live, paid plan does, changing the School currency asks first (409 `SCHOOL_CURRENCY_CHANGE_CONFIRM`, then `confirmCurrencyChange: true`), saying how many plans move, and clearing it is refused (409 `SCHOOL_CURRENCY_IN_USE`).
4. **Q4 Franchise name check.** "Ask to join" first shows "You're asking to join <name>" (GET /schools/:id/franchise-preview, School Owner only, same checks as joining); "Send request" sends it. Showing the Franchise on the School itself stays "both must allow" (Decision 350).
5. **Q5 Layout.** Visual only: School details is split into three headed groups (School details, Bookings and check-in, Staff and ranks), and the late-cancel setting (Decision 322, School-wide) moves into the Class cancellations card.

### Not changed

- Who can close a School: still any Owner/Manager, until the main-owner role from the Staff work lands.
- No migration.

### Recorded by

User (Code), 27 Oct 2026: "All recommended", after the School settings review (S1–S11, Q1–Q5).

---

## Decision 370 — Main owner and co-owners

**Date:** 27 Oct 2026 · **Status:** Built · **Follows:** Decision 360 (item 3), Decision 270 (an owner may make another person an owner of their own School)
**Numbering:** 367–369 are in use on other open branches; this takes 370.

### Decision

1. **One main owner per School.** `RoleGrant.isMainOwner` marks it, with a database rule that a School has at most one live, flagged owner grant. Whoever creates a School is its main owner. Existing Schools: the migration flags the earliest live owner grant (the product owner's rule). Where no live grant is flagged (the main owner's account was deleted, or rows written outside the API), the earliest live owner grant counts as the main owner, so a School with owners always has one.
2. **Co-owners.** Every other owner is a co-owner, with the same powers as the main owner except the two below. "Give role" on the Staff page can now give the owner role ("Co-owner"); the API already allowed it (Decision 270).
3. **Removing owners.** Any owner can remove a co-owner, including themselves, through the existing revoke (`DELETE /users/:userId/role-grants/:id`). Nobody in the School can remove the main owner: that answers `403` with code `MAIN_OWNER` and tells them to contact ULTM8 support. "Remove from School" still ends coach and Branch Staff roles only.
4. **Handing over.** `POST /schools/:schoolId/main-owner` `{ userId }`: only the main owner, only to a current co-owner, and only with a passcode check (the existing step-up token, `x-step-up-token`, from `POST /auth/step-up/verify`). The former main owner stays an owner, as a co-owner.
5. **ULTM8 support.** `GET /platform-admin/schools/:id/owners` (any admin tier, audit-logged `VIEW_SCHOOL_OWNERS`) lists the owners. `POST /platform-admin/schools/:id/main-owner` `{ userId, removeFormerMainOwner? }` moves the main owner role to a current co-owner and can end the former main owner's owner role in the same step (Full Admin only, like closing a School; audit-logged `CHANGE_SCHOOL_MAIN_OWNER` with who it moved from and to). Shown as an Owners card on the Platform Admin School page.
6. **No forced sign-in refresh.** Which owner is main doesn't change anyone's access, and access tokens don't carry it, so Decision 361's trigger skips an update that changes only `isMainOwner` (and Prisma's `updatedAt`).

### Choices made here, not by the product owner

- The support action is Full Admin only, matching the other School-level account changes (close and reactivate).
- Support can move the main owner role only to someone who is already a co-owner. A School whose only owner has lost their account has no co-owner to move it to, and support can't add an owner here. That case is **[UNRESOLVED]**: not built, for the product owner to decide.

### Recorded by

User (Code), 26–27 Oct 2026, Staff thread (Decision 360 item 3).

## Decision 378 — Front desk: one all-or-nothing check-in for several classes

**Date:** 28 Oct 2026 · **Status:** Product-owner decision · **Builds:** front-desk backend handover F7 · **Follows:** Decision 377 (QR checked on scan, guests one by one)

The product owner asked for the front-desk items whose rules are already decided to be built ("build them", 28 Oct 2026). F7, the handover's recommended single check-in call, comes first because the locked tablet session (F1) uses it.

### Decision

1. **One call for the welcome card's confirm.** `POST /schools/{schoolId}/front-desk/check-ins` `{ studentId, lookupToken?, classIds[], guests?: [{ bookingId, attendeeId }] }`, for staff at the School (Branch Staff only for their Branch's classes and Whole School classes). For each ticked class it books the place where the student has none (a staff booking, with every booking rule: membership, waiver, belt, seats), then checks the student in. Then it checks in the ticked guests.
2. **All or nothing.** Everything that can be checked first is: the class exists, is not cancelled, check-in is open, the guest is on the student's booking and not already in. Then all of it happens in one transaction. If any item can't be done, nothing is saved: no booking, no credit spent, no check-in.
3. **The reply says which item stopped it.** It is always `200` with `{ done, classes: [{ classId, ok, bookingId?, code?, message? }], guests: [{ attendeeId, ok, checkedInAt?, code?, message? }] }`. The card shows each reason next to the class's name, in the screen's language.
4. **How the check-in is recorded doesn't change:** `INSTRUCTOR_SCAN` with a scanned QR's lookup (Decision 377), otherwise `INSTRUCTOR_MANUAL`, with the staff member as `checkedInById`. The per-class `POST /classes/{id}/book` and `POST /classes/{id}/attendance-scan`, and `POST /bookings/{id}/guests/{attendeeId}/check-in`, stay for the other screens.

### Not in this decision

- The School's check-in rules (handover F9) aren't defined yet. When they are, their reasons come back in the same `code`/`message` shape.

### Recorded by

User (Code), 28 Oct 2026: "build them", for the six front-desk items whose rules are decided.

---

## Decision 379 — A parent books a class for their child, with guests

**Date:** 28 Oct 2026 · **Status:** Approved by product owner (Waivers decision card "How should guests on a child's booking work?": "Build a parent booking screen"; earlier "go" to guests on a parent's booking but not in Kid Mode)
**Resolves:** Decision 366's open item "Guests on a booking a Guardian makes for a child, or through Kid Mode". No database change.

### Background

The API already let a Guardian book, cancel and join the waitlist for a linked child (`studentId` on the booking, cancel and waitlist requests), and let a booking carry guests on the organizing student's Friend Passes. The Student app had no screen for a parent to book their child, so a parent could not bring guests on a child's booking. Kid Mode (Decision 123) books the child from the parent's device.

### Decision

1. **Parent booking screen in the Student app.** My Minors has a "Book a class" button per child. The screen lists the child's upcoming bookings, lets the parent pick one of the child's Schools, and shows that School's upcoming classes with the same booking row a member uses: book in the child's name, add guests, and join the waitlist for the child when a class is full.
2. **Guests are paid with the child's own Friend Passes**, as the booking's organizer is the child (SKILL.md §10, unchanged API rule). A pass for this class only is used first, as for members.
3. **The parent shares each guest's signing link** (Decision 366) after booking and from the child's upcoming bookings, and can cancel the child's booking (with the existing `studentId` cancel path).
4. **New Guardian reads**, each checking the caller is the child's Guardian (`assertGuardianOfStudent`) and reading under the child's tenant context (Decision 92):
   - `GET /guardians/me/minors/:studentId/schools`: the Schools the child has a current Student role at (School not archived), by name.
   - `GET /guardians/me/minors/:studentId/bookings`: the child's Upcoming bookings for classes that haven't ended, soonest first (up to 100), with class title, start and guest count.
   - `GET /guardians/me/minors/:studentId/friend-passes?schoolId=`: the child's usable Friend Passes at that School.
   - `GET /guardians/me/minors/:studentId/bookings/:id/guests`: the guests and their links on the child's booking (404 when the booking isn't the child's).
5. **No guests in Kid Mode.** A Kid Mode booking with guests is refused with `NO_GUESTS_IN_KID_MODE` (403); Kid Mode booking alone is unchanged.
6. Every new text is translated into all 15 languages, including the new API message.

### What this does NOT resolve

- Per-guest check-in stays with the Check-in work (Decision 377).
- The class list is the School's public upcoming classes, the same list the Academy page shows a member.

### Recorded by

User (Code), 28 Oct 2026, Waivers thread.

