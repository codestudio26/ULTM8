# APM & observability

## Purpose

Closes `docs/ULTM8-MASTER-ROADMAP.md` §3's named gap: *"Error-tracking/APM
(Sentry, Datadog, or equivalent) — none; only NestJS's built-in `Logger`,"* and
gives Decision 53 (`CloudWatch (job-queue observability)` — *"Partially — a
logging rule is designed, no CloudWatch integration exists"*, per the same
roadmap's own decided/provisioned table) a concrete account of what "the logging
rule" actually is and what closing the "no CloudWatch integration" half would
take. Confirmed absent, not assumed: no `sentry`/`datadog`/`newrelic`/
`opentelemetry` reference exists anywhere in `apps/api` (checked directly before
writing this).

## What's actually provisioned

| Layer | Where | What it gives you |
|---|---|---|
| Structured application logs | Every service/processor uses NestJS's built-in `Logger` (e.g. `apps/api/src/jobs/*.processor.ts`, one `private readonly logger = new Logger(ClassName.name)` per class) | Leveled (`log`/`warn`/`error`) console output, tagged with the emitting class's name. |
| Log shipping | `infra/terraform/ecs.tf`, `logConfiguration.logDriver = "awslogs"` writing to `aws_cloudwatch_log_group.api` (`infra/terraform/ecs.tf`) | Every container's stdout/stderr — i.e. every `Logger` call above — lands in CloudWatch Logs, 30-day retention. This is the actual mechanism behind Decision 53's "a logging rule is designed": every job processor already calls `this.logger.error(...)` on failure (verified directly across all 8 processors before writing this), so the *signal* already exists in the log stream once this stack is deployed. |
| Infrastructure metrics | `infra/terraform/ecs.tf`, `aws_ecs_cluster.main`'s `setting { name = "containerInsights", value = "enabled" }` | CPU/memory/network utilization per task and per service, and ECS-level metrics (task count, deployment events) — infrastructure-level, not application-level. |
| ALB/target-group health | `infra/terraform/alb.tf`, `aws_lb_target_group.api`'s `health_check` block | Whether the app is up enough to answer `GET /v1/docs` with a 200 — see that file's own comment on why this route and not a dedicated `/health(z)` (none exists yet; `main.ts`/`app.module.ts` were checked directly, not assumed). |

## What's genuinely missing

- **No CloudWatch → alarm path.** The ERROR-level log lines land in CloudWatch
  Logs (above), but nothing watches for them. A real integration would be a
  `aws_cloudwatch_log_metric_filter` on `aws_cloudwatch_log_group.api` matching
  NestJS's own `Logger.error` output pattern, feeding an
  `aws_cloudwatch_metric_alarm` wired to an SNS topic — this is the concrete,
  small, Terraform-codeable piece that would close Decision 53's "no CloudWatch
  integration" half. **Not built in this infra pass** (scoped to Dockerfile +
  first-pass Terraform + CD skeleton + these three docs) — flagged here as the
  next well-scoped infra task, not invented as if already done.
- **No distributed tracing.** No request-correlation ID or trace propagation
  exists across the API → BullMQ worker → Stripe/Twilio/Postmark/R2 boundary —
  confirmed by the absence of any tracing library in `apps/api/package.json` and
  no `x-request-id`-style header handling found in `apps/api/src/common/`. A
  failure that spans a webhook → job → external-API call today can only be
  reconstructed by reading multiple `Logger` lines by hand.
  No OpenTelemetry/X-Ray integration exists.
- **No error-tracking/APM SaaS.** No Sentry, Datadog, New Relic, or equivalent —
  confirmed absent from `apps/api/package.json` and every `.env.example`. Stack
  traces only exist in whatever CloudWatch Logs captured from stdout/stderr.
- **No dashboards or alarms beyond Container Insights' own defaults.** Nothing
  alerts a human when the ECS service is unhealthy, when a queue backs up, or
  when a specific job class starts failing repeatedly — Container Insights
  surfaces the raw metrics, but no `aws_cloudwatch_metric_alarm` or dashboard
  resource exists in `infra/terraform/` for any of them yet.
- **No synthetic/health-check endpoint.** `GET /v1/docs` (Swagger's docs page) is
  what the ALB target group and any future uptime check would have to use — it's
  a real, always-200-when-the-app-is-up route, but it wasn't built to be a health
  check and doesn't report dependency health (DB/Redis reachability). Adding a
  dedicated `/health` route that actually pings Postgres/Redis is application
  code, not infra — flagged, not this pass's to build.

## Recommended near-term scope (not done here — flagged for a follow-up pass)

Roughly in order of cost/effort vs. value:

1. CloudWatch Logs metric filter + alarm on ERROR-level job-processor logs
   (closes Decision 53 concretely — see above). Needs an SNS topic with no
   subscription pre-wired (mirrors `infra/terraform/secrets.tf`'s own
   "create the primitive, a human fills in the target" pattern for vendor
   secrets) since no on-call/paging tool is named anywhere in confirmed material.
2. A real `/health` route in `apps/api` that checks DB + Redis reachability, and
   pointing the ALB target group's `health_check.path` at it instead of
   `/v1/docs`.
3. Request-ID propagation (a NestJS interceptor tagging every log line with a
   correlation ID, and passing it through BullMQ job data) — the cheapest step
   toward tracing without adopting a new vendor/library.
4. An error-tracking SaaS (Sentry is the most common NestJS-ecosystem choice, but
   this is a real product/tooling decision, not something this document has the
   authority to pick).

## Status

First-pass. What exists (structured logs → CloudWatch Logs, Container Insights,
ALB health checks) is real and already wired through `infra/terraform/`. Nothing
above turns a log line into a page to a human yet — that gap is documented, not
silently left implicit.
