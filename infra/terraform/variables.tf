# Every default below is a Developer-level engineering parameter, not a spec-confirmed
# or product-owner-approved number — matching the same "flagged, not silently assumed"
# treatment this codebase already gives comparable inferred choices (e.g.
# LOST_DISPUTE_THRESHOLD, apps/api/src/jobs/chargeback-pattern-restriction.processor.ts's
# own header comment). Nothing in Spec 55, skills/*/SKILL.md, or
# docs/decisions/POST-SPEC-55-DECISION-LOG.md names an AWS region, instance size, or
# engine-version policy — Postgres 16 / Redis 7 below are the one exception, carried
# over directly from what's ALREADY confirmed real and running (.github/workflows/ci.yml
# and .devcontainer/docker-compose.yml both pin these exact versions), not invented here.

variable "aws_region" {
  description = "AWS region to deploy into. Not named anywhere in confirmed material — us-east-1 is a placeholder default (cheapest, most-available-services region), not a decision. Override before a real apply."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Short name used as a prefix/tag on every resource this stack creates."
  type        = string
  default     = "ultm8"
}

variable "environment" {
  description = "Deployment environment name (e.g. staging, production). Tags and names every resource; also lets the same config stand up more than one environment."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for this stack's own VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "availability_zone_count" {
  description = "Number of AZs to spread subnets across. 2 is the practical minimum for RDS Multi-AZ and an ALB to mean anything."
  type        = number
  default     = 2
}

# ---- RDS (Spec §11.6, Decision 11) ----

variable "postgres_engine_version" {
  description = "Matches the exact major version already running in CI (.github/workflows/ci.yml's postgres:16 service container) and the devcontainer (.devcontainer/docker-compose.yml) — not a new choice made here."
  type        = string
  default     = "16.4"
}

variable "rds_instance_class" {
  description = "No sizing guidance exists anywhere in confirmed material. db.t4g.medium (2 vCPU/4GB, burstable/Graviton) is a reasonable, inexpensive first-pass default for a not-yet-launched product — resize once real load data exists, don't guess further than that."
  type        = string
  default     = "db.t4g.medium"
}

variable "rds_allocated_storage_gb" {
  description = "Starting storage size in GB. RDS storage autoscaling (max below) matters more than this starting point."
  type        = number
  default     = 50
}

variable "rds_max_allocated_storage_gb" {
  description = "Ceiling for RDS storage autoscaling."
  type        = number
  default     = 200
}

variable "rds_multi_az" {
  description = "Nothing in confirmed material states an uptime/SLA target (docs/ULTM8-MASTER-ROADMAP.md §3 lists 'numeric NFR targets' as a genuine gap) — defaults to true (the safer, more expensive choice) rather than guessing an SLA doesn't need it. Revisit once a real NFR target exists."
  type        = bool
  default     = true
}

variable "rds_backup_retention_days" {
  description = "See infra/terraform/README.md's own backup/DR section — 7 days is a reasonable first-pass default, not a decided retention policy."
  type        = number
  default     = 7
}

# ---- ElastiCache Redis (Spec §11.6, Decision 11 — BullMQ's own backing store) ----

variable "redis_engine_version" {
  description = "Matches the exact version already running in CI/devcontainer (redis:7) — not a new choice."
  type        = string
  default     = "7.1"
}

variable "redis_node_type" {
  description = "No sizing guidance exists anywhere in confirmed material. cache.t4g.micro is the smallest practical first-pass size — BullMQ's queue depth in this codebase (8 queues, ~1,745 lines of job code per docs/ULTM8-MASTER-ROADMAP.md §3) is nowhere near what would need more, but this has never been load-tested."
  type        = string
  default     = "cache.t4g.micro"
}

# ---- ECS Fargate (Spec §11.6, Decision 11; task-definition-revision rollback per Decision 32) ----

variable "ecs_task_cpu" {
  description = "Fargate task-level vCPU units (1024 = 1 vCPU). No sizing guidance exists anywhere in confirmed material."
  type        = number
  default     = 512
}

variable "ecs_task_memory_mb" {
  description = "Fargate task-level memory in MB. Must be a valid Fargate cpu/memory pairing for ecs_task_cpu above."
  type        = number
  default     = 1024
}

variable "ecs_desired_count" {
  description = "Steady-state Fargate task count. 2, not 1, as the first-pass default — matching this repo's own migration-safety convention (never assume a single replica; see docs/decisions and the chargeback-pattern-restriction job's own idempotent-by-design reasoning) means the app must already tolerate >1 replica, so there's no reason to default to a single point of failure."
  type        = number
  default     = 2
}

# ---- Cognito (Decision 100 — Platform Admin's own identity realm) ----

variable "cognito_mfa_required" {
  description = "Decision 100's own text: 'the User Pool itself (MFA set to Required, per §4.4)'. Not a default to leave overridable casually — kept as a variable only so a non-production sandbox pool can relax it, never as an invitation to skip this in a real environment."
  type        = bool
  default     = true
}

# ---- CD pipeline (.github/workflows/deploy.yml) ----

variable "api_image_tag" {
  description = "Immutable image tag to deploy to Fargate — see apps/api/Dockerfile's own header comment and ecr.tf's IMMUTABLE tag-mutability setting. Defaults to \"latest\" only so `terraform plan` has something syntactically valid to reference before any image has ever been pushed; .github/workflows/deploy.yml always passes a real git-SHA tag explicitly via -var, never relies on this default for an apply."
  type        = string
  default     = "latest"
}

# ---- Tags ----

variable "additional_tags" {
  description = "Extra tags merged onto every resource this stack creates, on top of Project/Environment/ManagedBy."
  type        = map(string)
  default     = {}
}
