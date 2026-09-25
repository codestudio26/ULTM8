# ALB + HTTPS listener. domain_name/route53_zone_id have no default — nothing in
# confirmed material names ULTM8's real production domain (a genuine gap, not an
# oversight: docs/ULTM8-MASTER-ROADMAP.md §3 lists this whole workstream as "decided,
# zero provisioning"). Supply both before a real `terraform apply`; until then,
# `terraform plan` still shows the full shape of what gets created.

variable "domain_name" {
  description = "The apex/subdomain this API will be served from (e.g. api.ultm8.example.com). No default — must be supplied for a real apply; ACM/Route53 resources below depend on it."
  type        = string
}

variable "route53_zone_id" {
  description = "Existing Route53 hosted zone id for domain_name's own parent zone. No default — same reasoning as domain_name above."
  type        = string
}

resource "aws_lb" "main" {
  name               = "${local.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  tags = local.common_tags
}

resource "aws_lb_target_group" "api" {
  name        = "${local.name_prefix}-api"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip" # required for awsvpc-networked Fargate tasks.

  health_check {
    # GET /v1/docs, not a dedicated /health(z) — apps/api/src/main.ts has no health
    # route (verified directly before writing this, same check apps/api/Dockerfile's
    # own comment already made for the same reason). Swagger's own docs page is a
    # real, always-200-when-the-app-is-up route; a fabricated health endpoint isn't
    # this Terraform's call to invent.
    path                = "/v1/docs"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = local.common_tags
}

resource "aws_acm_certificate" "api" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = local.common_tags
}

resource "aws_route53_record" "acm_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = var.route53_zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "api" {
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for r in aws_route53_record.acm_validation : r.fqdn]
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.api.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_route53_record" "api" {
  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}
