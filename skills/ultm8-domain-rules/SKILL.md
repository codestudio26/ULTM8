---
name: ultm8-domain-rules
description: Canonical domain and business-rule reference for the ULTM8 martial-arts school management platform. Load before implementing, reviewing, discussing, or writing tests for anything involving Franchises, Schools, Branches, Students, Instructors, disciplines, belt/rank grading, memberships, classes, bookings, attendance, QR check-in, or waivers. States only what the technical specification has actually confirmed — everything else is listed as unresolved rather than assumed.
---

# ULTM8 Domain Rules

**Derived from:** `ULTM8_Technical_Specification.docx`, version dated 21 Aug 2026 (§1–§13), cross-checked directly against the underlying Figma audit.
**Maintained by:** the Architect agent only. If this skill and the current spec ever disagree, the spec wins — flag the mismatch to the Architect rather than trusting whichever one you read first.
**Status:** living reference. Re-verify against the spec every time the spec is updated; do not assume this file is current.

> **Golden rule:** every rule below is tagged `[CONFIRMED]`, `[OBSERVED IN DESIGNS]`, `[UI BEHAVIOUR]`, or `[UNRESOLVED]`. Only `[CONFIRMED]` items may be treated as settled business logic. If a task requires something tagged `[UNRESOLVED]`, stop and escalate — do not fill the gap with a plausible guess. See "Rules for how other AI agents must use this skill" at the end.

---

## 1. Core domain principles

- **[CONFIRMED]** ULTM8 is a multi-tenant SaaS platform for martial-arts school management. (§1.3)
- **[OBSERVED IN DESIGNS]** The sample data brands the product "ULTM8," built by "IMAS – Innovative Martial Arts Systems." Treat this as illustrative Figma sample content, not a confirmed legal/business name to hard-code anywhere.
- **[CONFIRMED]** The tenant unit is the **School** (optionally grouped under a **Franchise**). End users are **Students**. Staff-side actors are School Owner/Staff, Franchise Owner, Instructors (records only — see §3 "Students" below on instructor access), and **Platform Admin** staff, who are a deliberately separate identity, never a tenant-side role. (§4.4, §6.1)
- **[CONFIRMED]** Five domain concepts anchor the whole product: belt/rank progression per discipline, class scheduling against a weekly recurring timetable, membership sales (subscription / single pass / trial), liability waivers with e-signature, and QR-code class check-in — all delivered through a multi-language (5 languages, including Arabic/RTL) and multi-currency (6 currencies) experience administered via a CMS-style translation tool. (§1.3)

## 2. Organisation hierarchy

- **[CONFIRMED]** Hierarchy is **Franchise → School → Branch**. (§1.2, §6.2)
- **[CONFIRMED]** A Franchise MAY own many Schools. (§6.2)
- **[CONFIRMED]** A School's link to a Franchise is **optional (nullable)** — an independent, non-franchised School is a first-class case, not an edge case. (§1.2, §6.2)
- **[CONFIRMED]** A School MAY have many Branches. (§6.2)
- **[UNRESOLVED]** What data a Branch actually captures. Only the sidebar nav item and empty `branchInformation`/`updateBranch` frame ids exist — no field-level detail was ever extracted, because none was designed. Do not assume Branch mirrors School's fields. (§6.2, §12.2)
- **[UNRESOLVED]** Whether a School under a Franchise can hold its own `PaymentAccount` distinct from the Franchise's, or must inherit the Franchise's. Both Franchise-level and School-level payment-account configuration were observed in the designs, and this was never reconciled. (§6.2, §12.2)
- **[UNRESOLVED]** Whether the platform-level `SubscriptionPlan` a Franchise/School "subscribes to" represents ULTM8 billing the Franchise/School for platform access, or a plan the Franchise resells onward to its member Schools. This is not a footnote — it changes whether `SubscriptionPlan` is platform revenue or tenant content. **Do not implement Franchise Subscription Plan billing logic until this is resolved.** (§12.2)

## 3. Students

