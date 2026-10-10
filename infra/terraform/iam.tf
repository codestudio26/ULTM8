# Two distinct ECS roles, not one — the standard split, and load-bearing here
# specifically: the execution role is what pulls the image from ECR and resolves
# `secrets` block values (needs Secrets Manager + ECR read); the task role is what
# the running application code itself would assume for any AWS API call apps/api
# makes at runtime. Kept separate so a future AWS SDK call from application code
# (S3/SES, both already in package.json's dependencies) never needs the broader
# execution-role permissions, and vice versa.

resource "aws_iam_role" "ecs_execution" {
  name = "${local.name_prefix}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# The managed policy above covers ECR pull + basic CloudWatch Logs — it does NOT
# cover reading the Secrets Manager values the task definition's own `secrets` block
# needs (see ecs.tf). Scoped to exactly this stack's own secrets, never a wildcard.
resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "${local.name_prefix}-ecs-execution-secrets"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = concat(
        [for s in aws_secretsmanager_secret.db : s.arn],
        [aws_secretsmanager_secret.app_internal.arn],
        [for s in aws_secretsmanager_secret.vendor : s.arn],
      )
    }]
  })
}

resource "aws_iam_role" "ecs_task" {
  name = "${local.name_prefix}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.common_tags
}

# apps/api/src/notifications/notification-delivery.service.ts's own header comment
# (Spec 55 §11.4, Decision 34): "email uses Postmark for transactional delivery...
# AWS SES is the named fallback." That service's own constructor comment is explicit
# that SES credentials "resolve via the AWS SDK's standard provider chain... or an
# IAM role in a real deployment" — this is that IAM role. @aws-sdk/client-s3 (also in
# apps/api/package.json) is NOT given a matching S3 policy here: WaiversModule's own
# r2-client.service.ts uses that SDK against a Cloudflare R2 endpoint (S3-compatible
# API, not real AWS S3), authenticated with R2's own access-key/secret pair from
# secrets.tf's vendor.r2 secret, not an IAM role — verified directly, not assumed.
resource "aws_iam_role_policy" "ecs_task_ses" {
  name = "${local.name_prefix}-ecs-task-ses"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource = "*"
      # SESv2 SendEmailCommand doesn't support resource-level restriction to a
      # single verified identity the way SESv1 could scope by ARN pattern — "*" is
      # the real constraint this API offers, not a shortcut taken here.
    }]
  })
}
