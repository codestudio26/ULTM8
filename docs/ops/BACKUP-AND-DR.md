# Backup & disaster recovery

## Purpose

Closes one of `docs/ULTM8-MASTER-ROADMAP.md` §3's named "genuine gaps — no decision
found at all": *"Database backup/DR strategy, point-in-time recovery, read
replicas — not mentioned anywhere, not even at the decision-log level."* Nothing in
Spec 55, `skills/*/SKILL.md`, or `docs/decisions/POST-SPEC-55-DECISION-LOG.md`
states an RPO/RTO target or a backup policy — this document records **what
`infra/terraform/` actually provisions today**, what that does and doesn't cover,
and flags every number as a first-pass default, not a decision, exactly like
`infra/terraform/README.md` already does for sizing.

## What's actually provisioned

| Mechanism | Where | What it covers |
|---|---|---|
| RDS automated backups | `infra/terraform/rds.tf`, `backup_retention_period = var.rds_backup_retention_days` (default **7 days**), `backup_window = "03:00-04:00"` | Daily snapshot + continuous transaction-log shipping — this is also what makes point-in-time recovery (below) possible. |
| RDS Multi-AZ | `rds.tf`, `multi_az = var.rds_multi_az` (default **true**) | A synchronous standby in a second AZ with automatic failover. **This is availability, not backup** — it protects against an AZ/instance failure, not against a bad migration, a bad `DELETE`, or application-level data corruption, since the standby mirrors every write, good or bad. |
| Storage encryption at rest | `rds.tf`, `storage_encrypted = true` | Every automated snapshot inherits this. |
| Final snapshot on deletion | `rds.tf`, `skip_final_snapshot = var.environment != "production"`, `deletion_protection = var.environment == "production"` | A production RDS instance cannot be deleted without deletion protection first being turned off, and even then always takes a final snapshot — a staging/dev instance does neither, by design (cheaper to tear down and recreate). |
| Vendor-secret rotation state | N/A | Not covered here — see `infra/terraform/secrets.tf`'s own header comment on `lifecycle { ignore_changes = [secret_string] }` for why Stripe/Twilio/Postmark/R2 credentials are out of scope for a database backup doc. |

## Point-in-time recovery (PITR)

A `backup_retention_period > 0` (it's 7) means RDS automated backups already
include PITR to any second within that 7-day window — this is RDS's own default
behavior, not something `rds.tf` had to opt into separately. What this document
adds that Terraform alone doesn't state: **the restore mechanism**
(`aws rds restore-db-instance-to-point-in-time`) **always creates a brand-new RDS
instance** — it cannot restore in place over the running one. Recovering from a
bad deploy or a destructive query therefore means:

1. Restore to a new instance at the target timestamp.
2. Point a temporary app instance (or a `psql` session) at it to confirm the
   restored state is actually what's wanted.
3. Cut the real app over (update the Secrets Manager `DATABASE_URL*` values —
   `secrets.tf` — to the new RDS Proxy target, or re-point RDS Proxy itself) and
   decommission the old instance.

This is deliberately **not** automated in Terraform — recreating a database
instance is exactly the kind of hard-to-reverse action `CLAUDE.md`'s own "No
destructive changes without explicit approval" rule exists for. It's a manual,
human-approved runbook step, not something a `terraform apply` should ever do
unattended. No such runbook exists yet beyond the three steps above — writing one
with real commands/IAM permissions is flagged as follow-up work, not done here.

## Read replicas

None provisioned. Multi-AZ (above) gives HA failover, not read scaling — a
standby isn't queryable. Nothing in this codebase has a read-only query path that
could target a replica (confirmed while writing `infra/terraform/elasticache.tf`'s
own "no read-only Redis path exists" finding earlier in this same infra pass; the
same check applies to Postgres — every `Prisma*Service` in `apps/api/src/common/prisma/`
reads and writes through the same connection). Not a gap worth closing
preemptively.

## Redis (ElastiCache) — not backed up, and here's what that does and doesn't mean

`infra/terraform/elasticache.tf`'s `aws_elasticache_replication_group.main` sets
no `snapshot_retention_limit`, which defaults to `0` — **no automatic Redis
snapshots exist**. This was a deliberate omission, verified against how this
codebase's own job code actually uses Redis before writing this doc, not an
oversight:

- **Repeatable job schedules are self-healing.** Every scheduler in
  `apps/api/src/jobs/` (e.g. `BookingNoShowProcessingScheduler`,
  `ClassOccurrenceGenerationScheduler`) re-registers its repeatable job on
  `onModuleInit()` with a **fixed `jobId`** and a retry/backoff loop (see
  `booking-no-show-processing.processor.ts:22-48` for the concrete pattern,
  identical in every other scheduler). BullMQ treats re-registration under the
  same `jobId` as idempotent. A total Redis data loss therefore does not
  permanently break any of the 4 repeatable schedulers — the next app restart (or
  the next deploy, which always restarts the ECS tasks) re-creates every
  schedule from scratch, no manual intervention needed.
- **Individually-enqueued, not-yet-processed jobs are NOT durable.** A specific
  `notification-fanout` job for one real notification, or a
  `waitlist-cascade-processing` job triggered by one specific No-Show event, only
  exists as a row in Redis until a worker picks it up. If Redis data is lost
  between enqueue and processing, that specific job is gone — the notification
  or cascade it would have performed simply never happens, silently. This is a
  **real, flagged gap**, not glossed over: `at_rest_encryption_enabled = true` and
  Multi-AZ-equivalent durability were never claimed to cover this, and nothing in
  `elasticache.tf`'s comments should be read as saying job data itself is safe.
  Quantifying the actual exposure window (how long a job typically sits enqueued
  before a worker picks it up) hasn't been measured — flagged for follow-up, not
  invented here.

Mitigating this (e.g. `snapshot_retention_limit > 0`, or moving to a
Redis persistence mode) is a real, actionable next step **not done in this
pass** — this document's job is to state the current gap accurately, not to
silently pick a number nothing here has grounds to invent.

## RPO / RTO

No numeric Recovery Point Objective or Recovery Time Objective is stated
anywhere in Spec 55, the decision log, or any skill — see `NFR-TARGETS.md` in
this same directory, which treats this as part of the broader "no numeric NFR
targets exist" gap rather than duplicating the discussion here. What this
document's own defaults imply, without claiming they were chosen to hit any
specific target:

- **RDS PITR window** ≈ up to 7 days back (the configured retention).
- **RDS failover time** on an AZ failure — RDS's own typical Multi-AZ failover is
  low-single-digit minutes; this hasn't been measured against this specific stack
  and shouldn't be quoted as a guarantee.
- **Full restore-to-new-instance** — no measured time; depends on database size,
  which doesn't exist yet (nothing is provisioned or seeded with production data).

## Status

First-pass, Developer-level defaults only — not a reviewed DR plan. Before this
is trusted as a real disaster-recovery strategy: (1) a human needs to pick and
document actual RPO/RTO targets (a product/architecture decision this repo has
no grounds to invent), (2) the restore runbook above needs real commands and a
dry run against a real RDS instance, and (3) the Redis gap above needs an
explicit accept/mitigate decision, not silence.
