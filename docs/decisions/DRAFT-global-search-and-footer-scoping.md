# DRAFT — Global Search and marketing footer: scoping proposal (NOT part of the decision log)

**§B (Marketing footer) is RESOLVED — see Decision 256** (`POST-SPEC-55-DECISION-LOG.md`,
14 Oct 2026): standard B2B shape, all three apps, placeholder Terms/Privacy/
Support links. Left here for its own historical context (options considered,
tradeoffs) rather than deleted.

**§A (Global Search) is RESOLVED — see Decision 278** (`POST-SPEC-55-DECISION-LOG.md`,
21 Oct 2026): option (a), approach 2 (a `search` param on each existing list
endpoint), case-insensitive substring on names, results mirror the sidebar,
archived records excluded. Left here for the same historical reason as §B.

**This file is a draft for the product owner to react to. It is not appended to
`docs/decisions/POST-SPEC-55-DECISION-LOG.md` and carries no decision numbers
of its own.** If the product owner picks a direction on either item, that
choice should be logged as its own numbered entry in the real log (next
available number as of this writing: **Decision 246** — `POST-SPEC-55-DECISION-LOG.md`
currently ends at Decision 245). Nothing below is approved, designed, or built.

Both items were raised with **zero existing spec, mockup, or decision-log
entry** — this is first-pass product scoping only, written after reading the
actual `apps/school-portal` code (not assumed), in the tone of the project's
existing "approved to scope" entries (Decisions 226, 227: name the real gap,
lay out real options with tradeoffs, do not pretend a call has been made).

---

## A. Global Search — RESOLVED (Decision 278, 21 Oct 2026)

**The gap, as it actually exists in code today:** `apps/school-portal/src/layout/TopBar.tsx`
already renders a search input in the app-shell header — disabled, with the
placeholder "Search (coming soon)" — and its own code comment is explicit:
*"Search has no backing feature anywhere in this codebase (no search endpoint
exists anywhere) — shown disabled rather than omitted or faked, so it reads as
'not built yet,' not broken."* So this isn't a net-new UI slot to design; it's
a wired-up placeholder waiting on a real decision about scope and backend.

**What's actually searchable today (verified by reading each page), for
contrast:**

| Page | Filter today | Mechanism |
|---|---|---|
| Classes | Discipline (exact match on `activities`) + **"Search classes" by title** | Real server-side `?search=` param, `GET /schools/:schoolId/classes` |
| Grading Board | "Search students" by name | **Client-side only** — substring filter over students already loaded as grading-eligible for the signed-in coach's styles; not a general lookup |
| Students | Status (Active/etc.) | No name search |
| Instructors | — | No filter of any kind |
| Branches | City (substring match on address) | No name search |
| Franchises | Fee model + Activity (exact match) | No name search |

So Classes is the only entity with a real, server-side, name-style search
today, and it's scoped to that one entity's own list endpoint. There is no
precedent anywhere in the codebase for a search that spans multiple entity
types in one query. There's also a relevant precedent *against* loose name
matching: `LookupInviteCandidateQueryDto` (role-grant invite lookup) is
explicitly exact-match-only on email/phone, "never a name search" (Decision
116) — so a fuzzy, substring, cross-entity name search would be a genuinely
new pattern for this app, not an extension of one that already exists.

### Scope options

**(a) Cross-entity search bar** — one query searches Students, Instructors,
Classes, Branches, and Franchises by name/title, results grouped by type,
each result linking into that entity's existing list/detail page.
- Backend, two realistic approaches:
  1. **One new aggregator endpoint** (e.g. `GET /schools/:schoolId/search?q=`)
     that queries each entity's table server-side and returns a small typed
     result per type. Cleaner for the frontend (one call), but it's a new
     single place that must apply the same tenant-scoping every existing list
     endpoint already applies — a scoping mistake here leaks across *all*
     entity types at once, so it needs its own isolation review, not a
     copy-paste of one entity's existing query.
  2. **Reuse each entity's own list endpoint** with a new `search`/`name`
     query param, following the exact pattern Classes already proved, fired
     in parallel from the frontend. No new endpoint type, but Students,
     Instructors, Branches, and Franchises list endpoints don't currently
     accept a name-search param at all (per the table above) — this still
     means four backend changes, just smaller and lower-risk ones than a new
     aggregator.
  - **Either way: multi-tenant isolation is non-negotiable** — a School Owner
    or Branch Staff must never see another School's rows in a search result,
    exactly as the existing list endpoints already enforce. This is the same
    isolation model, not a new one, but Global Search is the first feature
    where a single screen can show rows from five entity types at once, so a
    leak would be unusually visible if the scoping were ever done wrong in
    the new code path.
  - Role scoping: a Branch Staff/Coach-only user already sees a narrower nav
    (`COACH_NAV` in `Shell.tsx`) than a School Owner. Search results should
    presumably mirror that — not surface entities (e.g. Franchises) a Coach
    can't otherwise navigate to — but that's a product call, not assumed here.

