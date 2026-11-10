# Contributing to ULTM8

Two people now work on this repo, each with their own Claude. These are the
rules that keep the two lines of work from colliding. New here? Read
[docs/handover/COWORKER-ONBOARDING.md](docs/handover/COWORKER-ONBOARDING.md)
first, then `CLAUDE.md`.

## 1. Branches and pull requests

- `master` is the only long-lived branch. Never push to it directly.
- Start every piece of work on a new branch from the latest `master`:
  `git fetch origin master && git checkout -b feature/<short-name> origin/master`
  (`fix/<name>`, `docs/<name>` and `claude/<name>` are fine too).
- Both developers share one GitHub account, so the coworker's branches start
  with their initials (`ab/feature-<name>`), their PR titles with `[ab]`, and
  they set their own `git config user.name` / `user.email` so commits show who
  wrote them. The owner approves the coworker's PRs in chat before merge.
- One feature or fix per PR. Don't push to the other person's branch unless
  they've asked you to.
- Keep your branch current by **merging** `master` in
  (`git merge origin/master`), not rebasing. Squash-merge makes the history
  flat anyway, and rebasing a branch that already merged `master` in fails.
- **Always "Squash and merge".** Never "Rebase and merge" or a merge commit.
- Merge only when CI is green and the other person (or the product owner)
  has said yes. Claude merges only when its own user says so.
- Never move, delete or force-push a `v*` tag, and never commit to a
  `release/*` branch unless the product owner asks (see `CLAUDE.md` →
  Versioning).

## 2. Before you push

```bash
# API changes: CI fails on any ESLint warning
cd apps/api && npx eslint src test --max-warnings 0
# Type checks for every workspace (what CI's "lint" step runs)
npx turbo run lint
# Unit tests for what you touched
npx turbo run test --filter=<workspace>
```

CI (`.github/workflows/ci.yml`) runs three jobs on every PR:
**Cross-tenant isolation gate (required)**, **Build & unit tests**, and
**Portal browser tests (Chromium)**. All three must pass.

A red "Vercel – ultm8-school-portal" status that says *Deployment rate
limited* is Vercel's free-plan limit (100 deploys a day), not a code problem.
The GitHub Actions checks decide whether a PR is mergeable.

## 3. Decision numbers (the most common collision)

Product decisions go in `docs/decisions/POST-SPEC-55-DECISION-LOG.md`, one
numbered entry each, append-only. When two people work in parallel, both pick
"the next number" and collide. This has happened several times already. To
avoid it:

1. Before you write a decision, look at **both** `master` and the open PRs:
   `git fetch origin master && grep -n "^## Decision" docs/decisions/POST-SPEC-55-DECISION-LOG.md | tail -3`,
   then check the titles of open PRs on GitHub for "Decision N".
2. Take the next free number and put it in your **PR title** as soon as you
   open the PR (open it as a draft early if the work is long). The PR title
   is the claim.
3. Right before merging, check again. If someone else's merged PR took your
   number, renumber yours to the next free one (entry heading, references in
   code comments, CHANGELOG and docs). Whoever merges second renumbers.
4. Never renumber a decision that is already on `master`.

## 4. Database migrations

- Migrations live in `apps/api/prisma/migrations/`. Folder names sort by
  their timestamp prefix and **must sort after the newest one on `master`**.
  Before merging, check that's still true; if the other person merged a
  newer one meanwhile, rename yours (only while it is unmerged).
- Never edit or rename a migration that is already on `master`: the live
  database may have applied it.
- Any PR that adds a migration says so at the **top** of its description,
  with the exact steps:

  ```bash
  cd apps/api
  npx prisma migrate deploy
  npx prisma generate
  # then restart the API
  ```

- The live (staging) Supabase database is shared. Run
  `prisma migrate deploy` against it **only from an up-to-date `master`**,
  never from a feature branch. Develop against your own Codespace/local DB.
- The live (staging) database is migrated by hand, not by CI. See
  `docs/handover/COWORKER-ONBOARDING.md` §6.

## 5. Recording changes

- Every user-visible change gets a line under `## Unreleased` in
  `CHANGELOG.md`.
- The product owner assigns version numbers. Never create a tag or pick a
  version yourself.

## 6. Secrets

Never commit a secret, and never paste one into a chat (with Claude or
anyone else): DB passwords, connection strings, Stripe/Twilio/Postmark keys,
JWT secrets. Each lives only in the provider's dashboard (Render, Vercel,
Supabase, Stripe). `.env.example` files list the names, never the values.

## 7. Handing work over day to day

See [HANDOFF.md](HANDOFF.md): commit and push before you stop, even
half-done work, so the other person can pick it up.
