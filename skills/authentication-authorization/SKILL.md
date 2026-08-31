---
name: authentication-authorization
description: Governance skill for authentication and authorization on the ULTM8 project — least privilege, server-side checks, and session/token safety. Generic principles only; ULTM8's actual roles come from Spec 55 and the domain rules.
---

# Authentication & Authorization

## Purpose

This skill governs how authentication (who you are) and authorization (what you're allowed to do) are implemented and reviewed on ULTM8.

## When to Use

Load before implementing login/session logic, permission checks, or reviewing anything touching access control.

## Core Principles

- Authentication and authorization are distinct concerns — don't conflate them.
- Least privilege by default.
- Every permission check happens server-side.
- Sessions and tokens are treated as sensitive credentials.
- A role or permission is checked explicitly, never inferred from client-supplied state.

## Rules

- Never trust a client-supplied role, id, or permission flag without server-side verification.
- Authorize on the server for every sensitive action, not just at the UI layer.
- Keep session/token lifetimes and storage deliberate, not accidental.
- Log or audit sensitive authorization decisions where the project already requires it.

## ULTM8 Constraints

ULTM8's actual roles, permission model, and identity architecture must come from Spec 55, `skills/ultm8-domain-rules/SKILL.md`, approved architectural decisions, or other explicitly approved project documentation. This skill must not invent ULTM8-specific roles or permissions.

## Must NOT

- Must not invent ULTM8's actual roles or permission model — that comes from Spec 55 and the domain rules.
- Must not perform authorization checks client-side only.
- Must not allow a privilege-escalation path that isn't explicitly designed.
- Must not trust a token or session without validating it server-side.

## Current Status

This is an initial engineering governance skill and will be refined as the ULTM8 architecture and implementation standards are formally established.
