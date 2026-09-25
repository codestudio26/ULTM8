output "alb_dns_name" {
  description = "The ALB's own DNS name — aws_route53_record.api aliases var.domain_name to this."
  value       = aws_lb.main.dns_name
}

output "ecr_repository_url" {
  description = "Push apps/api's built image here — see apps/api/Dockerfile's own header comment."
  value       = aws_ecr_repository.api.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  value = aws_ecs_service.api.name
}

output "ecs_task_definition_arn" {
  description = "Current task-definition revision — .github/workflows/deploy.yml's migration job runs `aws ecs run-task` against this exact revision (same image, same VPC networking/security groups, same Secrets Manager-sourced DATABASE_URL as the service itself), overriding the container command to `npx prisma migrate deploy` instead of starting a service replica. No separate migration task definition exists; this reuses the one Fargate already needs."
  value       = aws_ecs_task_definition.api.arn
}

output "private_subnet_ids" {
  description = "Same private subnets the Fargate service itself runs in — .github/workflows/deploy.yml's migration run-task uses these so it can reach RDS Proxy through security_groups.tf's own fargate->rds_proxy rule."
  value       = aws_subnet.private[*].id
}

output "fargate_security_group_id" {
  description = "Same security group the Fargate service itself uses — required for the migration run-task above to be allowed through security_groups.tf's rds_proxy ingress rule (which only accepts from this SG)."
  value       = aws_security_group.fargate.id
}

output "rds_proxy_endpoint" {
  description = "What every DATABASE_URL* secret in Secrets Manager actually points at — never the raw RDS endpoint directly (Decision 63)."
  value       = aws_db_proxy.main.endpoint
}

output "redis_endpoint" {
  value = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "cognito_user_pool_id" {
  description = "Set as COGNITO_USER_POOL_ID (see apps/api/.env.example)."
  value       = aws_cognito_user_pool.platform_admin.id
}

output "cognito_user_pool_client_id" {
  description = "Set as COGNITO_CLIENT_ID (see apps/api/.env.example)."
  value       = aws_cognito_user_pool_client.platform_admin.id
}

output "db_secret_arns" {
  description = "One Secrets Manager ARN per Postgres role — matches apps/api/.env.example's DATABASE_URL* names exactly (see secrets.tf's own local.db_roles map)."
  value       = { for role, secret in aws_secretsmanager_secret.db : role => secret.arn }
}

output "vendor_secret_arns" {
  description = "Placeholder secrets that need real values filled in by hand post-apply — see secrets.tf's own header comment."
  value       = { for name, secret in aws_secretsmanager_secret.vendor : name => secret.arn }
}
