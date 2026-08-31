---
name: devops-deployment
description: Governance skill for environment, deployment, and operational practices on the ULTM8 project — configuration, safe deployments, and rollback strategy. Generic principles only; ULTM8's actual infrastructure comes from Spec 55.
---

# DevOps & Deployment

## Purpose

This skill governs environment, deployment, and operational practices for the platform.

## When to Use

Load when working on environment configuration, CI/CD, deployments, migrations, or production verification.

## Core Principles

- Separate environments cleanly (dev/staging/production).
- Manage configuration and secrets deliberately, never hardcoded.
- Follow safe, reversible deployment practices.
- Have a rollback strategy before you need one.
- Treat a migration as a production-affecting change.
- Monitor after deploying — don't assume success.

## Rules

- Keep environment-specific configuration out of code, and secrets out of version control.
- Verify a deployment's rollback path exists before relying on the deployment.
- Treat schema migrations with the same care as any other production-affecting change.
- Verify a deployment in production after it ships — don't assume the pipeline succeeding is sufficient.

## ULTM8 Constraints

ULTM8's actual environment, infrastructure, and CI/CD setup must come from Spec 55 (§11.6), `skills/ultm8-domain-rules/SKILL.md`, approved architectural decisions, or other explicitly approved project documentation. This skill must not invent ULTM8-specific infrastructure.

## Must NOT

- Must not hardcode environment-specific configuration or secrets.
- Must not deploy a destructive migration without a reviewed rollback plan.
- Must not invent ULTM8's actual environment or infrastructure setup — that comes from Spec 55 and approved decisions.

## Current Status

This is an initial engineering governance skill and will be refined as the ULTM8 architecture and implementation standards are formally established.
