# ULTM8 — Developer Handover Package (v55)

**Date packaged:** 27 Aug 2026
**Spec version:** v55 — 84 pages, reconciled and dev-handoff-ready

This package is everything a development team needs to start building ULTM8 from a single, internally-consistent source. Read this file first — it tells you what's in here and where to actually start reading.

---

## What's in this folder

| File | What it is | Do you need to read it? |
|---|---|---|
| `ULTM8_Technical_Specification_55.docx` | **The spec. This is the real deliverable.** Editable Word doc — data model, API surface, background jobs, payments, NFRs, and a full decision log. | Yes — this is the canonical reference. |
| `ULTM8_Technical_Specification_55.pdf` | Same content as the .docx, as a PDF. Useful for read-only sharing, printing, or anyone without Word. | Only if you prefer PDF to Word. |
| `ultm8-domain-rules.skill` | An optional reference file for teams using Claude (Claude Code / Claude in an IDE / Cowork) as part of their dev workflow. Distills the spec's business rules into a flat, tagged lookup — see "About the skill file" below. | Optional. Only relevant if your team uses Claude day-to-day. |
| `review-history-tracker.html` | An audit trail of how this spec was built — every review pass, what it found, what got resolved. Open it in any browser. | No — reference only, not required reading. It's here so nothing about *why* a decision was made gets lost. |

---

## Where to actually start

**Open `ULTM8_Technical_Specification_55.docx` and go straight to Section 1.4, "How to read this document."** That section exists specifically to orient a new reader — it explains how the three parts of this spec relate to each other:

- **Sections 1–11** — the current-state canonical reference. Build against these. Every decision that's been made is already folded into the actual data model, API, job list, payments, and NFR sections — not left sitting only in a changelog.
- **Section 12.1 (Decision log)** — the audit trail, not a second source of truth. Read it to understand *why* a decision was made, or to trace a decision number cited elsewhere. Don't derive new behavior from it that isn't already reflected in Sections 1–11.
- **Section 12.2 (Open items)** — **explicitly not resolved.** Everything here is a real, known gap or a question still pending product or legal input. Several items name who needs to weigh in before it's safe to build. Treat these the way you'd treat a ticket still sitting in "needs decision."

Section 1.4 also has a **subsystem index** — a quick map from feature area (Payments, Attendance, Grading, etc.) to the sections and decision numbers that govern it, so you can jump straight to what's relevant to the ticket you're picking up instead of reading 84 pages end to end.

There's also a **Section 14 Glossary** at the very end of the document — entities, status enums, and platform acronyms (RLS, SAQ-A, Bull Board, IANA timezone, etc.), each with a pointer back to its authoritative section. Use it as a quick lookup, not as a replacement for the real section.

---

## Before you start building: know the open items

This spec is thorough, but it is **not** a claim that every question has been answered. Section 12.2 currently lists real, unresolved items — among them:

- Guardian age-threshold(s) per jurisdiction (provisional, pending legal review)
- Data residency / GDPR & LGPD compliance across markets
- Legal sufficiency of the typed-name e-signature for liability waivers
- A second, unexplained API endpoint (`POST /classes/{id}/attendance-scan`) that needs confirming with the product owner before backend work starts on it
- The trial-reissuance / account-recreation loophole — deliberately left open, not solved

None of these should be built against from a guess. If a ticket touches one of them, flag it back to your product owner rather than picking a reasonable-sounding default — that's the standing rule this whole spec was built under, and it's worth keeping.

---

## About the skill file (optional)

If your team uses Claude as part of its actual development workflow (Claude Code, an IDE integration, or Cowork), `ultm8-domain-rules.skill` is worth loading in. It's not a different source of truth — it's a compressed, instantly-scannable version of the spec's business rules, with every rule tagged `[CONFIRMED]`, `[OBSERVED IN DESIGNS]`, `[UI BEHAVIOUR]`, or `[UNRESOLVED]`, so an AI assistant helping with implementation, review, or tests doesn't quietly treat a Figma mockup detail or a decision-log aside as if it were settled and safe to code against.

To use it: unzip it if needed and add it to wherever your Claude setup looks for skills (a `.skill` file is a small zip — most Claude apps offer to save it directly when you open it). If your team doesn't use Claude day-to-day, you can ignore this file entirely — everything it contains is already in the spec itself.

If you don't use it, that's completely fine — it's a convenience layer, not a requirement.

---

## If you find something the spec gets wrong

It happens — this spec was built through many rounds of adversarial review and a full reconciliation pass, but no process like that is infallible. If you find something in Sections 1–11 that contradicts itself, or a decision-log entry that no longer matches the section it describes, that's worth flagging back rather than silently working around — it's exactly the kind of drift the reconciliation pass in this version was built to catch, and it's possible something slipped through.

Good luck with the build.
