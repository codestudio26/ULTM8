---
name: ui-implementation
description: Governance skill for translating approved Figma designs into ULTM8 UI — following DESIGN.md, preserving intentional detail, and not converting visuals into business logic.
---

# UI Implementation

## Purpose

This skill governs how approved designs are translated into implemented UI on ULTM8.

## When to Use

Load when implementing a screen or component from an approved Figma design or from `DESIGN.md`.

## Core Principles

- Translate approved designs faithfully.
- Preserve intentional visual detail.
- Follow `DESIGN.md`'s design direction and principles.
- Design a component's states (loading/empty/error/success/disabled) deliberately, not just its static appearance.
- Responsive behaviour is part of "done," not a follow-up.

## Rules

- Check a design against Spec 55 and the domain rules before implementing anything it implies as behaviour.
- Preserve an intentional visual detail unless it conflicts with the specification.
- Implement every relevant component state, not just the "happy path" shown in a static design.
- Follow `DESIGN.md` for design direction rather than a personal interpretation.

## ULTM8 Constraints

ULTM8-specific business behaviour implied by a design must be confirmed against Spec 55 and `skills/ultm8-domain-rules/SKILL.md` before being implemented; a design alone is never sufficient authority for business logic. Visual direction comes from `DESIGN.md` and approved design-system decisions, not this skill.

## Must NOT

- Must not convert a Figma-only visual detail into a business rule.
- Must not implement a screen's implied behaviour without confirming it against Spec 55/domain rules.
- Must not invent visual values (colours, spacing, etc.) — those come from an approved design system per `DESIGN.md`.

## Current Status

This is an initial engineering governance skill and will be refined as the ULTM8 architecture and implementation standards are formally established.
