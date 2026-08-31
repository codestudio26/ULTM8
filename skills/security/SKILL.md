---
name: security
description: Governance skill for secure-by-default engineering on the ULTM8 project — input handling, secrets, and common web risks. Generic principles only; ULTM8's actual security architecture comes from Spec 55.
---

# Security

## Purpose

This skill governs secure-by-default engineering practices across the platform.

## When to Use

Load before implementing anything touching input handling, authentication, secrets, or third-party dependencies, or reviewing a change for security risk.

## Core Principles

- Secure by default, not by review.
- Validate and sanitize all input.
- Encode output for its context.
- Secrets are never hardcoded or logged.
- Authentication and authorization are enforced, not assumed.
- Common web application risks (injection, broken access control, sensitive-data exposure) are checked for by default.
- Dependencies are reviewed before being trusted.

## Rules

- Validate and sanitize every external input.
- Never commit or log a secret, credential, or token.
- Encode output appropriately for where it's rendered.
- Check third-party dependencies for known vulnerabilities before adding them.
- Treat any user-controllable value used in a query, command, or template as untrusted.

## ULTM8 Constraints

ULTM8's actual security architecture (credential custody, secrets management, payment-security model) must come from Spec 55, `skills/ultm8-domain-rules/SKILL.md`, approved architectural decisions, or other explicitly approved project documentation. This skill must not invent ULTM8-specific security behaviour.

## Must NOT

- Must not hardcode secrets or credentials anywhere in the codebase.
- Must not trust client-supplied input without validation.
- Must not invent ULTM8's actual security architecture where Spec 55 already defines it.
- Must not weaken an existing security control without explicit approval.

## Current Status

This is an initial engineering governance skill and will be refined as the ULTM8 architecture and implementation standards are formally established.
