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
