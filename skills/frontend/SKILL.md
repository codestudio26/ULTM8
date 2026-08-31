---
name: frontend
description: Governance skill for general frontend engineering on the ULTM8 project — component architecture, state, and maintainability. Generic principles only; visual design specifics live in DESIGN.md and the ui-implementation skill.
---

# Frontend

## Purpose

This skill governs general frontend engineering practices — component architecture, state management, and maintainability — as distinct from visual design itself.

## When to Use

Load before building or reviewing UI-facing application logic. For translating an approved visual design into UI, see the `ui-implementation` skill instead.

## Core Principles

- Clear component architecture.
- Predictable, explicit state management.
- Reusable UI over duplicated UI.
- Every component considers its loading, error, and empty states.
- Responsive by default.
- Maintainable over clever.
- Performance-conscious rendering.

## Rules

- Prefer a reusable component over copy-pasting UI.
- Keep state management explicit and traceable, not implicit or global by default.
- Design a component's loading, error, and empty states up front, not as an afterthought.
- Keep components focused on one responsibility.

## ULTM8 Constraints

ULTM8-specific UI behaviour and visual identity must come from Spec 55, `skills/ultm8-domain-rules/SKILL.md`, `DESIGN.md`, approved architectural decisions, or other explicitly approved project documentation. This skill must not invent ULTM8-specific UI behaviour.

## Must NOT

- Must not duplicate UI logic that already exists as a component.
- Must not manage state in a way that's untraceable or inconsistent across the app.
- Must not invent ULTM8-specific UI behaviour — see `DESIGN.md` and Spec 55 for what's actually approved.

## Current Status

This is an initial engineering governance skill and will be refined as the ULTM8 architecture and implementation standards are formally established.
