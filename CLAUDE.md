# ULTM8 — Project Guide for Claude

## Purpose & status

ULTM8 is a multi-tenant SaaS platform for Sports schools/clubs management — Franchise → School → Branch tenancy, Students and Guardian/minor accounts, Instructors, belt/rank grading, class scheduling, memberships, liability waivers, and QR-code check-in. The technical specification and domain rules have been reconciled and finalized (Spec 55). **Development is well underway** — see "Current phase" below for the verified state.

## Source-of-truth hierarchy

When sources disagree, resolve in this order, highest first:

1. **Current technical specification — Spec 55**
   `deep-review/ULTM8-Dev-Handover-v55/ULTM8_Technical_Specification_55.docx`
   The canonical reference for the data model, API surface, background jobs, payments, and NFRs. Its own Section 12.1 (decision log) is an audit trail, not a second source of truth; Section 12.2 (open items) is explicitly unresolved and must never be built against.
2. **Canonical domain rules**
   `skills/ultm8-domain-rules/SKILL.md`
   A tagged, scannable distillation of Spec 55's business rules. Load it before any work touching domain or business logic. If this skill and the current spec ever disagree, the spec wins — flag the mismatch, don't silently pick one.
3. **Approved architectural/product decisions** — as recorded in Spec 55 §12.1, or made directly with the product owner since. These never override Spec 55 Sections 1–11. Decisions made after the Spec 55 handover are recorded in `docs/decisions/POST-SPEC-55-DECISION-LOG.md` — an append-only log continuing the spec's own decision numbering, starting at Decision 70.
4. **Existing code** — once implementation begins, working code is authoritative for *how* something is built, but it never overrides an unresolved spec item simply by existing.
5. **Figma/design references** — illustrative only. Useful for screen inventory and observed UI flow, never a substitute for a confirmed business rule.

## Standing rules

- **Never act on an assumption — verify, then verify again, then ask.** When a task is ambiguous or something isn't explicitly confirmed, don't guess and proceed. Review your own answer or approach in depth before treating it as final, then take a second, independent pass to re-check that review before acting on it. If genuine uncertainty remains after that check, ask the user directly rather than filling the gap with an assumption.
- **Never invent unspecified business logic.** If a task touches something the spec doesn't confirm, mark it explicitly as unresolved and escalate — do not fill the gap with a plausible-sounding guess.
- **Load `skills/ultm8-domain-rules/SKILL.md` before any work involving domain or business rules** — roles, memberships, grading, bookings, attendance, waivers, Guardians/minors, multi-tenancy, or payments.
- **Respect the tagging discipline** used throughout the domain rules: `[CONFIRMED]` (safe to build against), `[OBSERVED IN DESIGNS]` (shown in Figma, not a business decision), `[UI BEHAVIOUR]` (an observed screen flow, not a stated rule), `[UNRESOLVED]` (a real gap — stop and escalate, never guess).
- **Do not begin implementation based solely on Figma designs.** A design file shows UI, not a confirmed data model or business rule — check it against Spec 55 and SKILL.md first.
- **Preserve multi-tenant boundaries and security assumptions.** Franchise → School → Branch isolation, Row-Level Security, and Platform Admin's separate identity realm are load-bearing. Never write a query, endpoint, or job that could cross a tenant boundary outside the isolation model the spec already commits to.
- **Inspect existing code before modifying it.** Understand current behaviour and its rationale before changing it — don't assume intent from a filename or a partial read.
- **No destructive changes without explicit approval.** Deleting, overwriting, force-pushing, or otherwise hard-to-reverse actions require the user's explicit go-ahead first.

## Git safety

- Git is initialized; an initial safety checkpoint commit exists.
- Review actual changes (`git status` / `git diff`) before staging or committing anything.
- Never stage broadly (e.g. `git add .`) without first reviewing exactly what's being added — stage specific, reviewed paths only.
- Do not commit or push without the user's request.

## Current phase

**Corrected 21 Sep 2026** — this section previously read "Development has not started... preparation/planning phase only," which was stale and contradicted the repository's actual state (verified directly, not assumed):

- `apps/api` — a NestJS + Prisma + Postgres RLS backend, 50+ shipped Phases (see `docs/decisions/POST-SPEC-55-DECISION-LOG.md`'s own numbering, Decisions 70–113 as of this correction), covering tenancy, auth, Students/Instructors/Guardians, grading, classes/bookings/waitlist, memberships/payments, waivers, QR attendance, notifications, and Platform Admin.
- `apps/school-portal` (School Owner/Staff web app) — 22 real, wired-in pages backed by real API calls.
- `apps/platform-admin` (web app) — 6 real, wired-in pages.
- `apps/student` (Student/Guardian-facing React Native app) — in active development on the separate `track-b-student-app` branch (see `docs/TRACK-B-ROADMAP.md` on that branch for its own detailed status); not yet merged to `master`.

Treat git history, the decision log, and each app's own code as the source of truth for what's built — not a static status paragraph. Still applies: don't begin work in an area without checking the actual current code first, and don't assume a feature is unbuilt (or built) without verifying.
