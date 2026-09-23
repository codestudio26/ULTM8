# RDS Postgres (Spec §11.6, Decision 11). Engine version pinned to what's already
# confirmed real (see variables.tf's own comment) — everything else (instance class,
# storage, Multi-AZ) is an explicitly-flagged first-pass default, not a decision.

resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db"
  subnet_ids = aws_subnet.private[*].id
  tags       = local.common_tags
}

# The RDS master/superuser password — this is the ONE db credential not sourced from
# secrets.tf's own random_password map, because RDS itself needs the plaintext value
# at resource-creation time (RDS won't accept a value only known after the instance
# exists), while every other role's password (created by the migration SQL itself,
# not by RDS) has no such ordering constraint.
resource "random_password" "rds_master" {
  length  = 32
  special = false
}

resource "aws_db_instance" "main" {
  identifier     = "${local.name_prefix}-postgres"
  engine         = "postgres"
  engine_version = var.postgres_engine_version

  instance_class        = var.rds_instance_class
  allocated_storage     = var.rds_allocated_storage_gb
  max_allocated_storage = var.rds_max_allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "ultm8"
  username = "postgres"
  password = random_password.rds_master.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  multi_az                = var.rds_multi_az
  backup_retention_period = var.rds_backup_retention_days
  # See infra/terraform/README.md's own backup/DR section for what this window and
  # retention period do and don't cover.
  backup_window      = "03:00-04:00"
  maintenance_window = "mon:04:30-mon:05:30"

  # Required for RDS Proxy (Decision 63) to broker IAM/Secrets-Manager-based auth —
  # RDS Proxy cannot front an instance with this disabled.
  deletion_protection = var.environment == "production"

  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "${local.name_prefix}-postgres-final" : null

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-postgres" })
}
