---
name: performance
description: Governance skill for performance practices on the ULTM8 project — measuring before optimizing, efficient data access, and avoiding premature optimization. Generic principles only.
---

# Performance

## Purpose

This skill governs performance practices across the platform.

## When to Use

Load when implementing something performance-sensitive, or reviewing a change for performance risk.

## Core Principles

- Measure before optimizing.
- Efficient database access over speculative caching.
- Frontend performance is part of UX, not a separate concern.
- API performance is bounded by real usage patterns, not guesses.
- Cache only where there's a demonstrated need.
- Monitor the bottlenecks that actually matter.

## Rules

- Profile or measure before making a performance-motivated change.
- Prefer fixing an inefficient query/access pattern over adding a cache on top of it.
- Avoid premature optimization that adds complexity without a demonstrated need.
- Monitor the specific bottlenecks relevant to the change, not everything indiscriminately.

## ULTM8 Constraints

ULTM8-specific performance targets or NFRs must come from Spec 55, `skills/ultm8-domain-rules/SKILL.md`, approved architectural decisions, or other explicitly approved project documentation. This skill must not invent ULTM8-specific performance targets.

## Must NOT

- Must not optimize based on assumption rather than measurement.
- Must not add caching that risks serving stale or cross-tenant data without careful review.
- Must not invent ULTM8-specific performance targets or SLAs — those come from Spec 55's NFRs where defined.

## Current Status

This is an initial engineering governance skill and will be refined as the ULTM8 architecture and implementation standards are formally established.
