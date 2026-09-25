# ElastiCache Redis (Spec §11.6, Decision 11) — BullMQ's own backing store
# (apps/api/src/jobs/, 8 queues/8 processors/4 schedulers per
# docs/ULTM8-MASTER-ROADMAP.md §3). Engine version pinned to what's already
# confirmed real (redis:7 in CI/devcontainer) — sizing is a flagged first-pass
# default, see variables.tf.

resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name_prefix}-redis"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${local.name_prefix}-redis"
  description          = "BullMQ backing store for apps/api's background jobs."

  engine         = "redis"
  engine_version = var.redis_engine_version
  node_type      = var.redis_node_type
  port           = 6379

  # Single primary, no read replica — BullMQ's own Redis client library talks to one
  # node; a read replica would add cost with nothing in this codebase able to use it
  # (no read-only Redis path exists anywhere in apps/api/src/jobs/). Revisit only if
  # queue throughput genuinely needs it, not preemptively.
  num_cache_clusters = 1

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  # FOUND ON REVIEW, before this ever shipped: transit encryption is deliberately
  # NOT enabled here, unlike at-rest. apps/api/src/jobs/queue.module.ts's own
  # redisConnection() builds ioredis's connection options directly from REDIS_URL's
  # parsed host/port/password and never sets a `tls` option — verified by reading
  # that function directly, not assumed. ElastiCache with transit encryption
  # required rejects a plain (non-TLS) client outright, which would silently break
  # every one of this codebase's 8 BullMQ queues the instant this stack went live.
  # Turning this on needs an accompanying application-code change (pass `tls: {}`
  # when REDIS_URL's scheme is rediss://) — real, flagged, not done here, since this
  # is an infra-only pass and that's an apps/api code change, not a Terraform one.
  transit_encryption_enabled = false

  automatic_failover_enabled = false # requires num_cache_clusters >= 2 — see the single-primary note above.

  tags = local.common_tags
}
