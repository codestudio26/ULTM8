---
name: documentation
description: Governance skill for project documentation on ULTM8 — keeping documents synchronized, avoiding duplicate sources of truth, and recording unresolved decisions.
---

# Documentation

## Purpose

This skill governs how architectural, product, and design decisions are documented and kept current.

## When to Use

Load when recording a decision, updating project documentation, or reviewing whether documentation still matches reality.

## Core Principles

- Document decisions where they're made, not only in conversation.
- Keep documentation synchronized with what's actually true.
- Avoid creating a second, competing source of truth.
- Write documentation that's clear to someone without this conversation's context.
- Record unresolved decisions explicitly rather than letting them go undocumented.

## Rules

- Update the relevant document when a decision is made, not later.
- If a document appears to duplicate another's authority, flag it rather than letting the two drift.
- Write documentation in full sentences a new reader can follow, not shorthand.
- Record an unresolved question as unresolved rather than omitting it.

## ULTM8 Constraints

ULTM8-specific facts documented anywhere must trace back to Spec 55, `skills/ultm8-domain-rules/SKILL.md`, approved architectural decisions, or other explicitly approved project documentation. This skill must not invent product behaviour to document.

## Must NOT

- Must not let documentation silently drift from what's actually implemented or decided.
- Must not create a new document that duplicates `CLAUDE.md`, `SKILL.md`, `DESIGN.md`, or Spec 55's authority.
- Must not document invented behaviour as if it were confirmed.

## Current Status

This is an initial engineering governance skill and will be refined as the ULTM8 architecture and implementation standards are formally established.
