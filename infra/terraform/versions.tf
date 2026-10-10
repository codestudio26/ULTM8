terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # No backend block — deliberately. Which backend (S3+DynamoDB lock table, Terraform
  # Cloud, etc.) is itself a real decision nothing in Spec 55/the decision log makes,
  # and hardcoding a bucket name/account here would be inventing infrastructure this
  # plan has no authority to assume exists. Configure one explicitly before the first
  # real `terraform init` — see README.md's own "before you run this for real" section.
}

provider "aws" {
  region = var.aws_region
}
