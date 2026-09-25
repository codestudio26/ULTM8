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

## Versioning

**Version 1 is frozen as the annotated git tag `v1.0.0` (commit `11da406`).** It must never change.

- **Scope of V1: Track A only** — `apps/api`, `apps/school-portal`, `apps/platform-admin`, the shared `packages/*`, and `infra/`. **Track B (`apps/student`) is NOT part of V1 and is not frozen.** A partial copy of `apps/student` exists inside the V1 snapshot only because PR #81 had synced it to `master`; it carries no version meaning and Track B keeps developing independently.
- **The `v1.0.0` tag sits beside `master`, not on it.** It is `master` as of PR #85 plus PR #78's V1 work (Decisions 114–121), but *excludes* PR #78's three redesign commits (Instructors page redesign + app-shell header, and the redesign backend backlog), which were squash-merged into `master` together with it. Those are the first post-V1 work.
- **Never move, delete, re-create, or force-push any `v*` tag**, and never commit to a `release/*` branch unless the user explicitly asks.
- **Version numbers are assigned by the user**, as work accumulates ("this is v1.1", etc.). Never pick a version number or create a tag on your own. Informal version names inside docs (e.g. `docs/v1.2-backend-backlog.md`) are not version assignments.
- **`master` is the latest development line.** Do each page redesign or feature on a short-lived branch created from the latest `master` (e.g. `redesign/<page>`, `feature/<name>`), one page/feature per PR, merged when done. No long-lived, never-merged branches. Don't push new, unrelated work onto another open PR's branch — that is how redesign work ended up bundled into V1's PR #78.
- **Record every user-visible change** under `## Unreleased` in `CHANGELOG.md`. When the user declares a version, rename that heading to the version and tag the release commit (with the user's go-ahead).
- **A redesign is visual/UX first.** Don't change business rules, the data model, API contracts, tenancy/RLS, or security behaviour as a side effect; anything the spec doesn't confirm follows the standing rules above (`[UNRESOLVED]` → ask).
- **Fixing V1 itself** (only if the user asks): branch `release/1.0` from `v1.0.0`, fix there, tag `v1.0.1`.
- **Comparing versions:** `git diff v1.0.0 master -- apps/school-portal` for code; `git checkout v1.0.0` (or a deployment pinned to the tag) to run V1 side by side with `master`.

## Current phase

**Updated 25 Sep 2026** (verified against the repository, not assumed):

- **Track A — V1 frozen** as `v1.0.0` (see "Versioning" above): `apps/api` (NestJS + Prisma + Postgres RLS, covering tenancy, auth, Students/Instructors/Guardians, grading, classes/bookings/waitlist, memberships/payments, waivers, QR attendance, notifications, and Platform Admin), `apps/school-portal` (School Owner/Staff web app), and `apps/platform-admin`. Post-Spec-55 decisions run 70–121 as of V1 (`docs/decisions/POST-SPEC-55-DECISION-LOG.md`).
- **Post-V1 work on `master`:** page-by-page redesign of `apps/school-portal` plus new features, starting with the Instructors page and app-shell header. See `CHANGELOG.md` → Unreleased.
- **Track B — `apps/student`** (Student/Guardian React Native app): in active development, not part of V1. A partial copy is on `master` (PR #81); later work is on `track-b-student-app-pka8oo` / PR #82. See `docs/TRACK-B-ROADMAP.md` on that branch for its own status.
- Known V1 gaps and deliberately deferred items are listed in `CHANGELOG.md` under v1.0.0.

Treat git history, the decision log, and each app's own code as the source of truth for what's built — not a static status paragraph. Still applies: don't begin work in an area without checking the actual current code first, and don't assume a feature is unbuilt (or built) without verifying.
