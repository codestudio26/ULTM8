# infra/terraform — first-pass AWS stack

Closes the "genuine gaps" `docs/ULTM8-MASTER-ROADMAP.md` §3 named: no Dockerfile, no
IaC, no Terraform/CDK/CloudFormation existed anywhere in this repo before this. This
is the "code that can be written now" half of that section's own framing — it does
**not** provision anything by itself; nobody has run `terraform apply` against a real
AWS account from this environment (no AWS credentials exist here, same as every
other external-service integration in this codebase — Stripe, Cognito, Twilio, R2 —
per that same section).

## What this provisions

Every target `docs/ULTM8-MASTER-ROADMAP.md` §3 names under "decided, zero
provisioning":

| Target | Decision | File |
|---|---|---|
| VPC (public/private subnets, NAT, 2 AZs) | implied by everything below needing a network | `vpc.tf` |
| RDS Postgres | Spec §11.6, Decision 11 | `rds.tf` |
| RDS Proxy | Decision 63 | `rds_proxy.tf` |
| ElastiCache Redis | Spec §11.6, Decision 11 (BullMQ's own store) | `elasticache.tf` |
| ECS Fargate (cluster, task def, service, ALB) | Spec §11.6, Decision 11; rollback model per Decision 32 | `ecs.tf`, `alb.tf` |
| ECR | implied by Fargate needing an image source | `ecr.tf` |
| Secrets Manager | Spec §11.6, `ultm8-payments` §1 | `secrets.tf` |
| Cognito (Platform Admin IdP) | Decision 100 | `cognito.tf` |
| IAM roles | least-privilege execution/task split | `iam.tf` |

## What every "first-pass default" actually means

Nothing in Spec 55, `skills/*/SKILL.md`, or
`docs/decisions/POST-SPEC-55-DECISION-LOG.md` names an AWS region, instance size,
Multi-AZ policy, or numeric uptime/SLA target — `docs/ULTM8-MASTER-ROADMAP.md` §3
lists "numeric NFR targets" as a genuine, un-decided gap. Every such value in
`variables.tf` is a flagged, reviewable Developer-level default, not a decision —
each one's own `description` says so and cites what it's grounded in (or admits it
isn't). Two exceptions that ARE grounded, not guessed: Postgres 16 and Redis 7 —
carried over directly from what's already confirmed real and running
(`.github/workflows/ci.yml`'s service containers, `.devcontainer/docker-compose.yml`).

One real bug this pass **caught and fixed before it shipped**: `elasticache.tf`
originally enabled Redis transit encryption by default (the "safer" choice) until
directly reading `apps/api/src/jobs/queue.module.ts`'s own `redisConnection()`
showed it never sets a `tls` option on its ioredis client — TLS-required Redis would
have silently broken all 8 of this codebase's BullMQ queues the moment this stack
went live. Left disabled, with the finding documented inline in `elasticache.tf`
itself and the accompanying app-code fix (`tls: {}` when `REDIS_URL` is `rediss://`)
named as real, flagged, and NOT done here — an infra pass has no business editing
`apps/api/src/jobs/queue.module.ts`.

## Before you run this for real

1. **A Terraform backend.** `versions.tf` deliberately has none configured — which
   backend (S3+DynamoDB lock table, Terraform Cloud, etc.) is itself a real decision
   nothing here has the authority to assume. Add a `backend` block before the first
   real `terraform init`.
2. **`var.domain_name` / `var.route53_zone_id`** (`alb.tf`) — no default. Nothing in
   confirmed material names ULTM8's real production domain.
3. **AWS credentials** with permission to create everything above — this environment
   has none.
4. **Fill in the vendor secret placeholders** (`secrets.tf`'s `vendor_secret_placeholders`
   — Stripe/Twilio/Postmark/R2) by hand after apply, via the console or
   `aws secretsmanager put-secret-value`. They're created with `REPLACE_ME` values and
   `lifecycle { ignore_changes = [secret_string] }` specifically so a later
   `terraform apply` never clobbers whatever gets set out-of-band.
5. **Push a real image to the ECR repo this creates** before the ECS service can
   start healthy — `ecs.tf`'s own task definition references `var.api_image_tag`
   (default `"latest"`, only so `plan`/`validate` have something syntactically
   valid before any image exists). `../../.github/workflows/deploy.yml`'s
   `build-and-push` job builds and pushes a real git-SHA-tagged image and passes it
   to `terraform apply` as `-var="api_image_tag=<sha>"` on every dispatch — a real
   deploy never applies on the floating default (see `apps/api/Dockerfile`'s own
   header comment and `ecr.tf`'s `IMMUTABLE` tag-mutability setting).
6. **Apply the migration SQL** against the new RDS instance — this Terraform
   creates the database and the 6 Postgres roles' own Secrets Manager credentials,
   but does not run `apps/api/prisma/migrations/*` against it.
   `../../.github/workflows/deploy.yml`'s `migrate` job does this as an explicit,
   opt-in step (`run_migrations: true` on dispatch): an `aws ecs run-task` against
   the exact same task definition the service itself runs, command-overridden to
   `npx prisma migrate deploy`, reusing the service's own private-subnet networking
   and Secrets-Manager-sourced `DATABASE_URL` rather than a separate migration task
   definition or a bastion host — the RDS Proxy has no route from the public
   internet, so this can't run from the GitHub-hosted runner directly. Matches
   every migration in this repo's own "verify with a real Postgres run before
   trusting this" caveat; this stack has not been.

## CD pipeline

`../../.github/workflows/deploy.yml` is `workflow_dispatch`-only (manual, gated) —
there is deliberately no `on: push` trigger, so a routine merge to `master` can
never silently attempt a real cloud deploy. It always builds and pushes
`apps/api`'s image, then runs `terraform plan`, and only runs `terraform apply` /
the migration task when the dispatch explicitly asks for them
(`terraform_action: apply`, `run_migrations: true`). Both jobs also target a
GitHub Environment named after the `environment` input (`staging` / `production`)
— configure required reviewers on those Environments in this repo's own
**Settings > Environments** before dispatching for real, on top of everything
listed above.

It needs these GitHub Environment (or repository) variables set, none of which
exist yet in this repo — dispatching before they're set fails closed at the
"configure AWS OIDC" step, not a silent no-op:

| Variable | What it's for |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | IAM role for OIDC federation (`aws-actions/configure-aws-credentials`) — a CI trust decision this Terraform does not itself provision; no long-lived AWS keys are stored as secrets anywhere in this repo. |
| `AWS_REGION` | Same region as `var.aws_region` (see this README's own caveat above — nothing confirms a real region yet). |
| `ECR_REPOSITORY_NAME` | The name `ecr.tf`'s `aws_ecr_repository.api` creates (`${var.project}-${var.environment}/api`). |
| `DOMAIN_NAME` / `ROUTE53_ZONE_ID` | Same values `alb.tf`'s `var.domain_name`/`var.route53_zone_id` need — no default, same reasoning as item 2 above. |
| `TF_BACKEND_CONFIG` | Optional. Without it, `terraform init` falls back to a local backend scoped to that one ephemeral runner — **no state persists between runs** until item 1 above (a real backend) is decided and this is set. |

## Backup/DR, APM/observability, and NFR targets

Not this directory's concern directly, but named in the same
`docs/ULTM8-MASTER-ROADMAP.md` §3 "genuine gaps" list this whole infra phase
works through — see `../../docs/ops/BACKUP-AND-DR.md`,
`../../docs/ops/APM-AND-OBSERVABILITY.md`, and `../../docs/ops/NFR-TARGETS.md`
for what this stack's own defaults (`rds_backup_retention_days`,
`aws_cloudwatch_log_group.api`, the total absence of any confirmed uptime/latency
target, etc.) actually mean and don't mean.

## Verification actually performed (and its real limits)

- `terraform fmt -check` — clean across all 15 `.tf` files (confirms syntactically valid
  HCL throughout; `fmt` cannot parse and reformat invalid HCL, so this is real
  signal, not a formality).
- `terraform validate` (which checks resource-argument correctness against each
  provider's real schema) could **not** be run in this environment —
  `registry.terraform.io` is blocked by this sandbox's own organization egress
  policy (`403 Forbidden` on the provider-discovery request), the same class of
  denial `apps/api/Dockerfile`'s own header comment already discloses for
  Docker Hub's CDN. Not retried or routed around, per this environment's own proxy
  policy ("do not retry organization policy denials — report them"). **Run
  `terraform init && terraform validate` for real before trusting this past a
  walking skeleton** — the same caveat every hand-authored SQL migration in this
  repo already carries for the identical reason (no reachable Postgres/Terraform
  registry at authoring time).
- Every fact this configuration's own comments cite as "confirmed" (Postgres 16,
  Redis 7, Decision 32's rollback model, Decision 63, Decision 100's MFA-required
  text, the SES-fallback IAM grant, the missing-TLS-support finding above) was
  checked directly against the cited file/decision/skill section before being
  written down, not assumed.
