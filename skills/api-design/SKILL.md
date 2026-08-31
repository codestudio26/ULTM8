---
name: api-design
description: Governance skill for API design on the ULTM8 project — contracts, validation, consistent responses, and auth boundaries. Generic principles only; ULTM8's actual endpoints come from Spec 55.
---

# API Design

## Purpose

This skill governs how APIs are designed, documented, and evolved across ULTM8.

## When to Use

Load before designing a new endpoint, changing a response shape, or reviewing an API change.

## Core Principles

- Clear, predictable contracts.
- Validation happens at the boundary.
- Consistent response and error shapes across the API.
- Authentication and authorization are enforced at the API boundary, not assumed by callers.
- Backwards compatibility is the default.
- Version deliberately when a breaking change is unavoidable.

## Rules

- Validate every input at the API boundary, not only deep inside business logic.
- Use one consistent error-response shape across the API.
- Never let an endpoint skip its authorization check because "the caller wouldn't do that."
- Treat a breaking response-shape change as something to version or deprecate, not silently ship.
- Document a new or changed endpoint's contract.

## ULTM8 Constraints

ULTM8's actual endpoints, modules, and contracts must come from Spec 55 (§7, API Design), `skills/ultm8-domain-rules/SKILL.md`, approved architectural decisions, or other explicitly approved project documentation. This skill must not invent ULTM8-specific endpoints or contracts.

## Must NOT

- Must not skip validation because "the client already validates."
- Must not return inconsistent error shapes across endpoints.
- Must not treat authorization as an afterthought bolted on later.
- Must not invent ULTM8's actual endpoints or contracts — those come from Spec 55.

## Current Status

This is an initial engineering governance skill and will be refined as the ULTM8 architecture and implementation standards are formally established.
