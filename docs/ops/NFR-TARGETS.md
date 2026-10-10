# Numeric NFR targets

## Purpose

Closes `docs/ULTM8-MASTER-ROADMAP.md` §3's named gap, quoted in full so nothing
here overstates it: *"Numeric NFR targets (uptime/SLA, p95 latency,
concurrent-user budgets) — none found anywhere in the repo."* That statement was
re-verified, not assumed, before writing this document: Spec 55, every
`skills/*/SKILL.md`, and `docs/decisions/POST-SPEC-55-DECISION-LOG.md` were all
checked, and none of them states a number for any category below.

**No number in this document is a target, an SLA, or a decision.** Per
`CLAUDE.md`'s own standing rule — *"never invent unspecified business logic... if
a task touches something the spec doesn't confirm, mark it explicitly as
unresolved and escalate"* — this document's only job is to (1) name each NFR
category that has no confirmed number, and (2) state plainly, without
interpreting it as intent, what the infra choices already made in
`infra/terraform/` happen to imply if left unchanged. Treat every row below as a
question for the product owner/architect, not an answer.

## The gap, by category

| Category | Confirmed target | What the current infra shape implies (not a target — see caveat above) |
|---|---|---|
| **Uptime / availability SLA** | None. Not stated anywhere. | `rds_multi_az = true` (default) and `ecs_desired_count = 2` (default) avoid the *cheapest* single points of failure, but were chosen because "never assume a single replica" is this codebase's own general engineering posture (see `infra/terraform/variables.tf`'s own comment on `ecs_desired_count`) — not because any stated SLA number required them. No SLA percentage (99.9%? 99.95%?) has ever been named. |
| **Latency (p50/p95/p99)** | None. | Nothing in `infra/terraform/` sizes for a latency target — `ecs_task_cpu`/`ecs_task_memory_mb` (512/1024, the smallest sensible Fargate pairing) were chosen as "a reasonable, inexpensive first-pass default for a not-yet-launched product," per that variable's own description, not derived from any p95 budget. No load test has ever been run against this codebase (nothing is deployed to run one against). |
| **Throughput / concurrent-user budget** | None. | `rds_instance_class = db.t4g.medium` and `redis_node_type = cache.t4g.micro` are both explicitly flagged in `infra/terraform/variables.tf` as "no sizing guidance exists anywhere in confirmed material" — smallest-practical-size defaults, not capacity-planned against an expected tenant/user count. Nothing in Spec 55 states an expected number of Franchises, Schools, or concurrent Students at launch or at any future milestone. |
| **Durability (RPO)** | None. | See `BACKUP-AND-DR.md` in this same directory — the 7-day backup retention window is a default, not a stated RPO. |
| **Recovery time (RTO)** | None. | See `BACKUP-AND-DR.md` — no restore has ever been timed against a real instance; there's nothing running to time it against. |
| **Error budget** | None. | No SLA exists to derive one from (see row 1). |
| **Job-queue processing latency** (e.g. how fast a `notification-fanout` job should complete after enqueue) | None. | `CRON_EVERY_15_MINUTES`-style constants in `apps/api/src/jobs/*.processor.ts` (e.g. `booking-no-show-processing.processor.ts`) are each individually flagged in their own header comments as "a Developer-level choice... flagged for Architect review," following the same pattern as this whole document — this is a pre-existing, already-acknowledged instance of the same gap, not a new one. |

## Why this wasn't filled in here

Two reasons, both by design, not oversight:

1. **These are product/business decisions, not infrastructure ones.** An uptime
   target trades directly against cost (Multi-AZ, NAT-per-AZ, redundant Fargate
   tasks all bill more) and against how much operational tooling
   (`APM-AND-OBSERVABILITY.md`'s own gaps) is worth building before launch. A
   latency/throughput target needs a real expected user count, which needs a
   go-to-market decision this repository has no visibility into. Neither is an
   engineering-default question the way `postgres_engine_version` or
   `redis_node_type` are.
2. **Nothing is deployed to measure against yet.** Even if targets existed,
   `docs/ULTM8-MASTER-ROADMAP.md` §3's own framing stands: *"nothing is
   provisioned"* beyond this infra phase's own first-pass, un-applied Terraform.
   There's no running system to load-test, and inventing a specific millisecond
   or percentage figure with nothing to validate it against would be exactly the
   "plausible-sounding guess" `CLAUDE.md` says never to fill a gap with.

## What closing this gap actually requires

A conversation with the product owner (or whoever owns launch planning) covering,
at minimum: an expected uptime commitment (if any exists in a customer-facing
contract or a support-tier promise); an expected concurrent-tenant/user count at
launch and at some future milestone (6/12 months); and how much latency
degradation is acceptable before it's treated as an incident. Once any of these
exist, they belong in `docs/decisions/POST-SPEC-55-DECISION-LOG.md` as a formal
decision (this file's own numbering continues from Decision 70) — not silently
folded into this document, which should stay a record of the gap until it's
actually closed.

## Status

Unresolved, by the same `[UNRESOLVED]` tagging discipline
`skills/ultm8-domain-rules/SKILL.md` uses for business-rule gaps — this document
exists to make that status explicit and escalatable, not to resolve it.
