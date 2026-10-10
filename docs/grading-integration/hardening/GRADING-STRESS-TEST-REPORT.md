# Grading Stress Test — Report

> **Snapshot of 10 Oct 2026, against `master` @ `0362ddd`.** The findings below were fixed or decided afterwards; see [README.md](README.md) for where each one went. Line numbers refer to that commit.

**Run date:** 2026-10-10. Roadmap Phase 7, item 2
(`docs/grading-integration/GRADING-INTEGRATION-ROADMAP.md`): a "V1 stress-test"
style round on grading only. It covers ranks and ladders, the Grading Board,
eligibility, bulk promote, grading permissions, ladder edits, style templates
and Duplicate, and coach invites. It follows the format of
`docs/V1-STRESS-TEST-REPORT.md` and `docs/V1-STRESS-TEST-REPORT-ROUND3.md`.

**Code under test:** `master` at `0362ddd` (PR #131). The built `apps/api/dist`
was confirmed to match `src`: a fresh `tsc -p tsconfig.build.json` into a
separate directory differed from `dist` only in source maps.

**Nothing in the repository was changed during the round.** The scripts, data
and raw outputs stayed outside the repository. No fixes were made in this
round. Each finding
below proposes a fix.

## Environment

- Real Postgres 16 with RLS and real Redis, not mocked. A dedicated database
  `ultm8_hstress` was used, with all 55 migrations applied ("Database schema is
  up to date") and empty at the start (0 Users, 0 Schools).
- Roles: `DATABASE_URL` (superuser, used only to seed and to check state
  afterwards) and `DATABASE_URL_APP` etc. for the API, from `testhstress.env`.
- The built API (`node apps/api/dist/main.js`) ran as a separate process and
  was driven over real HTTP from standalone Node scripts (`fetch`, with
  `Promise.all` for the races), the same "live HTTP simulator" method as
  Rounds 1–3. The API used the code's own defaults: Prisma connection pool of
  9 (4 CPUs) and the interactive-transaction defaults.
- Performance and race runs used `THROTTLE_IP_LIMIT_PER_MINUTE=1000000`
  (port 3100). The throttle runs used a second process with the default
  60/min (port 3101).
- `PORTAL_BASE_URL=https://portal.example.test` was set. No email provider was
  configured. Coach-invite tokens were therefore made by inserting
  `CoachInvite` rows with a known token's SHA-256, the same way
  `coach-invites.e2e-spec.ts` reads them.
- Sandbox: 4 CPUs. One machine runs client, API and Postgres, so the absolute
  numbers are indicative. The ratios between paths are the useful part.
- Query counts came from a separate run with `ALTER DATABASE ultm8_hstress SET
  log_statement='all'` (this database only, reset afterwards) and the API
  restarted. Statements were counted in the Postgres log around each request.
  The transaction counts (`BEGIN`) were identical across two runs. The
  data-statement counts vary by about ±100 because BullMQ ready-check jobs
  write to the same database in the background. Treat them as approximate.

### Seed

| What | Count |
|---|---|
| Schools | A (3 branches, Sydney/Perth/null time zones), B (1 branch), C (no branches) |
| Styles in A from templates | 4 × each IBJJF template (90 / 139 / 175 rungs), plus duplicates |
| Board style | `ibjjf_kids_yellow #0`: 20 belts, **175 rungs** |
| Students on the board style (A) | **3,000**. Rungs spread 0–173, 30 at the top rung (174). 2,140 with a home branch (769 N / 750 S / rest E), 860 without. 2,233 memberships (≈60 % live). 3 skills required on rungs 6, 31 and 101 |
| Grading permission (all toggles) | coachN (Instructor, branch N), coachS (Instructor, branch S) |
| Other staff | staffN (Branch Staff, N, no grading permission) |
| School C | 3,000 students on a 175-rung style, one Instructor with grading permission, no branches |
| School B | owner, coach (branch, grading permission on B's own style), student |

Seeding 3,000 students took 1.5 s (`createMany`).

---

## 1. Large ladders (templates, ranks, eligibility, promote, reorder, belt edit)

Owner unless stated. n = sequential calls.

| Operation | n | p50 ms | p95 ms | max ms | Notes |
|---|---|---|---|---|---|
| `POST /schools/:id/disciplines/from-template` `ibjjf` | 4 | 105 | 159 | 159 | DB: 20 belts / **90** rungs ✅ |
| … `ibjjf_kids_red` | 4 | 102 | 109 | 109 | 20 / **139** ✅ |
| … `ibjjf_kids_yellow` | 4 | 115 | 122 | 122 | 20 / **175** ✅ |
| `POST /disciplines/:id/duplicate` (175 rungs, 3 skills, 9 rung–skill links) | 4 | 371 | 474 | 474 | Copy has 175 rungs, 3 skills, 9 links ✅ |
| `GET /styles/:id/ranks` (175 rungs) | 10 | 39 | 238 | 238 | 113 KB |
| `GET /styles/:id/rung-holders` (3,000 holders) | 10 | 266 | 311 | 311 | 294 KB |
| `GET /students/:id/eligibility` (rung 168–173) | 10 | 35 | 69 | 69 | as coachN: p50 46 / p95 58 |
| `GET /students/:id/rank-history` as coachN | 10 | 27 | 43 | 43 | |
| `POST …/promote` rung 0–4 → 170 (`targetRungId`) | 10 | 79 | 95 | 95 | `rungsSkipped` 165–169 recorded ✅ |
| `POST …/promote` default (next belt) | 10 | 65 | 83 | 83 | |
| `PUT /styles/:id/ranks/order` (20 belts: reverse, then restore) | 10 | 89 | 130 | 130 | 175-rung copy |
| `PATCH /ranks/:id` belt edit (12-rung belt, every rung's `classesRequired` +1) | 5 | 81 | 106 | 106 | |

**No problem at 175 rungs.** Every ladder operation is far under the 2 s mark.
`loadLadder` is one nested query, and the engine's work on 175 rungs is
negligible. A coach promote runs 10 transactions (≈46 data statements). A
`GET ranks` runs 2 transactions.

## 2. Board performance (3,000 students, one 175-rung style)

`GET /v1/schools/:id/grading-board?disciplineId=…`, 10 sequential runs after
one warm-up.

| Caller | Query | Items | Size | p50 ms | p95 ms | max ms |
|---|---|---|---|---|---|---|
| Owner | all | 2,970 | 2.2 MB | 764 | 895 | 895 |
| Owner | `activeOnly=true` | 1,819 (+1,151 hidden) | 1.35 MB | 821 | 956 | 956 |
| Owner | `search=stu12` | 110 | 82 KB | 728 | 747 | 747 |
| coachN (branch N, permission) | all | 769 | 572 KB | **7,400** | **8,169** | 8,169 |
| coachN | `activeOnly=true` | 461 (+308) | 343 KB | **7,055** | **7,548** | 7,548 |
| coachN | `search=stu12` | 36 | 27 KB | **7,365** | **8,041** | 8,041 |
| coachS (branch S, permission) | all | 750 | 559 KB | **6,798** | **7,660** | 7,660 |
| coachS | `activeOnly=true` | 484 (+266) | 360 KB | **7,554** | **9,685** | 9,685 |
| staffN (no permission) | all | 769 | 572 KB | **7,236** | **7,674** | 7,674 |
| School C owner (no branches) | all | 3,000 | 2.2 MB | 598 | 644 | 644 (n=3) |
| **School C coach (no branches)** | all | 3,000 | 2.2 MB | **30,102** | **30,104** | 30,104 (n=3) |

The board is complete: the item counts match the seed exactly (2,970 / 769 /
750; 30 top-rung students are correctly left off).

**Under concurrency:**

| Load | Board latency | An unrelated eligibility call meanwhile (baseline p50 30 / p95 39 ms) |
|---|---|---|
| 5 concurrent owner boards (run 3 times) | p50 2.5–2.95 s | p50 38–173 ms, but **one probe stalled 2.15–2.29 s in every run** |
| 5 concurrent coach boards | p50 13.4 s | p50 47 / p95 66 ms |
| 10 concurrent coach boards | p50 20.6 s, max 21.6 s | p50 88 / p95 112 ms |

**Query counts (one request each):**

| Request | Transactions | Data statements (≈) |
|---|---|---|
| Board, owner (2,970 rows) | 4 | 15 |
| Board, coachN (769 rows) | **785** | **5,470** |
| Eligibility, owner / coachN | 3 / 7 | 10 / ~15 |
| Bulk dry run 200, owner | **404** | ~1,800–2,400 |
| Bulk dry run 200, coachN | **1,405** | ~2,800–3,500 |
| Promote, coachN | 10 | ~46 |

**Where the owner board's time goes.** The service's in-memory work was
re-run against the same data (`profile-owner-board.js`, which calls the built
`eligibilityOnLadder`):

| Step | ms |
|---|---|
| DB reads | ~350–500 |
| The `find`/`filter` joins of grants × ranks/homes/memberships (O(n²)) | **~280–315** |
| `eligibilityOnLadder` for 2,970 rows | ~145–165 |
| Sort + JSON | ~15 |

### Bulk promote (`POST /schools/:id/grading/bulk-promote`)

| Caller | Students | Mode | n | p50 ms | p95 ms | Result |
|---|---|---|---|---|---|---|
| Owner | 200 | dry run | 8 | **4,563** | **4,861** | 159 ready / 41 need a look |
| coachN | 200 (own branch) | dry run | 5 | **7,423** | **10,077** | 151 / 49 |
| coachN | 150 own + 50 other branch | dry run | 3 | **6,684** | **6,853** | 50 correctly "not a student you can grade" |
| Owner | 200 | real | 1 | **13,260** | — | 200 promoted ✅ |
| coachN | 200 | real | 1 | **20,083** | — | 200 promoted ✅ |

## 3. Races

| Race | Calls | Result | DB state afterwards |
|---|---|---|---|
| Owner + coach promote the same student at once (**default** promote, no `targetRungId`) | 25 pairs (run 1) + 10 pairs (re-run) | Run 1: **25/25 pairs both 201**. Re-run: 5 × 201/409, **5 × 201/201** | Every double moved the student **two belts** (e.g. rung 42 → 66, belt order 4 → 6), two history entries 32–55 ms apart. → **Finding 6** |
| Same, but the portal's way (`targetRungId` = the next rung) | 10 pairs | 7 × 201/400 ("only moves up"), 3 × 201/409 | Exactly 1 event and 1 rung per student ✅ |
| Owner + coach **stripe award** at once (no target possible) | 10 pairs | **6 × 201/201**, 2 × 201/400, 2 × 201/409 | 6 students got **two stripes** → **Finding 6** |
| 10-way promote of one student, mixed callers and targets | 10 | 1 × 201, 5 × 400, 4 × 409 | 1 event, row matches the event ✅ |
| First grade (no StudentRank yet), 10 at once × 5 students | 50 | 12 × 201, 38 × 409 (P2002 → 409, "A record with this value already exists.") | **5** StudentRank rows (no duplicates ✅) but **12** promotion events: the later callers promoted again → Finding 6 |
| Two bulk promotes at once (owner 100 + coach 100, 50 overlapping) | 2 | Both 201. A promoted 100. B promoted 50; the other 50 went to `cannotPromote` with "Promote only moves up" | 150 events, 150 students, **0 promoted twice, 0 moved more than one rung** ✅ (12.7 s / 17.0 s) |
| Bulk promote (80 students) while 10 of them are downgraded 10 rungs **after the plan, before their promotion** | 1 bulk + 10 downgrades | All 201 | **10/10 downgrades undone**: e.g. `DOWNGRADE 146→136` then `BULK_STRIPE_AWARD 136→147 skipped=10` → **Finding 5** |
| Bulk promote while students are downgraded **before** their plan | 1 + 20 | All 201 | Bulk planned from the downgraded rung, one rung each ✅ (not a bug) |
| Belt reorder (×6) racing 30 promotes on the same 175-rung style | 36 | 6 × 200, 30 × 201 | Belt orders contiguous, every StudentRank's rung belongs to its belt ✅ |
| **Reorder vs reorder** (opposite orders at once) | 10 pairs | **10 × 200, 10 × 500** | Data intact (orders contiguous). The 500s are Postgres `40P01 deadlock detected` → **Finding 4** |
| **Belt edit vs belt edit** (`PATCH /ranks/:id`, rungs in opposite orders) | 10 pairs | **10 × 200, 10 × 500** | Same `40P01` deadlock; data intact → Finding 4 |
| 20 concurrent accepts of one coach-invite link (× 5 links) | 100 | 5 × 201, 95 × 409 | **Exactly 1 INSTRUCTOR grant per link**, `acceptedById` correct ✅ |
| Invited user + wrong-email user racing one link (5 + 5) | 10 | invited: 1 × 201, 4 × 409; wrong email: 5 × 403 | 1 grant ✅ |
| **Accept vs owner cancel** at once | 15 | accept **201**, cancel **500** (15/15) | Invite accepted, not cancelled, 1 grant. The DB check `CoachInvite_one_outcome` held → **Finding 7** |
| Skill sign-off: 10 concurrent clicks, no status row yet | 10 | 2 × 200, 8 × 409 | — |
| Skill sign-off: 10 concurrent clicks, row exists | 10 | 3 × 200, 7 × 409 | — |
| …then 6 sequential clicks | 6 | NOT_STARTED→LEARNING→SIGNED_OFF→… ✅ | 11 log rows = 11 successful calls; every log row's `fromStatus` equals the previous `toStatus` ✅ |
| Sign-off racing a promotion (skill required on both the old and new next rung) | 60 trials | 60 × (201 / 200) | **0** stale SIGNED_OFF carried onto the new rung ✅ |
| 15 concurrent "log a class" on one student | 15 | 2 × 201, 13 × 409 | +2 classes = 2 successes ✅ |

Final integrity checks across the whole database: 0 StudentRanks whose rung
is not in their belt; 0 duplicate `(disciplineId, order)` belts; 0 StudentRanks
whose latest non-adjustment history entry disagrees with their current rung;
0 StudentRanks without a STUDENT grant at their School. The API log holds
exactly **35** `INTERNAL_ERROR`s: 20 × `40P01` (reorder and belt edit) and
15 × `23514` (invite cancel). Nothing else returned 5xx.

## 4. Tenant isolation

School B's **owner**, **coach** (branch Instructor with grading permission on
B's own style) and **student** each made 32 calls against School A (96 in
total). The calls covered: grading-board (with A's style and with B's own
style id), eligibility, ranks, rank-history (± `includeVoided`), promote,
downgrade, board-move, log-class, board-active, rank-date, void, skill
sign-off, bulk-promote dry run, board-thresholds, grading-permissions (`/me`,
list, set), rank-verifications, from-template, duplicate, `GET` discipline,
styles ranks, rung-holders, ranks order, `PATCH` rank, coach-invites (list,
cancel, create) and staff-permissions (list, set).

| Result | Count |
|---|---|
| 404 (Discipline / Skill / Rank / Invite / School not found) | 56 |
| 403 | 40 |
| 2xx | **0** |
| Responses containing any School A id, name, invite email, rank/event id | **0** |

State afterwards: A's invite still pending, the target's rank and class count
unchanged, A's board thresholds still 33/66, no style added to A.

Existence oracle: owner B asking for a real School A student's eligibility gets
the same 403 as for a random UUID. Owner B reading that student's
`ranks`/`eligibility`/`rank-history` with `schoolId=B` gets 200 with
`{"items":[]}`, the same as for a random UUID. Nothing leaks.

Grading someone who is not your student: owner B (and School C's coach, no
branches) promoting a School A student, a never-enrolled user, or a random UUID
in their own style. All five probes were refused and nothing was written, but
see **Finding 8** for why.

## 5. Throttles

Default process (60/min per IP), 65–70 sequential calls from one IP.

| Route | First 429 at | Statuses | Headers |
|---|---|---|---|
| `GET grading-board` | 61 | 60 × 200, 5 × 429 | `x-ratelimit-limit: 60`, `-remaining`, `-reset: 60`; identity bucket 1000. On 429: `retry-after: 60`, body `{"error":{"code":"TOO_MANY_REQUESTS","message":"ThrottlerException: Too Many Requests"}}` |
| Same route, **another user**, same IP, straight after | 1 | 3 × 429 | the bucket is per IP + route, not per user |
| `GET eligibility` straight after the board burst | — | 3 × 200 | **separate bucket per route** |
| `POST …/promote` | 61 | 60 × 400, 5 × 429 | as above |
| `POST bulk-promote` | 31 | 30 × 201, 5 × 429 | `x-ratelimit-limit: 30` (its own `@Throttle`) |
| `GET /coach-invite-links/:token` (public, random tokens) | 61 | 60 × 404, 10 × 429 | as above |
| `POST /coach-invite-links/:token/accept` (random tokens) | 61 | 60 × 404, 5 × 429 | as above |
| Preview with a different `X-Forwarded-For` per call | 1 | 3 × 429 | header ignored (no `trust proxy`), so it can't be spoofed |

Token guessing is not a practical risk. The token is 32 random bytes (256
bits), only its hash is stored, and one IP gets 60 guesses a minute on each
of the two routes.

---

## Findings

### 1. HIGH — The coach Grading Board reads one student at a time: 7 s for 769 students, 30 s for 3,000

**What:** For anyone but the owner, `getGradingBoard` loops over the
candidate students. For each one it opens a separate `withTenantContext`
transaction and runs `roleGrant.findFirst`, `studentRank.findUnique`, `user`,
`studentHomeBranch` and `membership` (about 7 statements plus
`BEGIN`/`SET LOCAL`/`COMMIT`). One coachN board = **785 transactions,
≈5,470 statements**, against 4 transactions for the owner's board of
2,970 students. Time grows linearly with the coach's students:

- 750–769 students: p50 6.8–7.6 s, p95 up to 9.7 s.
- A School **without branches** (Decision 169: every coach sees every
  student): 3,000 students, **30.1 s**.

`search` and `activeOnly` don't help (p50 7.1–7.4 s), because they filter
after every student has been read. Ten coaches opening the board together
took 20.6 s each. Other requests were not starved (probe p95 112 ms), because
each board holds only one connection at a time.

**Where:** `apps/api/src/ranks/grading.service.ts:794-822` (the loop at `:804`);
filters applied afterwards at `:824-851`.

**Reproduce:** `seed-base.js`, `a1-templates.js`, `seed-students.js`, then
`a2-board.js` (coach rows) and `a2-branchless.js`.

**Proposed fix:** Keep the per-student RLS shape (Decision 88). Batch it:
read every candidate in one statement under the caller's context, through a
narrow read-only policy or a `SECURITY DEFINER` function in the style of the
existing `20261021000000_grading_board` policies. That function would return
StudentRank + skill statuses + name + home-branch time zone + membership
liveness for `studentId = ANY($ids)`, after checking the caller's branch
assignments inside it. At minimum, apply `search` before the per-student
reads and run the reads with bounded parallelism. Any new RLS policy or
function is a security-model change and needs the product owner's sign-off;
the current design was approved with Gus for this board.

### 2. MEDIUM — Bulk promote of 200 takes 13–20 s; the dry run takes 4.6–7.4 s

**What:** `bulkPromote` handles students one by one, twice.

- Plan: `assertCanGrade` (1 transaction for the owner, about 6 for a coach),
  then a plan transaction that runs `loadLadder` for the 175-rung ladder
  **again for each student**, plus the time zone.
- Execute: `changeRung` for each student, which repeats the discipline read,
  `assertCanGrade`, both School gates, `loadLadder` and the time zone, then
  queues two jobs.

Measured counts: a 200-student dry run = **404 transactions (owner) / 1,405
(coach)**. Real 200: **13.3 s owner, 20.1 s coach**. Two concurrent bulks
took 12.7 s and 17.0 s. Results were correct in every run. The danger is
that a 200-student request sits close to common 30 s proxy and browser
timeouts once the database is remote or busy. The 30/min per-IP throttle
limits the call count, not the concurrency.

**Where:** `apps/api/src/ranks/grading.service.ts:632-671` (plan loop) and
`:699-719` (execute loop, `changeRung` at `:703`). Per-student repeats:
`assertCanGrade` at `:634` and again at `:356`; `loadLadder` at `:648` and
`:371`.

**Reproduce:** `a2-bulk.js`.

**Proposed fix:**
- Authorize and load the ladder, discipline, School gates and time zones
  once per request.
- Read the batch's StudentRanks in one query.
- Give `changeRung` an internal variant that takes the preloaded context.
- For a coach, compute "students I may grade" once (the same set the board
  needs).
- Keep one transaction per student for the writes, as the docstring requires.

### 3. MEDIUM — The owner board runs ~450 ms of synchronous CPU work and returns 2.2 MB; concurrent boards stall the whole API

**What:** A single owner board takes 0.6–0.95 s, but much of that is
blocking JavaScript:

- ~280–315 ms in O(n²) joins: `ranks.find`, `homes.find` and
  `memberships.filter` inside the loop over every grant (3,000 × 3,000).
- ~150 ms in `eligibilityOnLadder` for 2,970 rows.

The response is 2.2 MB, because the full `eligibility` object is repeated per
student. With 5 concurrent owner boards, an unrelated cheap request (baseline
30 ms) **stalled 2.15–2.29 s once in each of three runs**. The event loop
was blocked, so every tenant on that API instance was affected.

**Where:** `apps/api/src/ranks/grading.service.ts:783-791` (joins);
`:841-866` (per-row eligibility and response shape).

**Reproduce:** `a2-concurrent.js`, `out-a2-owner-concurrency-recheck.json`,
`profile-owner-board.js`.

**Proposed fix:**
- Build `Map`s keyed by `studentId` for ranks, homes and memberships. This
  removes ~300 ms per request and is O(n).
- Trim the per-row payload to what the board renders, or paginate or limit
  the board.
- Optionally cache the time-zone `DateTime` objects per zone inside
  `eligibilityOnLadder`.

### 4. MEDIUM — Concurrent belt reorders, or concurrent belt edits, deadlock and return 500

**What:** `reorderRanks` "parks" every belt at `-1 - i`, then sets `i`, in the
order the request lists them. `updateRank` does the same with a belt's rungs.
Two requests listing the same rows in different orders take the row locks in
opposite orders, and Postgres aborts one with `40P01 deadlock detected`. That
abort reaches the client as **500 INTERNAL_ERROR**: 10/10 opposing pairs for
reorder, 10/10 for belt edit. The data stayed correct (one transaction rolled
back; orders contiguous afterwards). The realistic case is two owners or
managers editing the ladder editor at once, or a double-submit with a changed
order.

**Where:** `apps/api/src/ranks/ranks.service.ts:495-500` (`reorderRanks`) and
`:417` with the following rung updates (`updateRank`). Error mapping:
`apps/api/src/common/filters/http-exception.filter.ts`
(`PrismaClientUnknownRequestError` → 500).

**Reproduce:** `a3-races.js` (R4 "reorderVsReorder"), `a3-beltedit-race.js`.

**Proposed fix:** Take the locks in a fixed order before parking. For
example, start with `SELECT … FROM "Rank" WHERE "disciplineId" = $1 ORDER BY
id FOR UPDATE` (and the same per belt for its rungs), or update rows sorted by
id. Alternatively, do the move in one `UPDATE … FROM (VALUES …)` statement
with a deferrable unique constraint. Separately, map Postgres `40P01`/`40001`
to 409 "changed at the same time — please retry" in the exception filter.

### 5. MEDIUM — Bulk promote applies its planned target even when the student changed after the plan: a concurrent downgrade becomes an 11-rung jump

**What:** The plan records `fromRungId → toRungId` (one rung). The execute
step calls `changeRung` with only `targetRungId: row.toRungId`. `changeRung`
re-reads the student's current rung, and its conditional write checks against
that fresh read, not against the planned `fromRungId`. A student downgraded
10 rungs by a coach between the plan and their turn was promoted from the
downgraded rung straight to the planned target, in **10 of 10 cases**, e.g.
`DOWNGRADE 146→136` then `BULK_STRIPE_AWARD 136→147 rungsSkipped=10`.

So:
- The downgrade is silently undone.
- "One rung each" (Decision 130) is broken.
- The entry is labelled a stripe award although it crosses belts (`sameBelt`
  comes from the plan).
- The bulk `systemNote` replaces the usual "Skipped N ranks" note.

The skills check is re-run on the current rung, so this does not bypass
required skills. The window equals the bulk's own duration (5–20 s at 200
students, see Finding 2). When the change landed *before* the student's plan,
the bulk behaved correctly.

**Where:** `apps/api/src/ranks/grading.service.ts:703-710` (call without the
planned from-rung); the conditional write at `:477-483` uses the fresh
`existing`.

**Reproduce:** `a3-bulk-window.js`.

**Proposed fix:** Pass the planned `fromRungId` to `changeRung`, for example
as an `expectedFromRungId` option. Refuse the student with a `ConflictException`
("changed since the batch was checked"), which lands in `cannotPromote`, when
the current rung differs.

### 6. MEDIUM — Two coaches clicking "award stripe" (or a default promote) at the same time both succeed: the student gets two stripes or skips a belt

**What:** The conditional write only catches overlapping transactions. A
coach's authorization takes ~6 more transactions than the owner's, so in
practice one request often commits before the other reads. The second then
reads the new rung and promotes again. Neither request carries "the rung I
saw", so the API cannot tell a double click from an intended second action.

| Action | Pairs | Both 201 |
|---|---|---|
| Stripe award (portal `useStripeAward`; no `targetRungId` allowed) | 10 | **6** (two stripes) |
| Promote without `targetRungId` | 25 + 10 | **25/25 and 5/10** (two belts, e.g. belt order 4 → 6) |
| First grade with no StudentRank yet | 5 students × 10 calls | **12 events** (no duplicate rows) |

The web portal's **promote** always sends `targetRungId`
(`apps/school-portal/src/grading/GradingModals.tsx:110`). That path is safe:
10/10 pairs ended with one rung, the second call getting 400 or 409. The
stripe-award path is used by the same modal
(`GradingModals.tsx:109`), and the API's default promote is a documented
contract. Everything is recorded in the history and can be corrected (void +
downgrade), so this is not data loss.

**Where:** `apps/api/src/ranks/grading.service.ts:299-312`, `:401-418`
(default target and stripe award), `:477-483`;
`apps/api/src/ranks/dto/grading-action.dto.ts`.

**Reproduce:** `a3-verify.js`, and `a3-races.js` (R1, R1c).

**Proposed fix:** Add an optional `fromRungId` (expected current rung) to
`GradingActionDto` for promote, downgrade and stripe award. Include it in the
conditional `updateMany` (409 if different), and have the portal send it.
The same option serves Finding 5.

### 7. LOW — Cancelling a coach invite at the moment it is accepted returns 500

**What:** `cancel()` reads the invite (not yet accepted), then runs an
unconditional `update` setting `cancelledAt`. If the accept commits in
between, the database check `CoachInvite_one_outcome` (accepted XOR
cancelled) rejects the update with `23514`. That reaches the owner as **500**
(15/15 trials). Integrity held: the invite stayed accepted, one grant, never
both outcomes. A 409 "This invite has already been accepted" was the
intended answer (`:188`).

**Where:** `apps/api/src/tenants/coach-invites/coach-invites.service.ts:184-193`.

**Reproduce:** `a3-invites.js` (acceptVsCancel).

**Proposed fix:** Make it conditional:
`updateMany({ where: { id, acceptedAt: null, cancelledAt: null }, … })`. On
count 0, re-read and return 409 (accepted) or the existing cancelled invite.

### 8. LOW (defence in depth) — Grading a user who isn't the School's student is stopped only by Rank RLS, with a misleading message

**What:** For an owner, `assertCanGrade` returns at once (`isSchoolOwner`), and
nothing checks that the student is enrolled at that School. The same applies
to any permitted coach in a School without branches. Owner B promoting a
School A student, a never-enrolled user, or a random UUID in B's own style
reached the write path. It failed only because `loadLadder` runs under the
**student's** context, where B's `Rank` rows are invisible. The response was
400 "This Discipline has no Ranks configured yet." No StudentRank was written,
no notification was sent, and real ids and random UUIDs got the same answer,
so there was no oracle. If Rank's read policy is ever widened (for example to
let students browse other Schools' ladders), this becomes a cross-tenant write
plus a "Promoted!" notification to any user.

**Where:** `apps/api/src/ranks/grading.service.ts:219-220` (owner shortcut),
`:356`, `:371-374`. The read paths (`:166-193`) have the same shortcut and
return empty lists.

**Reproduce:** `a4-foreign-student.js`.

**Proposed fix:** In `assertCanGrade`/`assertStaffCanSeeStudent`, require an
active STUDENT RoleGrant for `(studentId, schoolId)` (one query) and return
404 "Student not found at this School". `declareRank` already does this
(`:1287-1295`).

### Not findings (checked, behaving as designed)

- **Tenant isolation held:** 96/96 cross-tenant probes were refused, no leak,
  no state change.
- **Coach invite single use held:** exactly one grant per link under 20-way
  concurrency, and the wrong email was refused.
- **Throttles:** 60/min per IP **per route**. Bulk promote is 30/min.
  `Retry-After: 60` and `X-RateLimit-*` headers are sent. Because buckets are
  per route, one IP effectively gets 60/min on preview **and** 60/min on
  accept; with 256-bit tokens that is irrelevant.
- **Note on proxies (pre-existing, not grading-specific):** with no `trust
  proxy`, a deployment behind a load balancer would put every client in one
  bucket, so 60 board loads a minute for the whole platform. Worth checking
  against the production ingress.
- **Skill sign-off, log-a-class and void/verify conditional writes** were
  consistent under bursts. 409s are returned for the losers.

## What this round did not cover

- A remote or latency-bearing database. Every number here is same-host, so a
  real deployment's per-statement round trip multiplies Findings 1 and 2.
- Multiple API replicas, and BullMQ notification throughput under bulk load.
  Jobs were queued and processed, but delivery was not measured.
- The student app (Track B) and portal rendering of a 2.2 MB / 3,000-row
  board.

## Scripts and raw outputs

The load scripts (`seed-*.js`, `a1-*` to `a5-*`, `profile-owner-board.js`,
`qcount.js`) and their raw outputs were one-off tools and are not committed.
The races and isolation checks that found something are now regression tests
in `apps/api/test/grading-hardening.e2e-spec.ts` and
`grading-security-hardening.e2e-spec.ts`.
