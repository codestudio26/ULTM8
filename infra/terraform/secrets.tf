# AWS Secrets Manager (Spec §11.6, `ultm8-payments` SKILL.md §1) — every credential
# apps/api/.env.example names is provisioned here as a real secret, not a plaintext
# Terraform variable. Values for the external-vendor secrets (Stripe/Twilio/Postmark/
# R2/QR token secrets) are created as EMPTY placeholders — this stack has no real
# vendor credentials to put in them (same "confirmed target, not yet provisioned"
# treatment every other external-service integration already gets in this codebase,
# per docs/ULTM8-MASTER-ROADMAP.md §3) — and must be filled in by hand (console, or
# `aws secretsmanager put-secret-value`) after apply, never by committing real values
# into this repo. Terraform's own `ignore_changes` on `secret_string` keeps a later
# `terraform apply` from clobbering whatever was set out-of-band.

# ---- Database credentials — one secret per Postgres role, matching
# apps/api/.env.example's own DATABASE_URL / DATABASE_URL_APP / _AUTH / _JOBS /
# _DISCOVERY / _PLATFORM_ADMIN exactly. Passwords are generated here, never typed. ----

locals {
  db_roles = {
    superuser      = { username = "postgres", env_var = "DATABASE_URL" }
    app            = { username = "ultm8_app", env_var = "DATABASE_URL_APP" }
    auth           = { username = "ultm8_auth", env_var = "DATABASE_URL_AUTH" }
    jobs           = { username = "ultm8_jobs", env_var = "DATABASE_URL_JOBS" }
    discovery      = { username = "ultm8_discovery", env_var = "DATABASE_URL_DISCOVERY" }
    platform_admin = { username = "ultm8_platform_admin", env_var = "DATABASE_URL_PLATFORM_ADMIN" }
  }
}

resource "random_password" "db" {
  for_each = local.db_roles

  length  = 32
  special = false # Postgres connection-string passwords with special chars need URL-encoding apps/api's own config never does — alnum-only avoids that whole class of bug.
}

resource "aws_secretsmanager_secret" "db" {
  for_each = local.db_roles

  name = "${local.name_prefix}/db/${each.key}"
  tags = local.common_tags
}

# The secret_string is the actual DATABASE_URL* connection string apps/api expects —
# not just a bare password — so ECS's own `secrets` block (see ecs.tf) can inject it
# directly with no glue code. Host/port point at RDS Proxy (Decision 63), never RDS
# directly, matching security_groups.tf's own "every connection is proxied" posture.
resource "aws_secretsmanager_secret_version" "db" {
  for_each = local.db_roles

  secret_id     = aws_secretsmanager_secret.db[each.key].id
  secret_string = "postgresql://${each.value.username}:${random_password.db[each.key].result}@${aws_db_proxy.main.endpoint}:5432/${aws_db_instance.main.db_name}?schema=public"
}

# ---- App-internal secrets (JWT signing keys, QR token secrets) — generated, never
# typed; no external vendor involved. ----

resource "random_password" "jwt_access_secret" {
  length  = 48
  special = false
}

resource "random_password" "platform_admin_jwt_secret" {
  length  = 48
  special = false
}

resource "random_password" "qr_class_token_secret" {
  length  = 48
  special = false
}

resource "random_password" "qr_student_token_secret" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "app_internal" {
  name = "${local.name_prefix}/app-internal"
  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "app_internal" {
  secret_id = aws_secretsmanager_secret.app_internal.id
  secret_string = jsonencode({
    JWT_ACCESS_SECRET         = random_password.jwt_access_secret.result
    PLATFORM_ADMIN_JWT_SECRET = random_password.platform_admin_jwt_secret.result
    QR_CLASS_TOKEN_SECRET     = random_password.qr_class_token_secret.result
    QR_STUDENT_TOKEN_SECRET   = random_password.qr_student_token_secret.result
  })
}

# ---- External-vendor secrets — placeholders, filled in by hand post-apply. ----

locals {
  vendor_secret_placeholders = {
    stripe   = { STRIPE_SECRET_KEY = "REPLACE_ME", STRIPE_WEBHOOK_SECRET = "REPLACE_ME" }
    twilio   = { TWILIO_ACCOUNT_SID = "REPLACE_ME", TWILIO_AUTH_TOKEN = "REPLACE_ME", TWILIO_VERIFY_SERVICE_SID = "REPLACE_ME" }
    postmark = { POSTMARK_SERVER_TOKEN = "REPLACE_ME" }
    r2       = { R2_ACCOUNT_ID = "REPLACE_ME", R2_ACCESS_KEY_ID = "REPLACE_ME", R2_SECRET_ACCESS_KEY = "REPLACE_ME", R2_BUCKET_NAME = "REPLACE_ME" }
  }
}

resource "aws_secretsmanager_secret" "vendor" {
  for_each = local.vendor_secret_placeholders

  name = "${local.name_prefix}/vendor/${each.key}"
  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "vendor" {
  for_each = local.vendor_secret_placeholders

  secret_id     = aws_secretsmanager_secret.vendor[each.key].id
  secret_string = jsonencode(each.value)

  lifecycle {
    ignore_changes = [secret_string]
  }
}
