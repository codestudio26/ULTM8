# ULTM8: onboarding a second developer

Written 8 Nov 2026, against `master` at `c521910` (after PR #526). It is the
full pathway for a second person, working with their own Claude, to build on
ULTM8 and merge into GitHub alongside the product owner.

Facts here go stale. Before relying on any status line, check it against the
code, `git log`, the decision log and the backlogs, as `CLAUDE.md` says.

Contents:
1. What ULTM8 is, and where the truth lives
2. Access: what the product owner sets up
3. Your machine: Codespace or local
4. Environment variables
5. How we work: branches, PRs, CI, decisions, migrations
6. Deploying: Vercel, Render, Supabase
7. Open items right now
8. Starter prompt for your Claude

---

## 1. What ULTM8 is, and where the truth lives

A multi-tenant SaaS for martial-arts and sports schools: Franchise → School →
Branch, Students and Guardians, Instructors/Coaches, belt grading, classes and
bookings, memberships and payments (Stripe), waivers, QR check-in.

| Part | Folder | Stack |
|---|---|---|
| API | `apps/api` | NestJS + Prisma + Postgres with Row-Level Security, Redis |
| School Portal (owners, staff, coaches) | `apps/school-portal` | Vite + React |
| Platform Admin (ULTM8 support) | `apps/platform-admin` | Vite + React |
| Student/Guardian app ("Track B") | `apps/student` | Expo / React Native |
| Shared code | `packages/*` | TypeScript |
| Infra | `infra/`, `render.yaml` | Terraform (future AWS), Render Blueprint (staging) |

Read these, in this order:

1. `CLAUDE.md`: the project rules and source-of-truth order. Your Claude
   reads it automatically.
2. `CONTRIBUTING.md`: how two people work without colliding.
3. `skills/ultm8-domain-rules/SKILL.md`: the business rules, tagged
   `[CONFIRMED]` / `[UNRESOLVED]` etc. Load it before any domain work.
4. `docs/decisions/POST-SPEC-55-DECISION-LOG.md`: every product decision
   since the spec (Decision 70 onward; 448 is the newest at the time of
   writing). Append-only.
5. `docs/v1.3-backend-backlog.md`: what's planned next.
6. `SETUP.md` (run it), `HANDOFF.md` (daily habit),
   `docs/deploy/STAGING-RUNBOOK.md` (how staging is hosted).

The canonical spec is
`deep-review/ULTM8-Dev-Handover-v55/ULTM8_Technical_Specification_55.docx`.
For grading, the prototype rules win where a numbered decision says so
(Decision 124 onward).

## 2. Access: what the product owner sets up

These steps need the product owner's own hands. Nothing in the repo can do
them.

| # | Where | What | Needed for |
|---|---|---|---|
| 1 | GitHub → repo **Settings → Collaborators → Add people** | Invite the coworker with **Write** access. They accept the email invite. | Pushing branches, opening and merging PRs |
| 2 | GitHub → **Settings → Branches → Add branch ruleset** (or classic "branch protection rule") for `master` | Require a pull request before merging; require status checks *Cross-tenant isolation gate (required)*, *Build & unit tests*, *Portal browser tests (Chromium)*; block force pushes and deletion. Optional: require 1 approval. | Nobody (human or Claude) pushes to `master` by accident |
| 3 | GitHub → **Settings → General → Pull Requests** | Tick **Allow squash merging** only; untick merge commits and rebase merging. Tick "Automatically delete head branches". | The team's always-squash rule, enforced |
| 4 | GitHub → **Settings → Tags** (or a tag ruleset) | Protect `v*` tags from deletion and updates. | `v1.0.0` is frozen |
| 5 | Supabase → **Organization settings → Team → Invite** | Invite the coworker (Developer role is enough). Optional. | Running migrations themselves, reading the DB |
| 6 | Render → **Workspace settings → Members** | Invite if your plan allows members. Optional. | Redeploying the API, reading logs |
| 7 | Vercel | The free Hobby plan has no team members. Not needed: `master` deploys by itself. | (none) |
| 8 | Stripe → **Settings → Team and security → Add member** | Optional, test mode only. | Checking test payments and webhooks |
| 9 | Claude (coworker's own account) | Connect their GitHub at claude.ai/connect-github. If they use Claude Code on the web, the Claude GitHub App must cover this repo (the owner installed it already; an owner may need to approve). | Their Claude can clone, push and open PRs |

Never send a password, key or connection string over chat or email. If the
coworker needs a secret, they get dashboard access (rows 5, 6, 8) and copy it
from there.

## 3. Your machine: Codespace or local

**Codespace (what the product owner uses).** On GitHub → **Code →
Codespaces → Create on master**. The dev container installs everything,
starts Postgres 16 and Redis, applies migrations on every start, and installs
the Claude Code CLI. Then follow `SETUP.md`: seed dummy data
(`node prisma/seed-dummy-data.js` in `apps/api`), start the API and the
portal, set the forwarded URLs. Each person uses **their own** Codespace;
the database inside it is private to that Codespace.

**Local.** Node 20+, npm 10, Docker (for Postgres 16 + Redis 7, see
`.devcontainer/docker-compose.yml`). Then:

```bash
npm ci
cp apps/api/.env.example apps/api/.env          # point DATABASE_URL at your local Postgres superuser
cp apps/school-portal/.env.example apps/school-portal/.env.local
cd apps/api && npx prisma migrate deploy && npx prisma generate
node prisma/seed-dummy-data.js
npm run dev                                       # API on :3000
# second terminal
cd apps/school-portal && npm run dev              # portal on :5173
```

Dummy logins (passcode `123456`): `dev@ultm8.local` (School Owner + Student),
`coach.alex@ultm8.local` (Instructor), `jamie.lee@ultm8.local` (Student).

## 4. Environment variables

The names are in `apps/api/.env.example`, `apps/school-portal/.env.example`,
`apps/platform-admin/.env.example` and `render.yaml`. For local work only the
database URLs, `REDIS_URL`, `JWT_ACCESS_SECRET`, `PLATFORM_ADMIN_JWT_SECRET`,
the two `QR_*_SECRET`s and `CORS_ALLOWED_ORIGINS` matter. In the Codespace the
dev container already sets them (`.devcontainer/docker-compose.yml`); locally,
start from `.env.example`. Vendor keys (Stripe, Twilio, Postmark,
R2, FCM, Cloudflare Stream, Google Places) can stay empty: the API boots and
says which ones are missing. For tests, use the fake values CI uses
(`.github/workflows/ci.yml`, top of the `cross-tenant-isolation` job).

Important: each Prisma client connects as its own scoped Postgres role
(`ultm8_app`, `_auth`, `_jobs`, `_discovery`, `_platform_admin`,
`_grading_erasure`). An unset scoped URL falls back to the superuser and
bypasses RLS. Never "fix" a connection error by pointing one at the superuser.

## 5. How we work

The short version is in `CONTRIBUTING.md`. The points that matter most with
two people:

- **One branch per feature, from the latest `master`.** Merge `master` into
  your branch to update it; don't rebase.
- **Always "Squash and merge".**
- **CI must be green.** Before pushing API changes:
  `cd apps/api && npx eslint src test --max-warnings 0` (one warning fails
  CI), plus `npx turbo run lint` and the tests for what you changed.
- **Decision numbers:** put "Decision N" in your PR title as the claim; check
  `master` and open PRs first; whoever merges second renumbers.
- **Migrations:** the folder name must sort after the newest on `master`;
  never touch a merged one; put the migrate steps at the top of the PR.
- **CHANGELOG:** user-visible changes under `## Unreleased`.
- **Tell each other what you're on.** A one-line message ("I'm on
  Timetable filters, branch `feature/timetable-filters`") prevents two people
  building the same thing.
- **Product questions go to the product owner**, not to the code. If the spec
  or a decision doesn't confirm a rule, it is `[UNRESOLVED]`: stop and ask.
  Questions for Gus (the grading/product collaborator) are collected in the
  product owner's "discuss with Gus" list.

## 6. Deploying: Vercel, Render, Supabase

Staging today (production will be AWS via `infra/terraform`; region not
decided):

| Piece | Where | How it deploys |
|---|---|---|
| School Portal | Vercel project `ultm8-school-portal` | Every push to `master` = production deploy; every other branch = preview. Free plan: **100 deploys a day**. When it's hit, deploys fail for ~24 h; that's not a code bug. |
| Platform Admin | Vercel project `ultm8-platform-admin` | Same as above |
| API + Redis | Render, from `render.yaml` (`ultm8-staging-api`) | Render dashboard → **Manual Deploy → Deploy latest commit**. The Blueprint build runs `prisma migrate deploy` and rotates the role passwords, but only if the dashboard Build Command was synced from the Blueprint. |
| Postgres | Supabase (free plan; move to paid before launch at scale) | Migrations are **manual** unless the Render build ran them |

Running the migrations by hand (safe to repeat):

```bash
git checkout master && git pull origin master
cd apps/api
# DATABASE_URL = the Supabase superuser string, copied from Render's
# environment settings. Never paste it into a chat.
npx prisma migrate status      # shows what's pending
npx prisma migrate deploy      # applies the pending ones in order
npx prisma generate
# then redeploy/restart the API on Render
```

Watch the output for a "Decision 295" duplicate-email warning; if it shows,
stop and look before continuing. Never run the stress scripts
(`apps/api/scripts/stress/`) against staging: they create and change large
amounts of data.

**Sharing the Supabase database.** Both developers may use the same
Supabase project (the coworker gets their own Supabase login, see §2 row 5).
One rule: **run `prisma migrate deploy` against Supabase only from an
up-to-date `master`**, never from a feature branch. A branch's migration
applied to the shared database before it merges leaves the live API and the
other developer's work out of step with `master`, and a migration can't
easily be undone. For day-to-day coding, use your own Codespace (or local)
database, so half-built migrations and test data stay out of the shared one.
The free Supabase plan also has a small connection limit; don't point local
APIs at it.

The Codespace is separate: its database migrates on every Codespace start
(and you run the three commands above after pulling a branch with a new
migration).

## 7. Open items right now (8 Nov 2026)

Check each against the repo before acting.

- **Open PR #524** (Decision 448 items 6, 7, 9, 11, 17). Owned by the
  product owner's session; don't push to it.
- **Decision 448** has other items marked "To be built". Read it before
  picking up money, privacy or access work.
- **Legal pages:** first code fixes (Decision 444, PR #502) are merged. The
  pages themselves are reviewed drafts, not yet loaded into the app; more
  code fixes are waiting for the product owner's go-ahead. A lawyer must
  check the text before launch.
- **Sole School owner who loses access:** support cannot add a new owner.
  Unresolved; needs a product decision.
- **Google Places address lookup:** decided (Decision 212) but not built,
  waiting on the product owner's Google Cloud API key (v1.3 backlog §3.16,
  §4.3). The key goes into Render's environment as `GOOGLE_PLACES_API_KEY`,
  never into the repo or a chat.
- **Deferred to v1.3 (Decision 267 and later):** push notifications
  (FCM/APNs credentials), Curriculum video (Cloudflare Stream + AWS
  Transcribe, Gus owns account verification), email codes at sign-up with
  Postmark, Stripe webhook events `charge.refunded` /
  `charge.refund.updated`, notification settings and auto-cleanup, Vancouver
  time-zone data on Render (§3.23). Full list: `docs/v1.3-backend-backlog.md`.
- **Questions waiting on Gus:** waitlist claim window (questions 2–5),
  build details of the class cancellation policy, email checks at sign-up.
- **Grading is out of the current testing round's scope.**

## 8. Starter prompt for your Claude

Paste this as the first message in a new Claude Code session on this repo
(Codespace terminal: run `claude`; or Claude Code on the web with this repo
selected).

```text
You're joining ULTM8 as a second developer's Claude. Another developer (the
product owner) works on the same repo with their own Claude, so we must not
collide.

Before doing anything:
1. Read CLAUDE.md, CONTRIBUTING.md and docs/handover/COWORKER-ONBOARDING.md
   in full, and follow them. CLAUDE.md's rules (verify before acting, never
   invent business logic, keep tenant isolation and RLS intact, ask before
   destructive steps) apply to you exactly as written.
2. Load skills/ultm8-domain-rules/SKILL.md before any work touching domain
   rules.
3. Run `git fetch origin master`, then tell me: the newest Decision number
   in docs/decisions/POST-SPEC-55-DECISION-LOG.md, the newest migration
   folder in apps/api/prisma/migrations, and the open PRs on
   codestudio26/ULTM8 (title + branch), so we know what's taken.

How we work:
- Every task on its own branch from the latest origin/master
  (feature/<name>), one feature per PR, never push to master or to the other
  developer's branch.
- Before pushing API changes run `cd apps/api && npx eslint src test
  --max-warnings 0`, `npx turbo run lint` and the relevant tests.
- New decision: claim the next free number by putting "Decision N" in the PR
  title; re-check master just before merge and renumber if it was taken.
- New migration: name must sort after the newest on master; put the
  migrate steps at the top of the PR description.
- Add user-visible changes under "## Unreleased" in CHANGELOG.md.
- Merge only with "Squash and merge", and only when I say so.
- Never commit secrets or ask me to paste one.
- If a rule isn't confirmed by Spec 55, SKILL.md or the decision log, stop
  and ask me; I'll check with the product owner.

My first task: <describe it here>.
```
