---
name: code-review
description: Governance skill for reviewing code changes on the ULTM8 project — specification compliance, architecture, security, and scope control. Generic principles only.
---

# Code Review

## Purpose

This skill governs how code changes are reviewed before being accepted.

## When to Use

Load when reviewing any pull request or proposed change.

## Core Principles

- Check specification and domain-rule compliance first.
- Then check architecture, security, and maintainability.
- Watch for regression risk and scope drift.
- A review's job is to find issues, not redesign the change.

## Rules

- Verify a change traces back to an approved requirement or decision.
- Check for silently invented behaviour, especially around anything tagged `[UNRESOLVED]`.
- Flag scope creep — a change doing more than what was asked.
- Check tenant-isolation and permission-boundary code with particular care.
- Don't approve a change you haven't actually read.

## ULTM8 Constraints

Reviewing ULTM8-specific behaviour requires checking it against Spec 55, `skills/ultm8-domain-rules/SKILL.md`, approved architectural decisions, or other explicitly approved project documentation. This skill must not invent product behaviour to review against.

## Must NOT

- Must not approve a change that resolves an `[UNRESOLVED]` item by assumption.
- Must not skip security or tenant-isolation review because "it's a small change."
- Must not redesign the requirement mid-review — flag and return it instead.

## Current Status

This is an initial engineering governance skill and will be refined as the ULTM8 architecture and implementation standards are formally established.