**(b) Students-only search** — just add a `search` param to the Students list
endpoint, following the Classes precedent exactly. Smallest backend lift (one
endpoint, one param, an already-shipped pattern), matches "Students are the
highest-value, most frequent lookup" reasoning, but doesn't touch the
cross-entity promise a "Global Search" label implies — it would functionally
be "Student Search," reusing the header slot.

**(c) Other shapes worth naming, not recommending:** narrower still (no new
feature at all — just wire the header search into Students, same as (b), with
even less UI work since the input already exists); or broader (also index
Curriculum/Lessons, Membership Plans, Transactions, Waivers) — flagged as
likely overreach for a v1, since those weren't part of the original ask and
each has its own tenant-scoping and (for Waivers/Transactions) sensitivity
considerations.

### Open questions (real gaps, not filled in here)

- **Archived/soft-deleted records.** This can't actually be answered yet:
  there is **no soft-delete field anywhere in the schema today** (verified —
  no `deletedAt`/`isArchived` column exists), and Decision 226 (tenant
  offboarding across 16 entities) is itself still mid-scoping on soft-delete
  vs. hard-delete. Global Search's archived-record question is downstream of
  that decision, not independent of it — it should wait on Decision 226's
  outcome rather than get its own answer first.
- **Match semantics.** Exact vs. substring vs. fuzzy isn't a neutral default
  here — it's a precedent reversal from Decision 116's explicit "never a name
  search" stance on lookups elsewhere in the app. Worth the product owner
  confirming deliberately, not inheriting Classes' substring behavior by
  default.
- **Role-scoped results**, per option (a) above — does a Coach-only user get
  a narrower result set than a School Owner, mirroring the nav they already
  see?

---

## B. Marketing footer

**The gap, as it actually exists in code today:** there is no marketing
footer anywhere in `apps/school-portal`. The only thing named "footer" in the
codebase is `AppShell`'s `footer` prop (`packages/ui/src/components.tsx`),
and reading its implementation shows it renders **inside the left sidebar**
(`<aside className="ultm8-shell__sidebar">` → `ultm8-shell__footer-action`),
holding nothing but the "Log out" button (`Shell.tsx`). There is no `<footer>`
element, no Terms/Privacy/Support links, no copyright line, anywhere in the
app. This is a from-scratch UI addition, not an extension of existing chrome.

This is much more a product/marketing-content question than an engineering
one — the options below differ mainly in *what content a B2B SaaS app footer
typically carries*, not in technical difficulty (all are static, for the
School Portal app shell).

### Scope options

**(a) Minimal** — a copyright line only (e.g. "© 2026 ULTM8"). Lowest
content burden, lowest value; barely distinguishable from having none.

**(b) Standard B2B SaaS footer** — copyright line + Terms of Service /
Privacy Policy / Support links, rendered once in the main content column
(same "once per AppShell, not per-page" scope as `TopBar`). This is the
typical shape for this category of product (school/gym management SaaS:
Mindbody, PushPress, Kicksite-style apps all carry some version of this in
their customer-facing portals).

**(c) Fuller marketing footer** — adds a status-page link, social links,
and/or a company address (sometimes a legal requirement depending on
jurisdiction), on top of (b). More typical of a public marketing site than an
authenticated app shell, so possibly more than this surface needs — flagged,
not recommended.

### What's actually needed before any of this can be built

Regardless of which shape is picked, the following do **not exist yet** and
are a content decision for the product owner, not an engineering guess:
- Actual URLs/pages for Terms of Service, Privacy Policy, Support (contact
  form? help center? mailto?), and Status, if included — none of these were
  found anywhere in this repo (marketing site or otherwise), so it's not yet
  known whether they already exist elsewhere and just need linking, or need
  to be written from scratch.
- Actual copy (company legal name, year handling, any required legal
  language) — this should come from the product owner directly rather than
  invented placeholder text, especially since Decision 245 shows GDPR/LGPD
  compliance work is already in motion and a Privacy Policy link is not
  something to improvise ahead of that.
- Confirmation of scope: School Portal only (as scoped by this request), or
  also `apps/platform-admin` / `apps/student`? Not addressed here since the
  ask was School Portal only.

---

*End of draft. Both sections above lay out options and flag real open
questions; neither makes a call. If the product owner wants either formally
logged as "approved to scope" (in the style of Decisions 226/227), that should
be written as new, separate entries in `POST-SPEC-55-DECISION-LOG.md`.*
