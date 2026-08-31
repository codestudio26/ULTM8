---
name: error-handling
description: Governance skill for error handling on the ULTM8 project — structured errors, safe messaging, and safe logging. Generic principles only; ULTM8's specific retry/error behaviour comes from Spec 55.
---

# Error Handling

## Purpose

This skill governs how errors are surfaced, logged, and handled across the platform.

## When to Use

Load when implementing or reviewing error handling, logging, or failure-path behaviour.

## Core Principles

- Errors are predictable and structured, not ad hoc.
- User-facing messages are safe and useful, not raw internals.
- Logging captures enough to diagnose an issue without leaking sensitive data.
- Failures degrade gracefully where possible.
- Retries are deliberate, not automatic by default.

## Rules

- Use a consistent, structured error shape rather than ad hoc messages.
- Never surface a raw stack trace, internal error, or sensitive value to an end user.
- Log enough context to diagnose an issue (what, when, for whom) without logging the sensitive data itself.
- Design a retry only where the failure is actually transient and safe to repeat.

## ULTM8 Constraints

ULTM8's specific error/retry behaviour (e.g. background-job retry policy, payment-failure handling) must come from Spec 55, `skills/ultm8-domain-rules/SKILL.md`, approved architectural decisions, or other explicitly approved project documentation. This skill must not invent ULTM8-specific error behaviour.

## Must NOT

- Must not leak sensitive data (secrets, tokens, another tenant's data) in an error message or log line.
- Must not fail silently where a user or operator needs to know something went wrong.
- Must not invent ULTM8's specific error/retry behaviour where Spec 55 already defines it — defer to it.

## Current Status

This is an initial engineering governance skill and will be refined as the ULTM8 architecture and implementation standards are formally established.
