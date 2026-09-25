# Least-privilege security-group graph: ALB accepts from the internet on 443; Fargate
# tasks accept only from the ALB; RDS Proxy/RDS/Redis each accept only from the
# Fargate tasks' own security group (never from each other or from anywhere broader) —
# mirrors this codebase's own RLS/least-privilege-Postgres-role posture
# (docs/ULTM8-MASTER-ROADMAP.md §3's "RLS/tenant-isolation security model" entry) at
# the network layer.

resource "aws_security_group" "alb" {
  name_prefix = "${local.name_prefix}-alb-"
  description = "Public ALB — HTTPS from the internet only."
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-alb-sg" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "fargate" {
  name_prefix = "${local.name_prefix}-fargate-"
  description = "apps/api Fargate tasks — accepts from the ALB only, egresses out to the internet (Stripe/Twilio/Postmark/R2) via the NAT Gateway."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "From the ALB on the app's own port (main.ts's PORT env var, default 3000)"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-fargate-sg" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "rds_proxy" {
  name_prefix = "${local.name_prefix}-rds-proxy-"
  description = "RDS Proxy (Decision 63) — accepts Postgres traffic from Fargate tasks only, forwards to RDS."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres from Fargate tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.fargate.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-rds-proxy-sg" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "rds" {
  name_prefix = "${local.name_prefix}-rds-"
  description = "RDS Postgres — accepts from RDS Proxy only, never directly from Fargate (every connection is proxied, Decision 63)."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres from RDS Proxy"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.rds_proxy.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-rds-sg" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "redis" {
  name_prefix = "${local.name_prefix}-redis-"
  description = "ElastiCache Redis — BullMQ's own backing store. Accepts from Fargate tasks only."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Redis from Fargate tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.fargate.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-redis-sg" })

  lifecycle {
    create_before_destroy = true
  }
}
