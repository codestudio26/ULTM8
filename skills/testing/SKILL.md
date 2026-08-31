---
name: testing
description: Governance skill for testing on the ULTM8 project — unit, integration, and end-to-end testing of confirmed requirements, permissions, and tenant isolation. Generic principles only.
---

# Testing

## Purpose

This skill governs how ULTM8 code is tested — unit, integration, and end-to-end.

## When to Use

Load before writing tests for a feature, or reviewing test coverage for a change.

## Core Principles

- Test confirmed, approved requirements — not assumed behaviour.
- Cover business rules, permissions, tenant isolation, and edge cases, not just the happy path.
- Unit, integration, and end-to-end tests each cover a different layer of confidence.
- Regression tests protect fixed bugs from recurring.

## Rules

- Base a test's expected outcome on a `[CONFIRMED]` rule or approved decision, not a guess.
- Write a regression test for every bug fix.
- Test permission and tenant-isolation boundaries explicitly, not incidentally.
- Keep tests traceable to the requirement they verify.

## ULTM8 Constraints

Test expectations for ULTM8-specific behaviour must come from Spec 55, `skills/ultm8-domain-rules/SKILL.md`, approved architectural decisions, or other explicitly approved project documentation. This skill must not invent expected behaviour to test against.

## Must NOT

- Must not write a test asserting invented/assumed behaviour for something tagged `[UNRESOLVED]`.
- Must not treat "the happy path passes" as sufficient coverage for a permission- or tenant-sensitive feature.
- Must not skip tenant-isolation testing on tenant-scoped code.

## Current Status

This is an initial engineering governance skill and will be refined as the ULTM8 architecture and implementation standards are formally established.
