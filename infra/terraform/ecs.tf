# ECS Fargate (Spec §11.6, Decision 11). Rollback model is Decision 32's own
# confirmed text (skills/ultm8-nestjs-module/SKILL.md §11.6): "redeploying the
# previous Fargate task-definition revision, not a database-level rollback" — this
# is exactly what registering a new aws_ecs_task_definition revision on every deploy
# (rather than mutating one in place) gives for free.

resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name_prefix}-api"
  retention_in_days = 30

  tags = local.common_tags
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name_prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.ecs_task_cpu
  memory                   = var.ecs_task_memory_mb
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name = "api"
      # var.api_image_tag defaults to "latest" only so `terraform plan`/`validate`
      # have something syntactically valid to reference before any image has ever
      # been pushed — .github/workflows/deploy.yml's terraform job always passes a
      # real, immutable git-SHA tag explicitly (see ecr.tf's own IMMUTABLE tag
      # policy), never applies on the floating default.
      image     = "${aws_ecr_repository.api.repository_url}:${var.api_image_tag}"
      essential = true

      portMappings = [{
        containerPort = 3000
        protocol      = "tcp"
      }]

      # Plain, non-secret configuration — everything credential-shaped goes through
      # `secrets` below instead, sourced from secrets.tf's own Secrets Manager
      # entries, never in cleartext here.
      environment = [
        { name = "PORT", value = "3000" },
        { name = "NODE_ENV", value = "production" },
        { name = "CORS_ALLOWED_ORIGINS", value = "https://${var.domain_name}" },
        { name = "JWT_ACCESS_TTL", value = "15m" },        # Spec §8.3's own confirmed tenant-realm default.
        { name = "PLATFORM_ADMIN_JWT_TTL", value = "5m" }, # Decision 100's own confirmed Developer-level default — see that decision's own "What this does NOT resolve" section.
        { name = "AWS_SES_REGION", value = var.aws_region },
        { name = "COGNITO_USER_POOL_ID", value = aws_cognito_user_pool.platform_admin.id },
        { name = "COGNITO_CLIENT_ID", value = aws_cognito_user_pool_client.platform_admin.id },
      ]

      secrets = concat(
        [for role, cfg in local.db_roles : {
          name      = cfg.env_var
          valueFrom = aws_secretsmanager_secret.db[role].arn
        }],
        [
          { name = "REDIS_URL", valueFrom = "${aws_secretsmanager_secret.app_internal.arn}:REDIS_URL::" },
          { name = "JWT_ACCESS_SECRET", valueFrom = "${aws_secretsmanager_secret.app_internal.arn}:JWT_ACCESS_SECRET::" },
          { name = "PLATFORM_ADMIN_JWT_SECRET", valueFrom = "${aws_secretsmanager_secret.app_internal.arn}:PLATFORM_ADMIN_JWT_SECRET::" },
          { name = "QR_CLASS_TOKEN_SECRET", valueFrom = "${aws_secretsmanager_secret.app_internal.arn}:QR_CLASS_TOKEN_SECRET::" },
          { name = "QR_STUDENT_TOKEN_SECRET", valueFrom = "${aws_secretsmanager_secret.app_internal.arn}:QR_STUDENT_TOKEN_SECRET::" },
          { name = "STRIPE_SECRET_KEY", valueFrom = "${aws_secretsmanager_secret.vendor["stripe"].arn}:STRIPE_SECRET_KEY::" },
          { name = "STRIPE_WEBHOOK_SECRET", valueFrom = "${aws_secretsmanager_secret.vendor["stripe"].arn}:STRIPE_WEBHOOK_SECRET::" },
          { name = "TWILIO_ACCOUNT_SID", valueFrom = "${aws_secretsmanager_secret.vendor["twilio"].arn}:TWILIO_ACCOUNT_SID::" },
          { name = "TWILIO_AUTH_TOKEN", valueFrom = "${aws_secretsmanager_secret.vendor["twilio"].arn}:TWILIO_AUTH_TOKEN::" },
          { name = "TWILIO_VERIFY_SERVICE_SID", valueFrom = "${aws_secretsmanager_secret.vendor["twilio"].arn}:TWILIO_VERIFY_SERVICE_SID::" },
          { name = "POSTMARK_SERVER_TOKEN", valueFrom = "${aws_secretsmanager_secret.vendor["postmark"].arn}:POSTMARK_SERVER_TOKEN::" },
          { name = "R2_ACCOUNT_ID", valueFrom = "${aws_secretsmanager_secret.vendor["r2"].arn}:R2_ACCOUNT_ID::" },
          { name = "R2_ACCESS_KEY_ID", valueFrom = "${aws_secretsmanager_secret.vendor["r2"].arn}:R2_ACCESS_KEY_ID::" },
          { name = "R2_SECRET_ACCESS_KEY", valueFrom = "${aws_secretsmanager_secret.vendor["r2"].arn}:R2_SECRET_ACCESS_KEY::" },
          { name = "R2_BUCKET_NAME", valueFrom = "${aws_secretsmanager_secret.vendor["r2"].arn}:R2_BUCKET_NAME::" },
        ]
      )
      # NOTIFICATIONS_FROM_EMAIL, STRIPE_CONNECT_RETURN_URL/REFRESH_URL, and
      # QR_ATTENDANCE_TOKEN_TTL_SECONDS / PLATFORM_ADMIN_IMPERSONATION_TTL_SECONDS
      # (all in apps/api/.env.example) are deliberately NOT set here — every one of
      # them either needs a real value this Terraform has no basis to invent
      # (a real sender address, real Stripe Connect return URLs once a frontend
      # domain is decided) or already has a safe application-level default
      # (both TTL env vars fall back to a coded default when unset — verified
      # against their own consuming services before leaving them out, not assumed).

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }
    }
  ])

  tags = local.common_tags
}

resource "aws_ecs_service" "api" {
  name            = "${local.name_prefix}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.ecs_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.fargate.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  # Matches Decision 32's own "redeploy the previous task-definition revision"
  # rollback model: a new deploy is a new task-definition revision plus a rolling
  # update, never in-place container mutation.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  depends_on = [aws_lb_listener.https]

  tags = local.common_tags
}