- **[CONFIRMED]** Base `User` fields (shared by all customer-facing roles): email, phone, first name, surname, username (mobile only), 6-digit passcode, date of birth, gender, nationality, language, currency, address, profile photo. (§6.1)
- **[CONFIRMED]** Platform Admin staff are never rows in this `User` table — they live in a wholly separate `AdminUser` identity and are never joined against tenant `User` records. (§4.4, §6.1)
- **[UI BEHAVIOUR]** Mobile onboarding runs a post-registration "personalize your plan" wizard collecting gender, DOB, height/weight, and preferred activities/disciplines. This is an observed screen flow, not a stated business rule about what's mandatory vs optional.
- **[CONFIRMED, as absence]** No instructor-facing login or app exists anywhere in either Figma file. Instructors exist only as records that School Portal staff manage.
- **[UNRESOLVED]** Whether instructors need their own authenticated access (e.g. to mark attendance or view their own schedule). Do not build instructor login/auth without this being decided. (§12.2)
- **[UNRESOLVED]** Four unlabeled numeric stats shown on the Student/Coach Profile screens (870 / 120k / 354k / 3.8Gb). No meaning is stated anywhere in the designs. Do not guess what these represent (possible reads floated in the spec — posts/followers/following/storage — are explicitly *not* confirmed). (§12.2)
- **[UNRESOLVED]** The "User" grouping label seen in the translations CMS (alongside Student/School/Admin) does not map to any concrete role elsewhere in the designs. Do not treat "User" as a distinct role from `User` (the base entity) without clarification. (§12.2)

## 4. Disciplines

- **[OBSERVED IN DESIGNS]** Disciplines named in sample data: Jiu Jitsu, Karate, Judo, Krav Maga, Taekwondo, MMA, Wrestling, "etc." — the spec itself does not close this list, so treat it as illustrative, not an exhaustive enum. (§1.3)
- **[CONFIRMED]** Belt/rank progression is tracked **per discipline** — a Student can hold a different rank in each discipline they train in. (§2.3, §6.1)
- **[UNRESOLVED / TERMINOLOGY]** The spec's Figma-derived field name for what this skill calls "discipline" is `activities` (used on School, Instructor, and Class). The designs never explicitly state that School.activities, Instructor.specializations, and StudentRank's per-discipline scoping all draw from the same controlled list. Treat "discipline" and "activity" as the same concept for narrative purposes, but do not assume they share one literal enum/table without confirming with the Architect.

## 5. Belt/rank progression

- **[CONFIRMED]** A rank is composed of: belt colour (including two-colour combinations for some disciplines) + stripe count + stripe colour, scoped to one discipline. Roughly 360 such combinations are enumerated as icon assets in the designs, confirming this is a highly detailed, first-class domain concept — not a rough approximation. (§2.3)
- **[CONFIRMED]** `StudentRank` fields: current belt/rank, last grading date, next grading date, classes attended, readiness bucket (**Ready / Almost Ready / Not Ready** — these three values only), progress %. One `StudentRank` row exists per discipline a student trains in. (§6.1)
- **[CONFIRMED]** `Belt/Rank` is separate, referenced reference data (colour, stripe count, stripe colour, discipline) — not duplicated per student. (§6.1)
- **[UNRESOLVED]** The grading process itself: who performs a grading, what criteria move a student from one readiness bucket to the next, what triggers `StudentRank` to actually update. Nothing in the designs specifies this. **Do not invent grading-approval logic** (e.g. "instructor taps a button to promote a student") — this must come from the Architect/Code Studio before it's built.

## 6. Membership types

- **[CONFIRMED]** `MembershipPlan.type` has exactly three values: **Subscription, Single Pass, Trial Membership**. (§6.1)
- **[TERMINOLOGY]** The mobile Transactions screen labels the same non-recurring purchase type "One-Time" rather than "Single Pass." Treat these as the same concept under two different screen labels — canonical name is **Single Pass** (matches the `MembershipPlan.type` field). Don't build two different code paths for "Single Pass" and "One-Time."
- **[CONFIRMED]** These three types are a School-to-Student concept (`MembershipPlan` → `Membership`) and are **distinct from** the platform-level `SubscriptionPlan` described in §2/§7 below — see the explicit warning in "Canonical terminology."

## 7. Membership billing behaviour

- **[CONFIRMED]** `MembershipPlan` fields: title, type, price, expiry, visibility (Public), refund-fee date, cancellation charge, terms/waiver-required flag. Belongs to School; purchased by Students as a `Membership`. (§6.1)
- **[CONFIRMED]** A purchased `Membership` records: status, start date, frequency (One Time / recurring). (§6.1)
- **[UNRESOLVED]** The actual cancellation/refund *policy logic* behind the "refund-fee date" and "cancellation charge" fields — the fields exist on both `Class` and `MembershipPlan`, but how the charge is calculated or when it applies is never specified. Fields being present is not the same as the business rule being confirmed.
- **[UNRESOLVED]** Whether prices convert automatically across the 6 supported currencies, or are entered independently per School per currency. (§12.2)
- **[NOTEWORTHY / UNRESOLVED]** `Auto Renew` is a confirmed field on the platform-level `SubscriptionPlan`, but the spec never states whether School-to-Student `MembershipPlan`/`Membership` also supports auto-renewal. Do not assume Membership auto-renews just because SubscriptionPlan does — they are different entities (see Canonical terminology).

