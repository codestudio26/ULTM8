---
name: architecture
description: Governance skill for architectural and structural decisions on the ULTM8 project — module boundaries, dependency direction, and maintainability. Generic engineering principles only; ULTM8-specific architecture comes from Spec 55 and approved decisions.
---

# Architecture

## Purpose

This skill governs architectural and structural decisions in the ULTM8 codebase — how the system is organized into modules/services, how dependencies flow between them, and how architectural changes are made and justified.

## When to Use

Load before creating a new module or service boundary, restructuring existing code, introducing a new architectural pattern, or reviewing a change for structural consistency.

## Core Principles

- Separation of concerns.
- Modular architecture with clear responsibilities per module.
- Explicit, one-directional dependency flow — avoid cycles and backward dependencies.
- Maintainability over cleverness.
- Architectural decisions are made explicitly and recorded, not implied by code.
- Avoid unnecessary complexity.
- Preserve existing architecture unless a change is justified.

## Rules

- A new module should have a single, clear responsibility.
- Dependencies should flow in one direction; avoid introducing cycles.
- A structural change should be justified before it's made, not discovered after.
- Prefer extending an existing pattern over introducing a new one without reason.
- Avoid adding abstraction layers "just in case" — add them when a real need exists.

## ULTM8 Constraints

ULTM8-specific architecture (module boundaries, service structure, technology choices) must come from Spec 55, `skills/ultm8-domain-rules/SKILL.md`, approved architectural decisions, or other explicitly approved project documentation. This skill provides general engineering principles only and must not invent product or architectural behaviour.

## Must NOT

- Must not restructure existing architecture without explicit justification.
- Must not introduce a new architectural pattern to solve a problem an existing one already solves.
- Must not add abstraction layers that don't reduce real complexity.
- Must not invent ULTM8's module boundaries or stack choices where Spec 55 or an approved decision already defines them.

## Current Status

This is an initial engineering governance skill and will be refined as the ULTM8 architecture and implementation standards are formally established.
