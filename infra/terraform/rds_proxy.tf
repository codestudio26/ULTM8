# RDS Proxy (Decision 63) — connection pooling in front of RDS, sitting between
# Fargate tasks and the database. security_groups.tf's own comment: every app
# connection is proxied, nothing talks to RDS directly.

resource "aws_iam_role" "rds_proxy" {
  name = "${local.name_prefix}-rds-proxy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "rds.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.common_tags
}

# Scoped to exactly the 6 db-credential secrets RDS Proxy needs to authenticate
# with — never a wildcard "all Secrets Manager secrets" grant, matching this
# codebase's own least-privilege-Postgres-role convention.
resource "aws_iam_role_policy" "rds_proxy_secrets" {
  name = "${local.name_prefix}-rds-proxy-secrets"
  role = aws_iam_role.rds_proxy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [for s in aws_secretsmanager_secret.db : s.arn]
    }]
  })
}

resource "aws_db_proxy" "main" {
  name                   = "${local.name_prefix}-proxy"
  engine_family          = "POSTGRESQL"
  role_arn               = aws_iam_role.rds_proxy.arn
  vpc_subnet_ids         = aws_subnet.private[*].id
  vpc_security_group_ids = [aws_security_group.rds_proxy.id]
  require_tls            = true

  # One auth block per Postgres role (see secrets.tf's own local.db_roles) — RDS
  # Proxy's real multi-user support, not a single shared credential every app
  # component would otherwise have to share.
  dynamic "auth" {
    for_each = local.db_roles
    content {
      auth_scheme = "SECRETS"
      secret_arn  = aws_secretsmanager_secret.db[auth.key].arn
      iam_auth    = "DISABLED"
    }
  }

  tags = local.common_tags
}

resource "aws_db_proxy_default_target_group" "main" {
  db_proxy_name = aws_db_proxy.main.name

  connection_pool_config {
    max_connections_percent      = 100
    max_idle_connections_percent = 50
  }
}

resource "aws_db_proxy_target" "main" {
  db_proxy_name          = aws_db_proxy.main.name
  target_group_name      = aws_db_proxy_default_target_group.main.name
  db_instance_identifier = aws_db_instance.main.identifier
}