## 8. Membership states and transitions

- **[CONFIRMED]** `Membership.status` has exactly three observed values: **Active, Pending, Expire**. (§6.1)
- **[UNRESOLVED]** What triggers a transition between these states (e.g. what moves Pending → Active, what moves Active → Expire, whether a cancelled membership is a fourth state or maps onto one of these three). The designs show the three labels on screen; they do not show or describe the state machine behind them. Do not implement transition logic from assumption.

## 9. Classes

- **[CONFIRMED]** `Class` fields: title, activities, banner image, description, start/end date, capacity, booking-end date/time, QR-attendance-end date/time, refund-fee date, cancellation charge, terms/waiver-required flag. Belongs to School; taught by an Instructor; has many Bookings. (§6.1)
- **[CONFIRMED]** `TimetableSlot` is a separate concept: a weekly recurring grid (Monday–Sunday), multiple slots per day, start/end time, break windows, on/off status. It belongs to a School (and inferredly an Instructor), and is explicitly a **recurring weekly pattern, not date-specific**. (§6.1)
- **[UNRESOLVED]** How `TimetableSlot` and `Class` actually relate. `Class` carries its own start/end date fields while `TimetableSlot` is a separate recurring weekly template — the spec never states whether a bookable `Class` is generated from a `TimetableSlot` occurrence, or whether the two are only loosely associated. **Do not assume one Class row is auto-spawned per TimetableSlot occurrence** without this being confirmed — it's a real architectural decision, not a naming detail.
- **[UNRESOLVED]** `Class.terms/waiver-required flag` exists, but where this is enforced (blocked at booking time vs merely informational) is not specified.

## 10. Bookings

- **[CONFIRMED]** `Booking` fields: class date/time, status (**Upcoming / Completed / Cancelled**), attendee list (Figma field name: `whoJoinYou`). Belongs to a Student and a Class. (§6.1)
- **[CONFIRMED]** Booking flow, as designed: browse class list & availability → select a class → confirmation screen shows Instructor, Class Timings, Class Date, Class Name → booking is created → if payment is required, a saved or new card is charged → booking and transaction records are finalized once the resulting webhook is processed. (§3.2)
- **[UNRESOLVED]** The semantics of the `whoJoinYou` attendee list — whether a Student can book on behalf of / bring other people under one booking, and if so, whether those attendees need their own accounts. The field's existence is confirmed; its meaning is not.

## 11. Attendance

- **[CONFIRMED, narrowly]** A Dashboard KPI card reports **Attendance (Present / Absent)** figures. (§2.1)
- **[UNRESOLVED — important]** There is **no dedicated `Attendance` entity anywhere in the confirmed data model** (§6.1 lists no such table). Attendance appears only as a Dashboard KPI label and as the trigger description for the `qr-attendance-processing` background job. **Do not invent an `Attendance` entity or assume `Booking.status` is the sole attendance signal** — whether attendance is (a) derived purely from `Booking.status`, (b) written by the QR check-in flow into some other table, or (c) both, has never been specified. This is a genuine gap the current spec does not resolve; flag it to the Architect before modeling it.

## 12. QR check-in

- **[CONFIRMED]** A camera-based QR scan screen (`qrCode`) exists on the Student mobile app for class attendance. (§2.2)
- **[CONFIRMED]** `Class` carries a QR-attendance-end date/time field — a bounded window during which check-in is valid. (§6.1)
- **[CONFIRMED]** A `qr-attendance-processing` background job is triggered by a QR scan at check-in. (§9)
- **[UNRESOLVED]** What the QR code actually encodes (a static per-class code? a session-specific rotating token?) and what exactly the scan writes on success (updates `Booking.status` to Completed? writes to a separate record — see §11 "Attendance" above?). None of this is specified in the designs.

## 13. Waivers and e-signatures

