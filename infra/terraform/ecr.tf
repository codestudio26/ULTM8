# ECR repository for the image apps/api/Dockerfile builds — a real requirement not
# separately named in docs/ULTM8-MASTER-ROADMAP.md §3's own list (that list covers
# RDS/ElastiCache/Fargate/Cognito/Secrets Manager/RDS Proxy specifically), but Fargate
# has to pull the image from somewhere, and ECR is the natural default already
# implied by "Fargate" as the confirmed compute target.

resource "aws_ecr_repository" "api" {
  name                 = "${local.name_prefix}/api"
  image_tag_mutability = "IMMUTABLE" # matches Decision 32's own "redeploy the previous task-definition revision" rollback model — a mutable tag would make "the previous revision" ambiguous.

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.common_tags
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 20 images — enough for the Decision 32 rollback model to reach a meaningfully old revision without the repository growing unbounded."
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}
