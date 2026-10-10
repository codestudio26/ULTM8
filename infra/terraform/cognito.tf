# AWS Cognito — Platform Admin's own identity realm (Decision 100). Decision 100's
# own text, quoted directly: "the actual AWS Cognito User Pool itself... is real
# infrastructure outside this codebase's own provisioning capability... the User
# Pool itself (MFA set to Required, per §4.4) is the user's own infrastructure step
# to complete before this flow is reachable end-to-end." This is that step.
#
# The application code (apps/api/src/platform-admin/) is written against
# COGNITO_USER_POOL_ID/COGNITO_CLIENT_ID as configuration (see ecs.tf's own
# environment block) — nothing below changes that contract, it only provisions the
# real resources those two ids point at.

resource "aws_cognito_user_pool" "platform_admin" {
  name = "${local.name_prefix}-platform-admin"

  mfa_configuration = var.cognito_mfa_required ? "ON" : "OFF"

  software_token_mfa_configuration {
    enabled = var.cognito_mfa_required
  }

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = true
  }

  # No self-service sign-up — Decision 100's own "What this does NOT resolve"
  # section: admin accounts are provisioned via scripts/bootstrap-admin-user.ts
  # (bootstrap) and a future FULL_ADMIN-invites-a-teammate slice (not yet built),
  # never public self-registration. admin_create_user_config below is what actually
  # enforces that at the Cognito level.
  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  tags = local.common_tags
}

resource "aws_cognito_user_pool_client" "platform_admin" {
  name         = "${local.name_prefix}-platform-admin-client"
  user_pool_id = aws_cognito_user_pool.platform_admin.id

  # Confidential client (no client secret exposed to a browser) — apps/api's own
  # `POST /platform-admin/auth/exchange` (Decision 100's own named Slice 1 endpoint)
  # is the only thing that ever calls Cognito directly; apps/platform-admin (the
  # React app) never holds Cognito credentials itself, only ULTM8's own
  # subsequently-issued JWT — matching Decision 100's own "ULTM8's own JWT as what
  # the rest of the app depends on, never the upstream IdP's token directly."
  generate_secret = true

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  access_token_validity  = 5
  id_token_validity      = 5
  refresh_token_validity = 1
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}