- **[CONFIRMED]** `Waiver` fields: title, body text, per-school assignment. Belongs to School; has many `WaiverSignature`s. (§6.1)
- **[CONFIRMED]** `WaiverSignature` fields: signer full name, signature, signed date, status — exactly four values: **Signed, Unsigned, Expired, Pending**. Belongs to a Waiver and a Student. (§6.1)
- **[CONFIRMED]** The e-signature mechanism as designed is a **typed full name plus a signature field** — there is no drawn/biometric signature capture or additional verification step shown. (§2.2)
- **[CONFIRMED]** A `waiver-signature-requests` background job fires when a waiver is assigned to a student. (§9)
- **[UNRESOLVED — flagging proactively, not yet in the spec's own Gaps section]** The legal sufficiency of a typed-name e-signature for a liability waiver covering physical martial-arts training has not been evaluated anywhere in the spec. Waiver validity requirements vary by jurisdiction and are a real legal question for a platform serving students across at least 6 currency regions (and, given the sport, plausibly a meaningful number of minors). **Recommend the Architect add this to the spec's open-questions list explicitly** — do not treat the current typed-name design as legally sufficient by default.
- **[UNRESOLVED]** Where `Class.terms/waiver-required` is actually enforced (see §9 "Classes" above).

## 14. Business invariants

These are the standing rules that should hold true across the whole system, drawn only from what's confirmed elsewhere in this document:

- A School may exist with no Franchise at all; code must never assume `Franchise` is present. **[CONFIRMED]**
- A Student's belt rank is discipline-scoped; a student can simultaneously hold different ranks in different disciplines. **[CONFIRMED]**
- Platform Admin staff are never represented in the customer-facing `User` table, and customer data must never be reachable through the Platform Admin identity except through the audited, explicitly-namespaced admin surface. **[CONFIRMED — business-level restatement of §4.4; implementation mechanics live in `ultm8-tenant-isolation`, not here.]**
- One School's data is never visible to another School or Franchise, by business expectation as well as by architecture. **[CONFIRMED — the *mechanism* (Row-Level Security) is a technical concern owned by `ultm8-tenant-isolation`; this skill only asserts the business expectation.]**
- ULTM8 does not have the technical ability to view a School's live payment credentials in plaintext (Stripe Connect / secrets-manager custody only). **[CONFIRMED — business-level restatement of §9.4/§10.4; mechanics live in `ultm8-payments`.]**
- A School's white-label branded app is created only while its `SubscriptionPlan.whiteLabelApp` entitlement is active; on downgrade or cancellation, the app is frozen at its last build rather than removed. **[CONFIRMED, §5.5]**
- `MembershipPlan`/`Membership` (School↔Student billing) and `SubscriptionPlan` (platform↔Franchise/School billing) are two separate entities and must never be merged or used interchangeably in code, copy, or database design. **[CONFIRMED distinction; see next section.]**

## 15. Canonical terminology

Use these terms consistently; several are easy to conflate because the Figma source data uses inconsistent labels.

| Canonical term | Meaning | Do not confuse with |
|---|---|---|
| `MembershipPlan` / `Membership` | School charging a Student (Subscription / Single Pass / Trial) | `SubscriptionPlan` |
| `SubscriptionPlan` (platform) | Franchise/School's own billing relationship with ULTM8 (direction unresolved — §2 above) | `MembershipPlan` |
| Single Pass | A one-time membership purchase | "One-Time" (same concept, mobile-screen label) |
| Discipline | A martial art / activity a School offers and a Student trains in | `activities` is the literal Figma field name for the same idea — not formally reconciled, see §4 |
| `PaymentAccount` | A School/Franchise's configured payment method (Stripe Connect account id, or manual Cash/Bank Transfer) | Not a Student's saved card — that's a Stripe PaymentMethod on the Student's own profile |
| `Transaction`/`Invoice` | A ledger row for a completed or pending charge | `Membership` (the ongoing entitlement) or `Booking` (the class reservation) |
| `AdminUser` | Platform Admin staff identity, separate realm | `User` (customer-facing: Student, School staff) |
| `TenantAppConfig` | A School's white-label branding/build config, only exists when entitled | Not a School's general profile/settings |

## 16. Important relationships between entities

(Narrative summary only — the authoritative field-level table lives in spec §6.1; consult it directly for full field lists.)

- Franchise 1—* School (nullable link) 1—* Branch (fields unconfirmed)
- School 1—* Instructor, 1—* TimetableSlot, 1—* Class, 1—* MembershipPlan, 1—1 (or more — unresolved) PaymentAccount
- Instructor 1—* Class (teaches), 1—* TimetableSlot
- Class *—* Booking (via Student), *—1 Instructor
- Student(User) 1—* Booking, 1—* Membership, 1—* StudentRank (one per discipline), 1—* WaiverSignature, 1—* Notification
- MembershipPlan 1—* Membership (purchased instances)
- Waiver (School-owned) 1—* WaiverSignature (Student-signed)
- Belt/Rank (reference data) referenced by StudentRank, not owned per-student
- AdminUser 1—* AuditLogEntry (actor); AuditLogEntry references a target tenant/entity but is never joined into tenant queries
- School/Franchise 1—0/1 TenantAppConfig (only when white-label entitled)

## 17. Unresolved / requires confirmation — consolidated list

Everything below is copied or extended from spec §12.2, plus items this skill surfaced while compiling (marked accordingly). None of these may be treated as decided.

**From the spec's own Gaps & Open Questions (§12.2):**
- Object storage/CDN provider, SMS/OTP provider, push & email providers — not domain rules, but block several domain flows (waiver PDFs, OTP, notifications).
- Passcode security model (is the 6-digit passcode the whole credential?).
- Branch data model.
- Franchise Subscription Plans billing direction (see §2 above).
- Currency conversion behaviour (see §7 above).
- Unlabeled Profile stats (see §3 above).
- Inconsistent mobile bottom navigation — UI concern, not a business rule.
- "User" role ambiguity (see §3 above).
- Instructor-facing access (see §3 above).

**Surfaced while compiling this skill (recommend adding to spec §12.2 — not yet formally logged there):**
- Grading process/criteria behind `StudentRank` progression (§5 above).
- `TimetableSlot` ↔ `Class` relationship (§9 above).
- Whether an `Attendance` entity exists or attendance is derived from `Booking.status` (§11 above).
- QR code contents and what a successful scan actually writes (§12 above).
- Legal sufficiency of the typed-name e-signature for liability waivers (§13 above).
- `whoJoinYou` booking-attendee semantics (§10 above).
- Whether `Membership` supports auto-renewal the way platform `SubscriptionPlan` does (§7 above).
- Enforcement point for `Class.terms/waiver-required` (§9, §13 above).

## 18. Source / spec references

| Domain area | Primary spec section(s) |
|---|---|
| Organisation hierarchy | §1.2, §6.1, §6.2 |
| Roles & identity | §4.4, §6.1, §8.2 |
| Belt/rank & disciplines | §2.3, §6.1 |
| Memberships & billing | §6.1, §12.2 |
| Classes & timetable | §2.1, §6.1 |
| Bookings | §3.2, §6.1 |
| Attendance & QR check-in | §2.1, §2.2, §6.1, §9 |
| Waivers | §2.2, §6.1, §9 |
| Payment credential custody (business-level only — see `ultm8-payments` for mechanics) | §9.4, §10.4 |
| Tenant isolation (business-level only — see `ultm8-tenant-isolation` for mechanics) | §4.3–§4.5 |
| White-label entitlement | §5.2, §5.3, §5.5 |

## 19. Rules for how other AI agents must use this skill

1. **This skill is a domain/business reference only.** It does not cover NestJS structure, RLS policy syntax, Stripe integration mechanics, or mobile build pipelines — those live in `ultm8-nestjs-module`, `ultm8-tenant-isolation`, `ultm8-payments`, and `ultm8-app-publishing` respectively. Don't duplicate technical decisions here, and don't look here for them.
2. **`[CONFIRMED]` is the only tag that authorizes building against a rule.** `[OBSERVED IN DESIGNS]` and `[UI BEHAVIOUR]` describe what the Figma files show, not a business decision — don't silently promote either into a hard business rule. `[UNRESOLVED]` items must never be implemented from a guess.
3. **If a task requires an `[UNRESOLVED]` item, stop and escalate to the Architect agent** rather than choosing a reasonable-sounding default. This mirrors the project's own standing rule: don't take assumptions, ask.
4. **If this skill conflicts with the current technical spec, the spec wins.** Report the mismatch to the Architect so this skill gets corrected — don't silently pick one source over the other.
5. **Cite section references (§) when asserting a rule** in code comments, PR descriptions, or agent output, so a human reviewer can trace it back to source in one step.
6. **Do not treat Figma sample/placeholder values** (specific belt names, prices, the "IMAS" brand name, discipline lists marked "etc.") **as confirmed business constants.** They illustrate the UI; they are not a spec.
7. **Only the Architect agent may edit this skill.** Any other agent that discovers a gap, contradiction, or newly-needed rule should report it upward, not patch this file directly.
