---
name: accessibility
description: Governance skill for accessibility on the ULTM8 project — semantic HTML, keyboard navigation, contrast, and inclusive interaction design. Generic principles only; ULTM8's accessibility target comes from Spec 55.
---

# Accessibility

## Purpose

This skill governs accessibility practices across ULTM8's interfaces.

## When to Use

Load when implementing or reviewing any user-facing UI.

## Core Principles

- Semantic HTML by default.
- Full keyboard navigability.
- Visible focus states.
- Sufficient colour contrast.
- Accessible, clearly labeled forms.
- Meaningful error and success feedback.
- Screen-reader compatibility where applicable.

## Rules

- Use semantic elements before reaching for ARIA.
- Ensure every interactive element is reachable and operable by keyboard.
- Keep focus states visible — never suppressed for aesthetics alone.
- Label every form field meaningfully.
- Verify contrast against the project's accepted standard once one is defined.

## ULTM8 Constraints

ULTM8's specific accessibility target and any surface-specific accessibility posture must come from Spec 55, `skills/ultm8-domain-rules/SKILL.md`, approved architectural decisions, or other explicitly approved project documentation. This skill must not invent ULTM8-specific accessibility requirements.

## Must NOT

- Must not remove or hide focus indicators without an accessible replacement.
- Must not rely on colour alone to convey state or meaning.
- Must not invent ULTM8's specific accessibility target or standard — defer to Spec 55.

## Current Status

This is an initial engineering governance skill and will be refined as the ULTM8 architecture and implementation standards are formally established.
